import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { BleManager, Device, State as BleState, BleError } from 'react-native-ble-plx';

// ── Future filter config ─────────────────────────────────────────
// Target hardware: Arduino Nano RP2040 Connect (U-blox® Nina W102)
// Set these to non-null values to restrict scanning/connection.
const PADDLE_FILTER = {
  /** Expected BLE advertised name (e.g. "PaddlePal-Sensor") */
  name: null as string | null,
  /** Expected BLE peripheral UUID */
  id: null as string | null,
};

// ── Types ────────────────────────────────────────────────────────
interface DiscoveredDevice {
  id: string;
  name: string | null;
  rssi: number | null;
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
 * Returns true if the device passes the paddle filter.
 * When PADDLE_FILTER fields are null, all devices pass.
 */
function isPaddleDevice(device: Device): boolean {
  if (PADDLE_FILTER.name !== null && device.name !== PADDLE_FILTER.name) {
    return false;
  }
  if (PADDLE_FILTER.id !== null && device.id !== PADDLE_FILTER.id) {
    return false;
  }
  return true;
}

/**
 * Returns true if the connected device is a valid paddle.
 * When PADDLE_FILTER fields are null, any connected device counts.
 */
export function isConnectedToPaddle(device: DiscoveredDevice | null): boolean {
  if (!device) return false;
  if (PADDLE_FILTER.name !== null && device.name !== PADDLE_FILTER.name) {
    return false;
  }
  if (PADDLE_FILTER.id !== null && device.id !== PADDLE_FILTER.id) {
    return false;
  }
  return true;
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
      manager?.stopDeviceScan();
      manager?.destroy();
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

    manager.startDeviceScan(null, { allowDuplicates: false }, (bleError, device) => {
      if (bleError) {
        console.error('[BLE] Scan error:', bleError.message);
        setError(bleError.message);
        setIsScanning(false);
        return;
      }

      if (!device) return;

      // Apply filter (currently accepts all)
      if (!isPaddleDevice(device)) return;

      const discovered: DiscoveredDevice = {
        id: device.id,
        name: device.name ?? device.localName ?? null,
        rssi: device.rssi,
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
    });

    // Auto-stop after 15 seconds to save battery
    setTimeout(() => {
      manager.stopDeviceScan();
      setIsScanning(false);
    }, 15_000);
  }, [adapterState]);

  const stopScan = useCallback(() => {
    managerRef.current?.stopDeviceScan();
    setIsScanning(false);
  }, []);

  // ── Connect ──────────────────────────────────────────────────

  const connectToDevice = useCallback(async (device: DiscoveredDevice) => {
    const manager = managerRef.current;
    if (!manager) return;

    // Stop scanning before connecting
    manager.stopDeviceScan();
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
