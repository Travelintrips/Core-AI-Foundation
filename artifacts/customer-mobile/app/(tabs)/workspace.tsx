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
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, wsBase } from '@/lib/api';

type WorkspaceDownload = {
  id: number;
  title: string;
  category: string | null;
  projectNumber: string;
  projectName: string;
  version: number;
  status: string;
  locked: boolean;
  createdAt: string;
  pageCount?: number | null;
  fileSizeBytes?: number | null;
  documentType?: string | null;
  mimeType?: string | null;
  slideCount?: number | null;
};

type WorkspaceInvoice = {
  id: number;
  invoiceNumber: string;
  projectNumber: string | null;
  invoiceType: string;
  currency: string;
  amount: string;
  status: string;
  issuedAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  proofImageUrl: string | null;
};

function useDownloads(token: string) {
  return useQuery({
    queryKey: ['workspace', 'downloads', token],
    queryFn: ({ signal }) =>
      apiFetch<WorkspaceDownload[]>(`${wsBase(token)}/downloads`, { signal }),
    enabled: !!token,
    staleTime: 30_000,
  });
}

function useInvoices(token: string) {
  return useQuery({
    queryKey: ['workspace', 'invoices', token],
    queryFn: ({ signal }) =>
      apiFetch<WorkspaceInvoice[]>(`${wsBase(token)}/invoices`, { signal }),
    enabled: !!token,
    staleTime: 30_000,
  });
}

function fileIcon(mimeType?: string | null, docType?: string | null): string {
  if (mimeType?.includes('pdf') || docType?.includes('pdf')) return 'document-text-outline';
  if (mimeType?.includes('presentation') || docType?.includes('pptx')) return 'easel-outline';
  if (mimeType?.includes('image')) return 'image-outline';
  if (mimeType?.includes('video')) return 'videocam-outline';
  if (mimeType?.includes('zip') || mimeType?.includes('archive')) return 'archive-outline';
  return 'document-outline';
}

function fileMeta(item: WorkspaceDownload): string {
  const parts: string[] = [];
  if (item.pageCount) parts.push(`${item.pageCount} pages`);
  if (item.slideCount) parts.push(`${item.slideCount} slides`);
  if (item.fileSizeBytes) parts.push(formatBytes(item.fileSizeBytes));
  if (item.version > 1) parts.push(`v${item.version}`);
  return parts.join(' · ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function DownloadItem({ item, colors }: { item: WorkspaceDownload; colors: ReturnType<typeof useColors> }) {
  const icon = fileIcon(item.mimeType, item.documentType);
  const meta = fileMeta(item);
  const dateStr = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <View style={[dlStyles.row, { borderBottomColor: colors.border }]}>
      <View style={[dlStyles.iconWrap, { backgroundColor: item.locked ? colors.surface2 : colors.primary + '15' }]}>
        <Ionicons name={item.locked ? 'lock-closed-outline' : icon as never} size={20} color={item.locked ? colors.mutedForeground : colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[dlStyles.name, { color: item.locked ? colors.mutedForeground : colors.foreground }]} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={dlStyles.metaRow}>
          {meta ? <Text style={[dlStyles.meta, { color: colors.mutedForeground }]}>{meta}</Text> : null}
          <Text style={[dlStyles.meta, { color: colors.mutedForeground }]}>#{item.projectNumber}</Text>
          <Text style={[dlStyles.meta, { color: colors.mutedForeground }]}>{dateStr}</Text>
        </View>
      </View>
      {!item.locked && (
        <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />
      )}
    </View>
  );
}

const dlStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 14,
    fontWeight: '500' as const,
    fontFamily: 'Inter_500Medium',
    marginBottom: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});

function invoiceStatusColor(status: string, colors: ReturnType<typeof useColors>): string {
  const s = status?.toLowerCase() ?? '';
  if (s === 'paid') return colors.emerald;
  if (s === 'overdue') return colors.destructive;
  if (s === 'pending') return colors.gold;
  return colors.mutedForeground;
}

function InvoiceItem({ item, colors }: { item: WorkspaceInvoice; colors: ReturnType<typeof useColors> }) {
  const accent = invoiceStatusColor(item.status, colors);
  const date = item.issuedAt
    ? new Date(item.issuedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={[invStyles.row, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[invStyles.number, { color: colors.foreground }]}>#{item.invoiceNumber}</Text>
        {item.projectNumber && (
          <Text style={[invStyles.project, { color: colors.mutedForeground }]}>Project {item.projectNumber}</Text>
        )}
        {date && <Text style={[invStyles.date, { color: colors.mutedForeground }]}>{date}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[invStyles.amount, { color: colors.foreground }]}>
          {item.currency} {item.amount}
        </Text>
        <View style={[invStyles.statusPill, { backgroundColor: accent + '18', borderColor: accent + '30' }]}>
          <Text style={[invStyles.statusText, { color: accent }]}>{item.status}</Text>
        </View>
      </View>
    </View>
  );
}

const invStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  number: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  project: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  date: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  amount: {
    fontSize: 15,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
});

export default function WorkspaceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [tab, setTab] = useState<'files' | 'invoices'>('files');

  const { data: downloads, isLoading: dlLoading, refetch: refetchDl, isRefetching: dlRefetching } = useDownloads(token ?? '');
  const { data: invoices, isLoading: invLoading, refetch: refetchInv, isRefetching: invRefetching } = useInvoices(token ?? '');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const isLoading = tab === 'files' ? dlLoading : invLoading;
  const isRefetching = tab === 'files' ? dlRefetching : invRefetching;
  const onRefresh = tab === 'files' ? refetchDl : refetchInv;

  const sections = tab === 'files'
    ? (downloads ?? [])
    : (invoices ?? []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Workspace</Text>
        {/* Tab switcher */}
        <View style={[styles.tabs, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          {(['files', 'invoices'] as const).map((t) => (
            <Pressable
              key={t}
              style={[styles.tabItem, tab === t && { backgroundColor: colors.primary }]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, { color: tab === t ? '#FFF' : colors.mutedForeground }]}>
                {t === 'files' ? 'Files' : 'Invoices'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name={tab === 'files' ? 'folder-open-outline' : 'receipt-outline'}
            size={40}
            color={colors.mutedForeground}
          />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {tab === 'files' ? 'No files yet' : 'No invoices yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sections as (WorkspaceDownload | WorkspaceInvoice)[]}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) =>
            tab === 'files'
              ? <DownloadItem item={item as WorkspaceDownload} colors={colors} />
              : <InvoiceItem item={item as WorkspaceInvoice} colors={colors} />
          }
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={sections.length > 0}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />
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
    paddingBottom: 8,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    alignSelf: 'flex-start',
  },
  tabItem: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
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
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
});
