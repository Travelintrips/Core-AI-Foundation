import React from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
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

type WorkspaceProfile = {
  clientEmail: string;
  clientName: string;
  companyName: string | null;
  address: string | null;
  picName: string | null;
  picPhone: string | null;
};

function useProfile(token: string) {
  return useQuery({
    queryKey: ['workspace', 'profile', token],
    queryFn: ({ signal }) =>
      apiFetch<WorkspaceProfile>(`${wsBase(token)}/profile`, { signal }),
    enabled: !!token,
    staleTime: 60_000,
  });
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  accent,
  colors,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  accent?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const content = (
    <View style={[rowStyles.row, { borderBottomColor: colors.border }]}>
      <View style={[rowStyles.iconWrap, { backgroundColor: (accent ?? colors.primary) + '15' }]}>
        <Ionicons name={icon as never} size={18} color={accent ?? colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.label, { color: colors.foreground }]}>{label}</Text>
        {value ? (
          <Text style={[rowStyles.value, { color: colors.mutedForeground }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      )}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      style={({ pressed }) => pressed && { opacity: 0.7 }}
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    fontFamily: 'Inter_500Medium',
  },
  value: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
});

function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••';
  return token.slice(0, 4) + '•'.repeat(Math.min(24, token.length - 8)) + token.slice(-4);
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token, logout } = useAuth();

  const { data: profile } = useProfile(token ?? '');

  const displayName = profile?.clientName ?? 'Customer';
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out of your workspace?')) logout();
      return;
    }
    Alert.alert('Sign Out', 'Leave your workspace?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          logout();
        },
      },
    ]);
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Avatar + name */}
      <View style={styles.heroSection}>
        <View style={[styles.avatarLarge, { backgroundColor: colors.surface2, borderColor: colors.primary + '30' }]}>
          <Text style={[styles.avatarInitials, { color: colors.primary }]}>{initials}</Text>
          <View style={[styles.avatarBadge, { backgroundColor: colors.emerald }]} />
        </View>
        <Text style={[styles.heroName, { color: colors.foreground }]}>{displayName}</Text>
        {profile?.companyName && (
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>{profile.companyName}</Text>
        )}
      </View>

      {/* Account info card */}
      <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Account</Text>
        {profile?.clientEmail && (
          <SettingRow
            icon="mail-outline"
            label="Email"
            value={profile.clientEmail}
            colors={colors}
          />
        )}
        {profile?.picName && (
          <SettingRow
            icon="person-outline"
            label="Contact"
            value={profile.picName}
            colors={colors}
          />
        )}
        {profile?.picPhone && (
          <SettingRow
            icon="call-outline"
            label="Phone"
            value={profile.picPhone}
            colors={colors}
          />
        )}
        {profile?.address && (
          <SettingRow
            icon="location-outline"
            label="Address"
            value={profile.address}
            colors={colors}
          />
        )}
      </View>

      {/* Workspace access card */}
      <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Workspace Access</Text>
        <SettingRow
          icon="key-outline"
          label="Access Token"
          value={token ? maskToken(token) : '—'}
          colors={colors}
          accent={colors.cyan}
        />
      </View>

      {/* Support */}
      <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Support</Text>
        <SettingRow
          icon="help-circle-outline"
          label="Get Help"
          value="Contact Creative AI Studio"
          colors={colors}
          accent={colors.gold}
        />
      </View>

      {/* Sign out */}
      <Pressable
        style={({ pressed }) => [
          styles.logoutBtn,
          { borderColor: colors.destructive + '40', backgroundColor: colors.destructive + '10' },
          pressed && { opacity: 0.7 },
        ]}
        onPress={handleLogout}
        testID="logout-button"
      >
        <Ionicons name="log-out-outline" size={18} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign Out</Text>
      </Pressable>

      <Text style={[styles.versionText, { color: colors.mutedForeground }]}>
        Creative AI Studio Mobile v1.0
      </Text>

      <View style={{ height: Platform.OS === 'web' ? 34 : insets.bottom + 16 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  heroSection: {
    alignItems: 'center',
    paddingBottom: 4,
    gap: 8,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#060B18',
  },
  heroName: {
    fontSize: 22,
    fontWeight: '700' as const,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
  },
  heroSub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 0,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
