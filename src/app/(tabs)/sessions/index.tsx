import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { TourTarget } from '@/components/tour/TourTarget';
import { useSessions } from '@/hooks/useSessions';
import { formatSessionDate, formatDuration } from '@/lib/format';
import { Session } from '@/types';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

export default function SessionsScreen() {
  const { sessions, loading, refreshing, refresh } = useSessions();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Session History</Text>
        <Pressable
          onPress={refresh}
          disabled={loading || refreshing}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Refresh sessions"
          style={({ pressed }) => [
            styles.refreshButton,
            (pressed || refreshing) && styles.refreshButtonPressed,
          ]}
        >
          <SymbolView
            name="arrow.clockwise"
            tintColor={Colors.primary}
            size={20}
          />
        </Pressable>
      </View>

      {loading ? (
        <TourTarget id="history-list" style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </TourTarget>
      ) : (
        <FlatList
          style={styles.listWrap}
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <TourTarget id="history-list" style={styles.center}>
              <Text style={styles.empty}>No sessions recorded yet</Text>
            </TourTarget>
          }
          renderItem={({ item, index }) => {
            const card = (
              <SessionCard
                session={item}
                onPress={() => router.push(`/sessions/${item.id}`)}
              />
            );
            return index === 0 ? (
              <TourTarget id="history-list">{card}</TourTarget>
            ) : (
              card
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function SessionCard({
  session,
  onPress,
}: {
  session: Session;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardInfo}>
        <Text style={styles.cardDate}>
          {formatSessionDate(session.startedAt)}
        </Text>
        <Text style={styles.cardMeta}>
          {session.status === 'complete'
            ? formatDuration(session.durationSec)
            : 'In progress'}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...Typography.headlineLgMobile,
    color: Colors.text,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.glassBackground,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  refreshButtonPressed: {
    opacity: 0.6,
  },
  // Wrapper for the tour target — takes the same remaining space the list did.
  listWrap: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.xxl,
  },
  empty: {
    ...Typography.bodyMd,
    color: Colors.muted,
  },
  // Leave room for the floating pill tab bar.
  listContent: {
    paddingBottom: 120,
    gap: Spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.glassBackground,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardInfo: {
    gap: Spacing.xs,
  },
  cardDate: {
    ...Typography.bodyLg,
    color: Colors.text,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontWeight: '700',
  },
  cardMeta: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
  },
  chevron: {
    ...Typography.headlineMd,
    color: Colors.muted,
    fontSize: 28,
  },
});
