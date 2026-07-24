import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, wsBase } from '@/lib/api';

type WorkspaceProject = {
  projectNumber: string;
  kind: 'creative_project' | 'service_request';
  brandName: string;
  serviceName: string;
  packageName: string | null;
  currentStage: string;
  currentStageLabel: string;
  progressPercent: number;
  paymentStatus: string | null;
  filesUnlocked: boolean;
  reviewStatus: string | null;
  quotationStatus: string | null;
  quotationTotal: number | string | null;
  quotationCurrency: string | null;
  currency: string;
  total: number | string | null;
  createdAt: string;
  updatedAt: string;
  completionNotes: string | null;
  completionLinks: Array<{ label: string; url: string }> | null;
};

function useWorkspaceProjects(token: string, status?: string) {
  return useQuery({
    queryKey: ['workspace', 'projects', token, status],
    queryFn: ({ signal }) => {
      const qs = status ? `?status=${status}` : '';
      return apiFetch<WorkspaceProject[]>(`${wsBase(token)}/projects${qs}`, { signal });
    },
    enabled: !!token,
    staleTime: 20_000,
  });
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'review', label: 'Review' },
  { key: 'completed', label: 'Done' },
];

function statusColor(stage: string, colors: ReturnType<typeof useColors>): string {
  const s = stage?.toLowerCase() ?? '';
  if (s.includes('complete') || s.includes('done') || s.includes('delivered')) return colors.emerald;
  if (s.includes('review') || s.includes('waiting')) return colors.gold;
  if (s.includes('cancel') || s.includes('reject')) return colors.destructive;
  if (s.includes('payment') || s.includes('invoice')) return colors.cyan;
  return colors.primary;
}

function ProgressBar({ percent, accent }: { percent: number; accent: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={pbStyles.track}>
      <View style={[pbStyles.fill, { width: `${clamped}%` as never, backgroundColor: accent }]} />
    </View>
  );
}

const pbStyles = StyleSheet.create({
  track: {
    height: 4,
    backgroundColor: 'rgba(240,244,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});

function ProjectCard({
  project,
  colors,
}: {
  project: WorkspaceProject;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(false);
  const accent = statusColor(project.currentStage, colors);

  const dateStr = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <Pressable
      style={({ pressed }) => [
        projStyles.card,
        {
          backgroundColor: colors.surface1,
          borderColor: expanded ? accent + '40' : colors.border,
        },
        pressed && { opacity: 0.9 },
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setExpanded((v) => !v);
      }}
    >
      {/* Top row */}
      <View style={projStyles.topRow}>
        <View style={{ flex: 1 }}>
          <View style={projStyles.titleRow}>
            <Text style={[projStyles.brandName, { color: colors.foreground }]} numberOfLines={1}>
              {project.brandName}
            </Text>
            <View style={[projStyles.statusPill, { backgroundColor: accent + '18', borderColor: accent + '30' }]}>
              <View style={[projStyles.statusDot, { backgroundColor: accent }]} />
              <Text style={[projStyles.statusText, { color: accent }]}>
                {project.currentStageLabel}
              </Text>
            </View>
          </View>
          <Text style={[projStyles.serviceName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {project.serviceName}
            {project.packageName ? ` · ${project.packageName}` : ''}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
      </View>

      {/* Progress */}
      <ProgressBar percent={project.progressPercent} accent={accent} />
      <Text style={[projStyles.progressText, { color: colors.mutedForeground }]}>
        {project.progressPercent}% complete
      </Text>

      {/* Footer */}
      <View style={projStyles.footer}>
        <Text style={[projStyles.number, { color: colors.mutedForeground }]}>#{project.projectNumber}</Text>
        <Text style={[projStyles.date, { color: colors.mutedForeground }]}>Updated {dateStr}</Text>
      </View>

      {/* Expanded detail */}
      {expanded && (
        <View style={[projStyles.detail, { borderTopColor: colors.border }]}>
          {project.total && (
            <View style={projStyles.detailRow}>
              <Ionicons name="cash-outline" size={14} color={colors.mutedForeground} />
              <Text style={[projStyles.detailLabel, { color: colors.mutedForeground }]}>Value</Text>
              <Text style={[projStyles.detailValue, { color: colors.foreground }]}>
                {project.currency} {project.total}
              </Text>
            </View>
          )}
          {project.paymentStatus && (
            <View style={projStyles.detailRow}>
              <Ionicons name="card-outline" size={14} color={colors.mutedForeground} />
              <Text style={[projStyles.detailLabel, { color: colors.mutedForeground }]}>Payment</Text>
              <Text style={[projStyles.detailValue, { color: colors.foreground }]}>
                {project.paymentStatus}
              </Text>
            </View>
          )}
          {project.filesUnlocked && (
            <View style={projStyles.detailRow}>
              <Ionicons name="lock-open-outline" size={14} color={colors.emerald} />
              <Text style={[projStyles.detailLabel, { color: colors.emerald }]}>Files unlocked</Text>
            </View>
          )}
          {project.completionNotes && (
            <View style={[projStyles.notesBox, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Text style={[projStyles.notesText, { color: colors.mutedForeground }]}>
                {project.completionNotes}
              </Text>
            </View>
          )}
          {project.completionLinks?.map((link, i) => (
            <View key={i} style={projStyles.detailRow}>
              <Ionicons name="link-outline" size={14} color={colors.primary} />
              <Text style={[projStyles.detailValue, { color: colors.primary }]}>{link.label}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const projStyles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  brandName: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  serviceName: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  progressText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: -4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  number: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
  },
  date: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  detail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    width: 64,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500' as const,
    fontFamily: 'Inter_500Medium',
  },
  notesBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  notesText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [filter, setFilter] = useState('');

  const { data: projects, isLoading, refetch, isRefetching } = useWorkspaceProjects(token ?? '', filter || undefined);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Orders</Text>
        {/* Filter pills */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.key}
          contentContainerStyle={styles.filtersRow}
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.filterPill,
                {
                  backgroundColor: filter === item.key ? colors.primary : colors.surface2,
                  borderColor: filter === item.key ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setFilter(item.key);
              }}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === item.key ? '#FFF' : colors.mutedForeground },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !projects?.length ? (
        <View style={styles.center}>
          <Ionicons name="bag-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {filter ? 'No orders matching this filter' : 'No orders yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.projectNumber}
          renderItem={({ item }) => <ProjectCard project={item} colors={colors} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!projects.length}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  filtersRow: {
    gap: 8,
    paddingBottom: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '500' as const,
    fontFamily: 'Inter_500Medium',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
});
