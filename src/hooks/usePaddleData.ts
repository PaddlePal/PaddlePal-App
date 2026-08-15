import { useEffect, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import type { BleError, Characteristic, Subscription } from 'react-native-ble-plx';

import { useBluetooth } from '@/hooks/useBluetooth';

// ── BLE identity (mirrors firmware/firmware.ino) ──────────────────────────────
// Kept local to this demo hook so nothing leaks into src/constants/ — the live
// demo is intentionally disposable (see PLAN-live-demo-and-game-pipeline.md,
// Track A). The service UUID matches PADDLE_SERVICE_UUID; the characteristic is
// the FSR notify stream added in firmware.ino (the ...2f characteristic).
const PADDLE_SERVICE_UUID = '9590ad2d-fd81-4688-9d3b-65ac36caca3a';
const FSR_CHAR_UUID = '9590ad2f-fd81-4688-9d3b-65ac36caca3a';

export type ZoneId = 1 | 2 | 3 | 4;

export interface PaddleHit {
  /** Zone 1–4 (upper 16 bits of the FIFO word). */
  zone: ZoneId;
  /** Lower-16-bit payload: peak FSR force, 0–1023, for every zone. */
  payload: number;
  /**
   * Monotonic receipt timestamp. The UI keys its flash animation on this so
   * two consecutive hits on the SAME zone still re-trigger the glow.
   */
  ts: number;
}

export type ZoneCounts = Record<ZoneId, number>;

const EMPTY_COUNTS: ZoneCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

interface PaddleData {
  /** Most recent decoded hit, or null before the first one. */
  lastHit: PaddleHit | null;
  /** Rolling per-zone hit tally for the current connection. */
  zoneCounts: ZoneCounts;
}

interface UsePaddleDataOptions {
  /**
   * Invoked for every decoded FSR hit, in receipt order. Lets a session buffer
   * (see `useSession`) tap the same single BLE monitor that feeds the live UI,
   * instead of opening a second `monitorCharacteristicForService` on the same
   * notify stream. Held in a ref so passing a new callback identity each render
   * doesn't tear down and rebuild the monitor.
   */
  onHit?: (hit: PaddleHit) => void;
}

/**
 * Zone 5 is deliberately out of range: the firmware stopped emitting it on
 * 2026-08-06. A paddle still running an older build will emit zone-5 packets,
 * and `decodeHit` now drops them as malformed rather than silently recording a
 * zone the rest of the app no longer models. Symptom of a stale flash: hits
 * near the paddle edges vanish instead of appearing on the Live face.
 */
function isZoneId(zone: number): zone is ZoneId {
  return zone >= 1 && zone <= 4;
}

/**
 * Decodes one 4-byte FSR notify packet (base64) into a hit.
 *
 * The firmware writes the raw inter-core FIFO word little-endian (RP2040):
 * zone in the upper 16 bits, payload in the lower 16. Returns null for a
 * malformed frame or an out-of-range zone.
 *
 * ⚠️ Byte order is little-endian on the MCU side; verify BLE-PLX delivery
 * order once against Serial output on the first hardware test — if reversed,
 * flip `readUInt32LE` to `readUInt32BE` (one line).
 */
function decodeHit(value: string | null | undefined): PaddleHit | null {
  if (!value) return null;
  const buf = Buffer.from(value, 'base64');
  if (buf.length < 4) return null;

  const word = buf.readUInt32LE(0);
  const zone = word >>> 16;
  const payload = word & 0xffff;
  if (!isZoneId(zone)) return null;

  return { zone, payload, ts: Date.now() };
}

/**
 * Subscribes to the paddle's live FSR hit stream over BLE and exposes the
 * latest hit plus a rolling per-zone tally. Pure JS/TS — no native module.
 *
 * Resubscribes whenever the connected device changes and resets its tallies,
 * so each connection is a fresh demo session. Tears the monitor down on
 * disconnect / unmount.
 */
export function usePaddleData(options: UsePaddleDataOptions = {}): PaddleData {
  const { onHit } = options;
  const { connectedDevice } = useBluetooth();
  const [lastHit, setLastHit] = useState<PaddleHit | null>(null);
  const [zoneCounts, setZoneCounts] = useState<ZoneCounts>(EMPTY_COUNTS);

  // Keep the latest onHit in a ref so the monitor effect below doesn't depend on
  // its identity (which would resubscribe the BLE notify on every render).
  const onHitRef = useRef(onHit);
  useEffect(() => {
    onHitRef.current = onHit;
  }, [onHit]);

  useEffect(() => {
    // Fresh device → fresh session.
    setLastHit(null);
    setZoneCounts(EMPTY_COUNTS);

    const device = connectedDevice?.raw;
    if (!device) return;

    let subscription: Subscription | null = null;
    try {
      // Services/characteristics were already discovered at connect time
      // (see useBluetooth.connectToDevice → discoverAllServicesAndCharacteristics).
      subscription = device.monitorCharacteristicForService(
        PADDLE_SERVICE_UUID,
        FSR_CHAR_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error) {
            // The monitor errors out when the device disconnects or on Fast
            // Refresh teardown — benign for this demo.
            console.warn('[Paddle] FSR monitor error:', error.message);
            return;
          }

          const hit = decodeHit(characteristic?.value);
          if (!hit) return;

          // Feed any session buffer first, then the live UI state.
          onHitRef.current?.(hit);

          setLastHit(hit);
          setZoneCounts((prev) => {
            const next: ZoneCounts = { ...prev };
            next[hit.zone] = prev[hit.zone] + 1;
            return next;
          });
        },
      );
    } catch (err) {
      console.warn('[Paddle] Failed to start FSR monitor:', err);
    }

    return () => {
      subscription?.remove();
    };
  }, [connectedDevice]);

  return { lastHit, zoneCounts };
}
