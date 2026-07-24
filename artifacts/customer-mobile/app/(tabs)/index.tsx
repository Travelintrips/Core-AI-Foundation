import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, wsBase } from '@/lib/api';

type WorkspaceSummary = {
  clientName: string;
  activeProjects: number;
  waitingReview: number;
  completedProjects: number;
  downloadCount: number;
  outstandingBalance: number;
  outstandingCurrency: string;
  invoiceCount: number;
};

type WorkspaceNotification = {
  key: string;
  category: string;
  title: string;
  message: string;
  projectNumber: string | null;
  isRead: boolean;
  createdAt: string;
};

function useWorkspaceSummary(token: string) {
  return useQuery({
    queryKey: ['workspace', 'summary', token],
    queryFn: ({ signal }) =>
      apiFetch<WorkspaceSummary>(`${wsBase(token)}/summary`, { signal }),
    enabled: !!token,
    staleTime: 30_000,
  });
}

function useWorkspaceNotifications(token: string) {
  return useQuery({
    queryKey: ['workspace', 'notifications', token],
    queryFn: ({ signal }) =>
      apiFetch<WorkspaceNotification[]>(`${wsBase(token)}/notifications`, { signal }),
    enabled: !!token,
    staleTime: 30_000,
  });
}

function StatCard({
  label, value, icon, accent, colors,
}: {
  label: string;
  value: string | number;
  icon: string;
  accent: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[statStyles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
      <View style={[statStyles.iconBg, { backgroundColor: accent + '18' }]}>
        <Ionicons name={icon as never} size={18} color={accent} />
      </View>
      <Text style={[statStyles.value, { color: colors.foreground }]}>{value}</Text>
      <Text style={[statStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  iconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  value: {
    fontSize: 22,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

function NotificationItem({ item, colors }: { item: WorkspaceNotification; colors: ReturnType<typeof useColors> }) {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(item.createdAt).getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return 'Just now';
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }, [item.createdAt]);

  const categoryColor = (c: string) => {
    if (c === 'review') return colors.gold;
    if (c === 'delivery' || c === 'complete') return colors.emerald;
    if (c === 'payment') return colors.cyan;
    return colors.primary;
  };

  return (
    <View style={[notifStyles.row, { borderBottomColor: colors.border }]}>
      <View style={[notifStyles.dot, { backgroundColor: categoryColor(item.category) }]} />
      <View style={{ flex: 1 }}>
        <Text style={[notifStyles.title, { color: colors.foreground }]}>{item.title}</Text>
        <Text style={[notifStyles.msg, { color: colors.mutedForeground }]} numberOfLines={2}>
          {item.message}
        </Text>
      </View>
      <Text style={[notifStyles.time, { color: colors.mutedForeground }]}>{timeAgo}</Text>
    </View>
  );
}

const notifStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  title: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  msg: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
});

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token, clientName } = useAuth();

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useWorkspaceSummary(token ?? '');

  const {
    data: notifications,
    isLoading: notifsLoading,
    refetch: refetchNotifs,
  } = useWorkspaceNotifications(token ?? '');

  const isRefreshing = summaryLoading || notifsLoading;

  const onRefresh = () => {
    refetchSummary();
    refetchNotifs();
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const styles = makeStyles(colors);

  const displayName = summary?.clientName ?? clientName ?? 'Customer';
  const firstName = displayName.split(' ')[0];

  return (
    <ScrollView
      style={[styles.root]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 20 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good day,</Text>
          <Text style={styles.name}>{firstName}</Text>
        </View>
        <View style={[styles.avatar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {firstName.charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsGrid}>
        {summaryLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <StatCard
                label="Active"
                value={summary?.activeProjects ?? 0}
                icon="layers-outline"
                accent={colors.cyan}
                colors={colors}
              />
              <StatCard
                label="Review"
                value={summary?.waitingReview ?? 0}
                icon="eye-outline"
                accent={colors.gold}
                colors={colors}
              />
            </View>
            <View style={styles.statsRow}>
              <StatCard
                label="Completed"
                value={summary?.completedProjects ?? 0}
                icon="checkmark-circle-outline"
                accent={colors.emerald}
                colors={colors}
              />
              <StatCard
                label="Downloads"
                value={summary?.downloadCount ?? 0}
                icon="cloud-download-outline"
                accent={colors.primary}
                colors={colors}
              />
            </View>
          </>
        )}
      </View>

      {/* Notifications */}
      <View style={[styles.section, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          {(notifications?.length ?? 0) > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{notifications!.length}</Text>
            </View>
          )}
        </View>

        {notifsLoading ? (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: 20 }} />
        ) : !notifications?.length ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No new notifications</Text>
          </View>
        ) : (
          notifications.slice(0, 5).map((n) => (
            <NotificationItem key={n.key} item={n} colors={colors} />
          ))
        )}
      </View>

      {/* Outstanding balance */}
      {summary && summary.outstandingBalance > 0 && (
        <View style={[styles.balanceCard, { backgroundColor: '#1A1000', borderColor: colors.gold + '40' }]}>
          <Ionicons name="receipt-outline" size={18} color={colors.gold} />
          <Text style={[styles.balanceText, { color: colors.gold }]}>
            Outstanding balance: {summary.outstandingCurrency} {summary.outstandingBalance.toLocaleString()}
          </Text>
        </View>
      )}

      <View style={{ height: Platform.OS === 'web' ? 34 : insets.bottom + 16 }} />
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: 20,
      gap: 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    greeting: {
      color: colors.mutedForeground,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
    name: {
      color: colors.foreground,
      fontSize: 26,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      letterSpacing: -0.5,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 18,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
    },
    statsGrid: {
      gap: 10,
    },
    statsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    loadingRow: {
      paddingVertical: 30,
      alignItems: 'center',
    },
    section: {
      borderRadius: colors.radius + 4,
      borderWidth: 1,
      padding: 16,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    sectionTitle: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
    },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    badgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
    },
    empty: {
      paddingVertical: 24,
      alignItems: 'center',
      gap: 8,
    },
    emptyText: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
    balanceCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: colors.radius,
      borderWidth: 1,
      padding: 14,
    },
    balanceText: {
      fontSize: 14,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
    },
  });
}
