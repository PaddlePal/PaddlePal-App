import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
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

// ── Session-control characteristic (forward declaration) ─────────
// Reserved as the next UUID in the firmware's service/info/fsrData sequence
// (…2d service, …2e info, …2f fsrData → …30 session control). NOT present in
// firmware yet — this is the app-side half of a future shared BLE control
// characteristic (Write + Notify, 1 byte). Whichever side changes it first
// (app write, or a future paddle-handle button) is authoritative; the other
// reacts to the notify. See memory-bank/progress.md (2026-07-13, T6).
const PADDLE_SERVICE_UUID = '9590ad2d-fd81-4688-9d3b-65ac36caca3a';
const SESSION_CONTROL_CHAR_UUID = '9590ad30-fd81-4688-9d3b-65ac36caca3a';

// ── Tunables ─────────────────────────────────────────────────────
/** How long one scan pass runs before it gives up (manual and auto alike). */
const SCAN_TIMEOUT_MS = 15_000;
/**
 * Pause between auto-connect scan passes. Long enough to avoid hammering
 * startDeviceScan/stopDeviceScan back-to-back (iOS CoreBluetooth rate-limits
 * and warns on that), short enough to catch the paddle soon after a ~4s
 * watchdog reboot. A starting guess — tune on hardware.
 */
const AUTO_RETRY_DELAY_MS = 3_000;

// ── Types ────────────────────────────────────────────────────────

/**
 * Connection lifecycle, exposed for presentation/orchestration.
 * `connectedDevice` stays the source of truth for "are we actually connected";
 * this is layered on top so the UI can tell "never connected" apart from
 * "lost it, actively hunting for it again".
 */
export type ConnectionPhase =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

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
  /** Where we are in the connect lifecycle (drives the "Reconnecting…" UI) */
  connectionPhase: ConnectionPhase;
  /** Start scanning for BLE peripherals */
  startScan: () => void;
  /** Stop an active scan */
  stopScan: () => void;
  /** Connect to a discovered device */
  connectToDevice: (device: DiscoveredDevice) => Promise<void>;
  /** Disconnect from the current device */
  disconnect: () => Promise<void>;
  /**
   * Start (or resume) the foreground auto-connect loop. Self-guarding: no-ops
   * when already connected, already looping, when the adapter isn't powered on,
   * or after a user-initiated disconnect — so callers can fire it freely.
   */
  runAutoConnectLoop: () => void;
  /**
   * Pause the auto-connect loop and cancel its in-flight scan pass — used while
   * the manual scanner modal owns the radio, so the two scans never overlap.
   */
  stopAutoConnectLoop: () => void;
  /**
   * Best-effort write of session-active state to the paddle's session-control
   * characteristic. No-ops silently when the characteristic isn't present on
   * the connected peripheral (today's firmware) — never throws.
   */
  writeSessionState: (active: boolean) => Promise<void>;
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

/** Resolves after `ms`. Spaces out auto-connect scan passes. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalises a raw BLE-PLX device into the shape the app passes around. */
function toDiscoveredDevice(device: Device): DiscoveredDevice {
  return {
    id: device.id,
    name: device.name ?? device.localName ?? null,
    rssi: device.rssi,
    serviceUUIDs: device.serviceUUIDs ?? null,
    raw: device,
  };
}

/** Callbacks for one pass of the shared scan core (see `beginFilteredScan`). */
interface FilteredScanHandlers {
  /** Pass duration before the scan stops itself. */
  timeoutMs: number;
  /** Called for every discovered device that passes the paddle filter. */
  onMatch: (device: Device) => void;
  /** Called on a scan error (the pass stops afterwards). */
  onError?: (error: BleError) => void;
  /** Called exactly once when the pass ends — timeout, error, or cancellation. */
  onStop?: () => void;
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
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Refs mirror the state the auto-connect loop and the BLE callbacks read
  // synchronously — React state updates are async and would race the loop.
  const adapterStateRef = useRef<BleState>(BleState.Unknown);
  const connectedDeviceRef = useRef<DiscoveredDevice | null>(null);
  /**
   * True once a connection has succeeded this app session, so later attempts
   * read as "Reconnecting…" rather than a first-time "Searching…".
   */
  const hasConnectedRef = useRef(false);
  /**
   * Set only by `disconnect()` — "the user chose this, stay disconnected".
   * Cleared by any connect attempt. This is what separates an unexpected drop
   * (auto-reconnect) from a deliberate one (stay put until the user acts).
   */
  const intentionalDisconnectRef = useRef(false);
  /** Guards against two auto-connect loops running at once. */
  const autoConnectLoopRef = useRef(false);
  /**
   * Identity of the current loop run, bumped on every start and stop. A loop
   * that was stopped mid-`sleep` can otherwise wake up to find the flag set
   * again by a *newer* loop and carry on alongside it — the generation check is
   * what makes a stopped loop stay stopped.
   */
  const autoConnectGenerationRef = useRef(0);
  /** Cancels the scan pass the auto-connect loop currently owns, if any. */
  const autoScanStopRef = useRef<(() => void) | null>(null);
  /** Cancels whichever scan is registered right now — manual or auto. */
  const activeScanStopRef = useRef<(() => void) | null>(null);
  /**
   * Late-bound `runAutoConnectLoop`, so the `onDisconnected` handler registered
   * inside `connectToDevice` can restart the loop without the two callbacks
   * depending on each other.
   */
  const runAutoConnectRef = useRef<() => void>(() => {});

  // Initialise BleManager once
  useEffect(() => {
    let manager: BleManager | null = null;
    let subscription: ReturnType<BleManager['onStateChange']> | null = null;

    try {
      manager = new BleManager();
      managerRef.current = manager;

      subscription = manager.onStateChange((state) => {
        // Ref first: the auto-connect loop's while-condition reads it directly.
        adapterStateRef.current = state;
        setAdapterState(state);
      }, true);
    } catch (err) {
      // Native BLE module not available (pre-rebuild or simulator)
      console.warn(
        '[BLE] Native module not available. Rebuild the app with `npx expo prebuild --clean && npm run ios`.',
        err,
      );
      adapterStateRef.current = BleState.Unsupported;
      setAdapterState(BleState.Unsupported);
    }

    return () => {
      // Stop the loop and cancel any in-flight pass (clears its timeout) while
      // the manager is still alive, before tearing it down.
      autoConnectLoopRef.current = false;
      autoScanStopRef.current = null;
      activeScanStopRef.current?.();
      activeScanStopRef.current = null;
      subscription?.remove();
      ignoreBleRejection(manager?.stopDeviceScan());
      ignoreBleRejection(manager?.destroy());
      managerRef.current = null;
    };
  }, []);

  // ── Phase helpers ────────────────────────────────────────────

  /** Label for "not connected, but actively working on it". */
  const seekingPhase = useCallback(
    (): ConnectionPhase => (hasConnectedRef.current ? 'reconnecting' : 'scanning'),
    [],
  );

  /** The phase to settle on whenever an attempt or a scan pass finishes. */
  const derivePhase = useCallback((): ConnectionPhase => {
    if (connectedDeviceRef.current) return 'connected';
    if (autoConnectLoopRef.current || activeScanStopRef.current) return seekingPhase();
    return 'idle';
  }, [seekingPhase]);

  // ── Scan core ────────────────────────────────────────────────

  /**
   * Runs one paddle-filtered scan pass and returns its stop function (null when
   * the native manager isn't available).
   *
   * Both callers — the manual picker and the auto-connect loop — go through
   * here, and any pass already running is torn down first, so two
   * `startDeviceScan` calls can never be registered at the same time (iOS
   * CoreBluetooth rate-limits/warns on that, and BLE-PLX surfaces it as an
   * opaque scan error).
   */
  const beginFilteredScan = useCallback(
    ({ timeoutMs, onMatch, onError, onStop }: FilteredScanHandlers): (() => void) | null => {
      const manager = managerRef.current;
      if (!manager) return null;

      activeScanStopRef.current?.();

      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        if (activeScanStopRef.current === stop) activeScanStopRef.current = null;
        ignoreBleRejection(manager.stopDeviceScan());
        onStop?.();
      };

      activeScanStopRef.current = stop;
      timer = setTimeout(stop, timeoutMs);

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
              onError?.(bleError);
              stop();
              return;
            }

            if (!device) return;

            // Second layer: covers the name-only match case (a UUID-based scan
            // filter won't surface those), and is a no-op safety net otherwise.
            if (!isPaddleDevice(device)) return;

            onMatch(device);
          },
        ),
      );

      return stop;
    },
    [],
  );

  /**
   * One scan pass for the auto-connect loop. Resolves with the first device
   * that passes the paddle filter, or null when the pass times out, errors, or
   * is cancelled (`stopAutoConnectLoop`, or a manual scan taking the radio).
   */
  const scanOnceForMatch = useCallback(
    (timeoutMs: number): Promise<Device | null> =>
      new Promise((resolve) => {
        // Held in an object so the value survives the callback boundary.
        const found: { device: Device | null } = { device: null };
        let stopPass: (() => void) | null = null;

        stopPass = beginFilteredScan({
          timeoutMs,
          onMatch: (device) => {
            found.device = device;
            stopPass?.();
          },
          onError: (bleError) => {
            console.warn('[BLE] Auto-connect scan error:', bleError.message);
          },
          onStop: () => {
            autoScanStopRef.current = null;
            resolve(found.device);
          },
        });

        if (!stopPass) {
          resolve(null);
          return;
        }
        autoScanStopRef.current = stopPass;
      }),
    [beginFilteredScan],
  );

  // ── Scan (manual picker) ─────────────────────────────────────

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
    if (!connectedDeviceRef.current) setConnectionPhase(seekingPhase());

    beginFilteredScan({
      timeoutMs: SCAN_TIMEOUT_MS,
      onMatch: (device) => {
        const discovered = toDiscoveredDevice(device);
        setDevices((prev) => {
          // Deduplicate by ID, update RSSI if already present
          const existing = prev.findIndex((d) => d.id === discovered.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = discovered;
            return updated;
          }
          return [...prev, discovered];
        });
      },
      onError: (bleError) => {
        console.error('[BLE] Scan error:', bleError.message);
        setError(bleError.message);
      },
      onStop: () => {
        setIsScanning(false);
        setConnectionPhase(derivePhase());
      },
    });
  }, [adapterState, beginFilteredScan, derivePhase, seekingPhase]);

  const stopScan = useCallback(() => {
    activeScanStopRef.current?.();
    setIsScanning(false);
  }, []);

  // ── Connect ──────────────────────────────────────────────────

  const connectToDevice = useCallback(
    async (device: DiscoveredDevice) => {
      const manager = managerRef.current;
      if (!manager) return;

      // Any connect attempt — manual or automatic — re-arms auto-reconnect.
      intentionalDisconnectRef.current = false;

      // Free the radio before connecting
      activeScanStopRef.current?.();
      setIsScanning(false);
      setError(null);
      setConnectionPhase('connecting');

      try {
        const connected = await device.raw.connect({ timeout: 10_000 });
        await connected.discoverAllServicesAndCharacteristics();

        // Monitor disconnection
        connected.onDisconnected((disconnectError) => {
          console.log('[BLE] Device disconnected:', device.name ?? device.id);
          connectedDeviceRef.current = null;
          setConnectedDevice(null);
          if (disconnectError) {
            setError(`Device disconnected: ${disconnectError.message}`);
          }

          if (intentionalDisconnectRef.current) {
            // The user asked for this — stay disconnected until they act.
            setConnectionPhase('idle');
            return;
          }

          // Unexpected drop (paddle powered off, watchdog reboot, out of
          // range) → start hunting for it again. Trigger point 2.
          setConnectionPhase(seekingPhase());
          runAutoConnectRef.current();
        });

        const next: DiscoveredDevice = {
          id: connected.id,
          name: connected.name ?? connected.localName ?? device.name,
          rssi: device.rssi,
          serviceUUIDs: connected.serviceUUIDs ?? device.serviceUUIDs,
          raw: connected,
        };

        connectedDeviceRef.current = next;
        hasConnectedRef.current = true;
        setConnectedDevice(next);
        setConnectionPhase('connected');
      } catch (err) {
        const message = err instanceof BleError ? err.message : 'Failed to connect to device.';
        console.error('[BLE] Connection error:', message);
        setError(message);
        setConnectionPhase(derivePhase());
      }
    },
    [derivePhase, seekingPhase],
  );

  // ── Auto-connect / auto-reconnect ────────────────────────────

  const stopAutoConnectLoop = useCallback(() => {
    autoConnectLoopRef.current = false;
    autoConnectGenerationRef.current += 1;
    // Cancel the loop's own in-flight pass so the radio frees up immediately
    // instead of at the end of its 15s timeout.
    autoScanStopRef.current?.();
    autoScanStopRef.current = null;
  }, []);

  /**
   * Scan-and-connect until the paddle is found. Foreground-only by design (see
   * memory-bank/PLAN-ble-auto-reconnect.md) — this runs while the app is open
   * and the adapter is on, and exits as soon as we connect, the user
   * disconnects deliberately, or the manual picker takes over.
   */
  const runAutoConnectLoop = useCallback(async () => {
    if (autoConnectLoopRef.current) return; // already hunting
    if (connectedDeviceRef.current) return; // nothing to do
    if (intentionalDisconnectRef.current) return; // user said stop
    if (!managerRef.current) return;
    if (adapterStateRef.current !== BleState.PoweredOn) return;

    autoConnectLoopRef.current = true;
    autoConnectGenerationRef.current += 1;
    const generation = autoConnectGenerationRef.current;
    /** False as soon as this run is stopped or superseded by a newer one. */
    const isCurrentRun = () =>
      autoConnectLoopRef.current && autoConnectGenerationRef.current === generation;

    setConnectionPhase(seekingPhase());

    try {
      while (
        isCurrentRun() &&
        !intentionalDisconnectRef.current &&
        !connectedDeviceRef.current &&
        managerRef.current &&
        adapterStateRef.current === BleState.PoweredOn
      ) {
        const found = await scanOnceForMatch(SCAN_TIMEOUT_MS);

        // The pass may have been cancelled while it was in flight.
        if (!isCurrentRun() || intentionalDisconnectRef.current) break;

        if (found) {
          // connectToDevice owns the 'connecting' → 'connected' transition.
          await connectToDevice(toDiscoveredDevice(found));
          if (connectedDeviceRef.current) break; // success
        }

        if (!isCurrentRun()) break;
        await sleep(AUTO_RETRY_DELAY_MS);
      }
    } finally {
      // Only tidy up if we're still the live run — a newer loop owns the flag
      // and the phase otherwise.
      if (autoConnectGenerationRef.current === generation) {
        autoConnectLoopRef.current = false;
        setConnectionPhase(derivePhase());
      }
    }
  }, [connectToDevice, derivePhase, scanOnceForMatch, seekingPhase]);

  // Late-bind for the onDisconnected handler above (trigger point 2).
  useEffect(() => {
    runAutoConnectRef.current = runAutoConnectLoop;
  }, [runAutoConnectLoop]);

  // Trigger point 1: the adapter becomes usable → start hunting. Covers a cold
  // app launch with the paddle already advertising, and Bluetooth being
  // switched back on mid-session.
  useEffect(() => {
    if (adapterState === BleState.PoweredOn) {
      void runAutoConnectLoop();
      return;
    }
    // Radio unusable — nothing to hunt with.
    stopAutoConnectLoop();
    if (!connectedDeviceRef.current) setConnectionPhase('idle');
  }, [adapterState, runAutoConnectLoop, stopAutoConnectLoop]);

  // ── Disconnect ───────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    // Mark intent BEFORE tearing the link down: onDisconnected fires from this
    // and must not read it as an unexpected drop.
    intentionalDisconnectRef.current = true;
    stopAutoConnectLoop();
    setConnectionPhase('idle');

    const device = connectedDeviceRef.current;
    if (!device) return;

    try {
      const isConnected = await device.raw.isConnected();
      if (isConnected) {
        await device.raw.cancelConnection();
      }
    } catch (err) {
      console.error('[BLE] Disconnect error:', err);
    } finally {
      connectedDeviceRef.current = null;
      setConnectedDevice(null);
      setConnectionPhase('idle');
    }
  }, [stopAutoConnectLoop]);

  // ── Session control (forward-declared characteristic) ────────

  const writeSessionState = useCallback(
    async (active: boolean): Promise<void> => {
      const device = connectedDevice?.raw;
      if (!device) return;
      try {
        const payload = Buffer.from([active ? 1 : 0]).toString('base64');
        await device.writeCharacteristicWithResponseForService(
          PADDLE_SERVICE_UUID,
          SESSION_CONTROL_CHAR_UUID,
          payload,
        );
      } catch {
        // The session-control characteristic doesn't exist on today's firmware
        // (forward declaration only). This MUST fail silent — never interrupt
        // the working session flow. Real write/notify + a de-dup guard for the
        // future hardware button lands when the firmware side is picked up.
      }
    },
    [connectedDevice],
  );

  // ── Context value ────────────────────────────────────────────

  const value = useMemo<BluetoothContextValue>(
    () => ({
      adapterState,
      isScanning,
      devices,
      connectedDevice,
      connectionPhase,
      startScan,
      stopScan,
      connectToDevice,
      disconnect,
      runAutoConnectLoop,
      stopAutoConnectLoop,
      writeSessionState,
      error,
    }),
    [
      adapterState,
      isScanning,
      devices,
      connectedDevice,
      connectionPhase,
      startScan,
      stopScan,
      connectToDevice,
      disconnect,
      runAutoConnectLoop,
      stopAutoConnectLoop,
      writeSessionState,
      error,
    ],
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
