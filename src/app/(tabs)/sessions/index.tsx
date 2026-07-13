import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useSessions } from '@/hooks/useSessions';
import { formatSessionDate, formatDuration } from '@/lib/format';
import { Session } from '@/types';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing, Radius } from '@/constants/spacing';

export default function SessionsScreen() {
  const { sessions, loading } = useSessions();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Session History</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No sessions recorded yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              onPress={() => router.push(`/sessions/${item.id}`)}
            />
          )}
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
        <Text style={styles.cardMeta}>{formatDuration(session.durationSec)}</Text>
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
  },
  title: {
    ...Typography.headlineLgMobile,
    color: Colors.text,
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
