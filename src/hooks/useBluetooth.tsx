import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { BleManager, Device, State as BleState, BleError } from 'react-native-ble-plx';

// ── Paddle filter config ─────────────────────────────────────────
// Target hardware: Arduino Nano RP2040 Connect (U-blox® Nina W102).
// These MUST stay in sync with the firmware BLE identity defined in
// firmware/firmware.ino (PADDLE_BLE_NAME / PADDLE_SERVICE_UUID).
// Set both fields to null to disable filtering and scan everything (dev mode).
const PADDLE_FILTER = {
  /** Expected BLE advertised name (matches firmware.ino PADDLE_BLE_NAME) */
  name: 'PaddlePal-Paddle' as string | null,
  /** Expected BLE advertised service UUID (matches firmware.ino PADDLE_SERVICE_UUID) */
  serviceUUID: '9590ad2d-fd81-4688-9d3b-65ac36caca3a' as string | null,
};

// ── Types ────────────────────────────────────────────────────────
interface DiscoveredDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  /** Advertised service UUIDs (used for paddle matching) */
  serviceUUIDs: string[] | null;
  /** Raw BLE-PLX device for connection */
  raw: Device;
}

interface BluetoothContextValue {
  /** Current BLE adapter state (PoweredOn, PoweredOff, etc.) */
  adapterState: BleState;
  /** Whether a scan is in progress */
  isScanning: boolean;
  /** Discovered BLE peripherals */
  devices: DiscoveredDevice[];
  /** Currently connected device, or null */
  connectedDevice: DiscoveredDevice | null;
  /** Start scanning for BLE peripherals */
  startScan: () => void;
  /** Stop an active scan */
  stopScan: () => void;
  /** Connect to a discovered device */
  connectToDevice: (device: DiscoveredDevice) => Promise<void>;
  /** Disconnect from the current device */
  disconnect: () => Promise<void>;
  /** Human-readable error message, if any */
  error: string | null;
}

const BluetoothContext = createContext<BluetoothContextValue | null>(null);

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Swallows rejections from fire-and-forget BLE calls.
 *
 * `startDeviceScan`, `stopDeviceScan`, and `destroy` all return promises that
 * route through the library's `parseBleError`. When we don't await them, a
 * rejection (e.g. the manager being torn down on provider unmount / Fast
 * Refresh, or the adapter not being ready) surfaces as an uncaught
 * "BleError: Unknown error occurred". Attaching this keeps them handled.
 */
function ignoreBleRejection(result: unknown): void {
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    (result as Promise<unknown>).catch((err) => {
      console.warn('[BLE] Ignored operation rejection:', err?.message ?? err);
    });
  }
}


/** Case-insensitive equality against the configured paddle name. */
function nameMatches(candidates: (string | null | undefined)[]): boolean {
  if (PADDLE_FILTER.name === null) return false;
  const target = PADDLE_FILTER.name.trim().toLowerCase();
  return candidates.some((c) => c != null && c.trim().toLowerCase() === target);
}

/** Case-insensitive check for the configured service UUID within a UUID list. */
function uuidMatches(uuids: string[] | null | undefined): boolean {
  if (PADDLE_FILTER.serviceUUID === null) return false;
  const target = PADDLE_FILTER.serviceUUID.toLowerCase();
  return (uuids ?? []).some((uuid) => uuid.toLowerCase() === target);
}

/**
 * Returns true if the device passes the paddle filter.
 * Lenient OR semantics: accepts if EITHER the advertised name (checking both
 * `name` and `localName`, case-insensitively) OR the service UUID matches.
 * When both PADDLE_FILTER fields are null, all devices pass (dev mode).
 */
function isPaddleDevice(device: Device): boolean {
  if (PADDLE_FILTER.name === null && PADDLE_FILTER.serviceUUID === null) {
    return true; // no filter configured — accept all (dev mode)
  }
  return nameMatches([device.name, device.localName]) || uuidMatches(device.serviceUUIDs);
}

/**
 * Returns true if the connected device is a valid paddle.
 * Same lenient OR semantics as {@link isPaddleDevice}.
 * When both PADDLE_FILTER fields are null, any connected device counts (dev mode).
 */
export function isConnectedToPaddle(device: DiscoveredDevice | null): boolean {
  if (!device) return false;
  if (PADDLE_FILTER.name === null && PADDLE_FILTER.serviceUUID === null) {
    return true; // no filter configured — accept all (dev mode)
  }
  return (
    nameMatches([device.name, device.raw.name, device.raw.localName]) ||
    uuidMatches(device.serviceUUIDs ?? device.raw.serviceUUIDs)
  );
}

// ── Provider ─────────────────────────────────────────────────────

export function BluetoothProvider({ children }: { children: React.ReactNode }) {
  const managerRef = useRef<BleManager | null>(null);

  const [adapterState, setAdapterState] = useState<BleState>(BleState.Unknown);
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DiscoveredDevice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialise BleManager once
  useEffect(() => {
    let manager: BleManager | null = null;
    let subscription: ReturnType<BleManager['onStateChange']> | null = null;

    try {
      manager = new BleManager();
      managerRef.current = manager;

      subscription = manager.onStateChange((state) => {
        setAdapterState(state);
      }, true);
    } catch (err) {
      // Native BLE module not available (pre-rebuild or simulator)
      console.warn(
        '[BLE] Native module not available. Rebuild the app with `npx expo prebuild --clean && npm run ios`.',
        err,
      );
      setAdapterState(BleState.Unsupported);
    }

    return () => {
      subscription?.remove();
      ignoreBleRejection(manager?.stopDeviceScan());
      ignoreBleRejection(manager?.destroy());
      managerRef.current = null;
    };
  }, []);

  // ── Scan ─────────────────────────────────────────────────────

  const startScan = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    if (adapterState !== BleState.PoweredOn) {
      setError('Bluetooth is not powered on. Please enable Bluetooth in Settings.');
      return;
    }

    setError(null);
    setDevices([]);
    setIsScanning(true);

    // Scan for ALL advertisements (null filter), then match client-side.
    // We deliberately do NOT pass the service UUID as an OS-level scan filter:
    // a 128-bit UUID + the local name can exceed the 31-byte advertising packet
    // limit, so the UUID may live only in the scan response (or be dropped) and
    // a UUID-filtered scan would never surface the paddle at all. Client-side
    // matching on name OR UUID (see isPaddleDevice) is far more reliable.
    ignoreBleRejection(
      manager.startDeviceScan(
        null,
        { allowDuplicates: false },
        (bleError, device) => {
          if (bleError) {
            console.error('[BLE] Scan error:', bleError.message);
            setError(bleError.message);
            setIsScanning(false);
            return;
          }

          if (!device) return;

          // Second layer: covers the name-only match case (a UUID-based scan
          // filter won't surface those), and is a no-op safety net otherwise.
          if (!isPaddleDevice(device)) return;

          const discovered: DiscoveredDevice = {
            id: device.id,
            name: device.name ?? device.localName ?? null,
            rssi: device.rssi,
            serviceUUIDs: device.serviceUUIDs ?? null,
            raw: device,
          };

          setDevices((prev) => {
            // Deduplicate by ID, update RSSI if already present
            const existing = prev.findIndex((d) => d.id === device.id);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = discovered;
              return updated;
            }
            return [...prev, discovered];
          });
        },
      ),
    );

    // Auto-stop after 15 seconds to save battery
    setTimeout(() => {
      ignoreBleRejection(manager.stopDeviceScan());
      setIsScanning(false);
    }, 15_000);
  }, [adapterState]);

  const stopScan = useCallback(() => {
    ignoreBleRejection(managerRef.current?.stopDeviceScan());
    setIsScanning(false);
  }, []);

  // ── Connect ──────────────────────────────────────────────────

  const connectToDevice = useCallback(async (device: DiscoveredDevice) => {
    const manager = managerRef.current;
    if (!manager) return;

    // Stop scanning before connecting
    ignoreBleRejection(manager.stopDeviceScan());
    setIsScanning(false);
    setError(null);

    try {
      const connected = await device.raw.connect({ timeout: 10_000 });
      await connected.discoverAllServicesAndCharacteristics();

      // Monitor disconnection
      connected.onDisconnected((disconnectError) => {
        console.log('[BLE] Device disconnected:', device.name ?? device.id);
        setConnectedDevice(null);
        if (disconnectError) {
          setError(`Device disconnected: ${disconnectError.message}`);
        }
      });

      setConnectedDevice({
        id: connected.id,
        name: connected.name ?? connected.localName ?? device.name,
        rssi: device.rssi,
        serviceUUIDs: connected.serviceUUIDs ?? device.serviceUUIDs,
        raw: connected,
      });
    } catch (err) {
      const message = err instanceof BleError ? err.message : 'Failed to connect to device.';
      console.error('[BLE] Connection error:', message);
      setError(message);
    }
  }, []);

  // ── Disconnect ───────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    if (!connectedDevice) return;

    try {
      const isConnected = await connectedDevice.raw.isConnected();
      if (isConnected) {
        await connectedDevice.raw.cancelConnection();
      }
    } catch (err) {
      console.error('[BLE] Disconnect error:', err);
    } finally {
      setConnectedDevice(null);
    }
  }, [connectedDevice]);

  // ── Context value ────────────────────────────────────────────

  const value = useMemo<BluetoothContextValue>(
    () => ({
      adapterState,
      isScanning,
      devices,
      connectedDevice,
      startScan,
      stopScan,
      connectToDevice,
      disconnect,
      error,
    }),
    [adapterState, isScanning, devices, connectedDevice, startScan, stopScan, connectToDevice, disconnect, error],
  );

  return (
    <BluetoothContext.Provider value={value}>
      {children}
    </BluetoothContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────

export function useBluetooth(): BluetoothContextValue {
  const ctx = useContext(BluetoothContext);
  if (!ctx) {
    throw new Error('useBluetooth must be used within a <BluetoothProvider>.');
  }
  return ctx;
}
