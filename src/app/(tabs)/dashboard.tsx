import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { State as BleState } from 'react-native-ble-plx';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { Colors } from '@/constants/colors';
import { Radius, Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TOUR_PARAM_VALUE } from '@/constants/tourSteps';
import { useAuth } from '@/hooks/useAuth';
import { isConnectedToPaddle, useBluetooth } from '@/hooks/useBluetooth';
import { useSession } from '@/hooks/useSession';
import { useTour } from '@/hooks/useTour';
import { TourTarget } from '@/components/tour/TourTarget';

// ── Helpers ────────────────────────────────────────────────────────
function rssiToSignalBars(rssi: number | null): number {
  if (rssi === null) return 0;
  if (rssi >= -50) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -80) return 2;
  return 1;
}

/** Elapsed session time as m:ss (or h:mm:ss past an hour). */
function formatElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function rssiLabel(rssi: number | null): string {
  const bars = rssiToSignalBars(rssi);
  if (bars >= 4) return 'Excellent';
  if (bars >= 3) return 'Good';
  if (bars >= 2) return 'Fair';
  if (bars >= 1) return 'Weak';
  return '—';
}

// ── Component ──────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { profile } = useAuth();
  const {
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
    error: bleError,
  } = useBluetooth();

  const {
    sessionState,
    hitCount,
    startedAtMs,
    busy: sessionBusy,
    startSession,
    endSession,
  } = useSession();

  const [modalVisible, setModalVisible] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // ── First-run tour trigger ─────────────────────────────────────
  // Only the welcome screen's post-onboarding redirect carries `tour=1`, so a
  // normal relaunch (Auth Gate → /(tabs)/dashboard, no param) never replays it.
  // No AsyncStorage, no extra Firestore field.
  const { tour: tourParam } = useLocalSearchParams<{ tour?: string }>();
  const { start: startTour, notifyAction } = useTour();

  // useLayoutEffect, not useEffect: this runs before the first paint, so the
  // user never sees an undimmed, interactive dashboard flash behind the tour.
  useLayoutEffect(() => {
    if (tourParam === TOUR_PARAM_VALUE) startTour();
  }, [tourParam, startTour]);

  const isConnected = isConnectedToPaddle(connectedDevice);
  const isSessionActive = sessionState === 'active';

  // The tour's start/end-session steps advance on the real thing happening.
  // This screen owns the session lifecycle (`useSession` is per-instance state,
  // not a context), so the report has to come from here. `notifyAction` is
  // identity-stable and ignores anything the current step isn't waiting on.
  useEffect(() => {
    if (isSessionActive) {
      notifyAction('session-start');
      return;
    }
    // Wait out `busy` on the way down: endSession flips the state to idle
    // immediately but the Firestore write lands a moment later, and the tour's
    // next stop is History — which reads once on mount and would miss the
    // session that was just recorded.
    if (!sessionBusy) notifyAction('session-end');
  }, [isSessionActive, sessionBusy, notifyAction]);

  // "Working on it" — the auto-connect loop or a manual scan is in flight, so
  // the card shows a live third state instead of a flat "Not Connected".
  const isSeeking =
    !isConnected &&
    (connectionPhase === 'scanning' ||
      connectionPhase === 'connecting' ||
      connectionPhase === 'reconnecting');

  const paddleStatus = isConnected
    ? 'Connected'
    : connectionPhase === 'connecting'
      ? 'Connecting…'
      : connectionPhase === 'reconnecting'
        ? 'Reconnecting…'
        : connectionPhase === 'scanning'
          ? 'Searching…'
          : 'Not Connected';

  // Pulse the status dot while hunting for the paddle.
  const dotPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isSeeking) {
      dotPulse.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 0.25,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isSeeking, dotPulse]);

  // Tick once a second while recording to drive the elapsed-time readout.
  useEffect(() => {
    if (!isSessionActive) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isSessionActive]);

  const elapsedSec =
    isSessionActive && startedAtMs
      ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
      : 0;

  const handleOpenScanner = useCallback(() => {
    // Hand the radio over to the manual picker so the two scans never overlap.
    stopAutoConnectLoop();
    setModalVisible(true);
    if (adapterState === BleState.PoweredOn) {
      startScan();
    }
  }, [adapterState, startScan, stopAutoConnectLoop]);

  const handleCloseScanner = useCallback(() => {
    stopScan();
    setModalVisible(false);
    setConnectingId(null);
    // Resume hunting. Self-guarding — no-ops if we're connected or the user
    // disconnected on purpose.
    runAutoConnectLoop();
  }, [runAutoConnectLoop, stopScan]);

  const handleConnect = useCallback(
    async (device: (typeof devices)[number]) => {
      setConnectingId(device.id);
      await connectToDevice(device);
      setConnectingId(null);
      setModalVisible(false);
      // Only does anything if the connect failed — otherwise we're connected
      // and the loop no-ops.
      runAutoConnectLoop();
    },
    [connectToDevice, runAutoConnectLoop],
  );

  const handleDisconnect = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  const handleToggleSession = useCallback(() => {
    // Errors are handled inside the hook; fire-and-forget from the UI.
    if (isSessionActive) {
      void endSession();
    } else {
      void startSession();
    }
  }, [isSessionActive, startSession, endSession]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Hey, {profile?.name ?? 'Player'} 👋
        </Text>
        <Text style={styles.subtitle}>Ready to play?</Text>
      </View>

      {/* ── Status Cards ───────────────────────────────── */}
      <View style={styles.cards}>
        {/* Paddle Status */}
        <TourTarget id="paddle-status">
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Animated.View
                style={[
                  styles.statusDot,
                  isConnected
                    ? styles.statusOnline
                    : isSeeking
                      ? styles.statusSeeking
                      : styles.statusOffline,
                  isSeeking && { opacity: dotPulse },
                ]}
              />
              <Text style={styles.cardLabel}>PADDLE SENSOR</Text>
            </View>
            <Text
              style={[
                styles.cardValue,
                isConnected && styles.cardValueConnected,
                isSeeking && styles.cardValueSeeking,
              ]}
            >
              {paddleStatus}
            </Text>
            <Text style={styles.cardHint}>
              {isConnected
                ? connectedDevice?.name ?? 'PaddlePal Device'
                : isSeeking
                  ? 'Looking for your paddle…'
                  : 'Pair your PaddlePal to start tracking'}
            </Text>
          </View>
        </TourTarget>

        {/* Session Control */}
        <TourTarget id="session-card">
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.statusDot,
                  isSessionActive ? styles.statusOnline : styles.statusOffline,
                ]}
              />
              <Text style={styles.cardLabel}>SESSION</Text>
            </View>
            <Text
              style={[
                styles.cardValue,
                isSessionActive && styles.cardValueConnected,
              ]}
            >
              {isSessionActive ? formatElapsed(elapsedSec) : 'Ready'}
            </Text>
            <Text style={styles.cardHint}>
              {isSessionActive
                ? `Recording • ${hitCount} ${hitCount === 1 ? 'shot' : 'shots'}`
                : isConnected
                  ? 'Start a session to record your shots'
                  : 'Connect your paddle to start a session'}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.sessionButton,
                isSessionActive
                  ? styles.endSessionButton
                  : styles.startSessionButton,
                !isSessionActive &&
                (!isConnected || sessionBusy) &&
                styles.sessionButtonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleToggleSession}
              disabled={sessionBusy || (!isSessionActive && !isConnected)}
            >
              {sessionBusy ? (
                <ActivityIndicator
                  size="small"
                  color={isSessionActive ? Colors.text : Colors.onPrimary}
                />
              ) : (
                <Text
                  style={[
                    isSessionActive
                      ? styles.endSessionButtonText
                      : styles.startSessionButtonText,
                    !isSessionActive &&
                    !isConnected &&
                    styles.sessionButtonTextDisabled,
                  ]}
                >
                  {isSessionActive ? 'End Session' : 'Start Session'}
                </Text>
              )}
            </Pressable>
          </View>
        </TourTarget>
      </View>

      {/* ── Quick Actions ──────────────────────────────── */}
      <View style={styles.quickActions}>
        {/* Wraps both states: the tour spotlights Connect Paddle, and the
            button becomes Disconnect Paddle the moment the user pairs. */}
        <TourTarget id="connect-paddle">
          {isConnected ? (
            <Pressable
              style={({ pressed }) => [
                styles.disconnectButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleDisconnect}
            >
              <Text style={styles.disconnectButtonText}>Disconnect Paddle</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.connectButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleOpenScanner}
            >
              <View style={styles.pulseRing} />
              <Text style={styles.connectButtonText}>Connect Paddle</Text>
            </Pressable>
          )}
        </TourTarget>
      </View>

      {/* ── Bluetooth Scanner Modal ────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={handleCloseScanner}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Handle bar */}
            <View style={styles.modalHandle} />

            {/* Title row */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bluetooth Devices</Text>
              <Pressable
                onPress={handleCloseScanner}
                hitSlop={12}
              >
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>

            {/* Status / Error */}
            {adapterState !== BleState.PoweredOn && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>
                  {adapterState === BleState.PoweredOff
                    ? '⚠ Bluetooth is turned off. Enable it in Settings.'
                    : adapterState === BleState.Unauthorized
                      ? '⚠ Bluetooth permission not granted. Check Settings.'
                      : '⚠ Bluetooth is unavailable.'}
                </Text>
              </View>
            )}

            {bleError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{bleError}</Text>
              </View>
            )}

            {/* Scanning indicator */}
            {isScanning && (
              <View style={styles.scanningRow}>
                <ActivityIndicator size="small" color={Colors.bluetooth} />
                <Text style={styles.scanningText}>Scanning for devices…</Text>
              </View>
            )}

            {/* Device list */}
            <FlatList
              data={devices}
              keyExtractor={(item) => item.id}
              style={styles.deviceList}
              contentContainerStyle={
                devices.length === 0 ? styles.emptyListContainer : undefined
              }
              ListEmptyComponent={
                !isScanning ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>
                      {adapterState === BleState.PoweredOn
                        ? 'No devices found. Tap Rescan to try again.'
                        : 'Enable Bluetooth to search for devices.'}
                    </Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => {
                const isConnecting = connectingId === item.id;
                const bars = rssiToSignalBars(item.rssi);

                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.deviceRow,
                      pressed && styles.deviceRowPressed,
                    ]}
                    onPress={() => handleConnect(item)}
                    disabled={isConnecting}
                  >
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>
                        {item.name ?? 'Unknown Device'}
                      </Text>
                      <Text style={styles.deviceId}>
                        {item.id}
                      </Text>
                    </View>

                    <View style={styles.deviceMeta}>
                      {isConnecting ? (
                        <ActivityIndicator
                          size="small"
                          color={Colors.bluetooth}
                        />
                      ) : (
                        <>
                          {/* RSSI signal strength bars */}
                          <View style={styles.signalBars}>
                            {[1, 2, 3, 4].map((level) => (
                              <View
                                key={level}
                                style={[
                                  styles.signalBar,
                                  { height: 4 + level * 4 },
                                  bars >= level
                                    ? styles.signalBarActive
                                    : styles.signalBarInactive,
                                ]}
                              />
                            ))}
                          </View>
                          <Text style={styles.signalLabel}>
                            {rssiLabel(item.rssi)}
                          </Text>
                        </>
                      )}
                    </View>
                  </Pressable>
                );
              }}
            />

            {/* Footer actions */}
            <View style={styles.modalFooter}>
              <Pressable
                style={({ pressed }) => [
                  styles.rescanButton,
                  pressed && styles.buttonPressed,
                  isScanning && styles.rescanButtonDisabled,
                ]}
                onPress={startScan}
                disabled={isScanning || adapterState !== BleState.PoweredOn}
              >
                <Text
                  style={[
                    styles.rescanButtonText,
                    isScanning && styles.rescanButtonTextDisabled,
                  ]}
                >
                  {isScanning ? 'Scanning…' : 'Rescan'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },

  // Header
  header: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  greeting: {
    ...Typography.headlineLgMobile,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.bodyLg,
    color: Colors.onSurfaceVariant,
  },

  // Cards
  cards: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  cardLabel: {
    ...Typography.labelCaps,
    color: Colors.muted,
  },
  cardValue: {
    ...Typography.dataDisplay,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  cardValueConnected: {
    color: Colors.success,
  },
  // Action Blue is DESIGN.md's connectivity/syncing colour — used here for the
  // in-between "searching / reconnecting" state.
  cardValueSeeking: {
    color: Colors.bluetooth,
  },
  cardHint: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  statusOnline: {
    backgroundColor: Colors.success,
  },
  statusSeeking: {
    backgroundColor: Colors.bluetooth,
  },
  statusOffline: {
    backgroundColor: Colors.muted,
  },

  // Quick Actions
  quickActions: {
    marginBottom: Spacing.xl,
  },
  connectButton: {
    backgroundColor: Colors.secondaryContainer,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  pulseRing: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.bluetooth,
    opacity: 0.3,
  },
  connectButtonText: {
    ...Typography.bodyLg,
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  disconnectButton: {
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectButtonText: {
    ...Typography.bodyLg,
    color: Colors.error,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.7,
  },

  // Session control button (inside the Session card)
  sessionButton: {
    marginTop: Spacing.md,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startSessionButton: {
    backgroundColor: Colors.primary,
  },
  startSessionButtonText: {
    ...Typography.bodyLg,
    color: Colors.onPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  endSessionButton: {
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  endSessionButtonText: {
    ...Typography.bodyLg,
    color: Colors.text,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  sessionButtonDisabled: {
    backgroundColor: Colors.surfaceContainerHigh,
    opacity: 0.6,
  },
  sessionButtonTextDisabled: {
    color: Colors.muted,
  },

  // ── Modal ────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surfaceContainer,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.glassBorder,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.muted,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    ...Typography.headlineMd,
    color: Colors.text,
  },
  modalClose: {
    ...Typography.headlineMd,
    color: Colors.muted,
    fontSize: 20,
  },

  // Warning / Error banners
  warningBanner: {
    backgroundColor: 'rgba(255, 180, 0, 0.12)',
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.md,
  },
  warningText: {
    ...Typography.bodyMd,
    color: '#FFB400',
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 180, 171, 0.12)',
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Typography.bodyMd,
    color: Colors.error,
  },

  // Scanning
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  scanningText: {
    ...Typography.bodyMd,
    color: Colors.bluetooth,
  },

  // Device list
  deviceList: {
    flexGrow: 0,
  },
  emptyListContainer: {
    paddingVertical: Spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  emptyStateText: {
    ...Typography.bodyMd,
    color: Colors.muted,
    textAlign: 'center',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  deviceRowPressed: {
    backgroundColor: Colors.surfaceContainerHighest,
  },
  deviceInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  deviceName: {
    ...Typography.bodyLg,
    color: Colors.text,
    marginBottom: 2,
  },
  deviceId: {
    ...Typography.labelCaps,
    color: Colors.muted,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: 'none',
  },
  deviceMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },

  // Signal strength bars
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  signalBar: {
    width: 4,
    borderRadius: 1,
  },
  signalBarActive: {
    backgroundColor: Colors.bluetooth,
  },
  signalBarInactive: {
    backgroundColor: Colors.surfaceBright,
  },
  signalLabel: {
    ...Typography.labelCaps,
    color: Colors.muted,
    fontSize: 10,
    marginLeft: Spacing.xs,
  },

  // Modal footer
  modalFooter: {
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  rescanButton: {
    backgroundColor: Colors.secondaryContainer,
    borderRadius: Radius.lg,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
  },
  rescanButtonDisabled: {
    opacity: 0.5,
  },
  rescanButtonText: {
    ...Typography.bodyLg,
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  rescanButtonTextDisabled: {
    color: Colors.muted,
  },
});
