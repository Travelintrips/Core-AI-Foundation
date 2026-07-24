import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccess = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Please enter your access token.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await login(trimmed);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid token';
      setError(msg.includes('404') || msg.includes('401') ? 'Token not found. Check your email for the access link.' : msg);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = makeStyles(colors);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Background gradient orbs */}
      <View style={styles.orbA} pointerEvents="none" />
      <View style={styles.orbB} pointerEvents="none" />

      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Brand mark */}
        <View style={styles.brandSection}>
          <LinearGradient
            colors={['#9D91FB', '#7C6EFA', '#5F52D0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconRing}
          >
            <Ionicons name="sparkles" size={28} color="#FFFFFF" />
          </LinearGradient>
          <Text style={styles.brandTitle}>Creative AI Studio</Text>
          <Text style={styles.brandSub}>Customer Workspace</Text>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Access your workspace</Text>
          <Text style={styles.cardDesc}>
            Enter the access token from your welcome email to view your projects and deliverables.
          </Text>

          <View style={[styles.inputRow, error ? styles.inputRowError : null]}>
            <Ionicons name="key-outline" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Paste your access token"
              placeholderTextColor={colors.mutedForeground}
              value={token}
              onChangeText={(t) => { setToken(t); setError(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleAccess}
              editable={!isSubmitting}
              testID="token-input"
            />
          </View>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color={colors.destructive} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, isSubmitting && styles.btnDisabled]}
            onPress={handleAccess}
            disabled={isSubmitting}
            testID="access-button"
          >
            <LinearGradient
              colors={['#9D91FB', '#7C6EFA', '#5F52D0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.btnGradient}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text style={styles.btnText}>Access Workspace</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Token sent by Creative AI Studio team via email
        </Text>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    orbA: {
      position: 'absolute',
      width: 300,
      height: 300,
      borderRadius: 150,
      backgroundColor: 'rgba(124,110,250,0.12)',
      top: -80,
      right: -80,
    },
    orbB: {
      position: 'absolute',
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: 'rgba(34,211,238,0.05)',
      bottom: 60,
      left: -60,
    },
    inner: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 32,
    },
    brandSection: {
      alignItems: 'center',
      gap: 12,
    },
    iconRing: {
      width: 64,
      height: 64,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandTitle: {
      color: colors.foreground,
      fontSize: 24,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      letterSpacing: -0.5,
    },
    brandSub: {
      color: colors.mutedForeground,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
    card: {
      backgroundColor: colors.surface1,
      borderRadius: colors.radius + 4,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      gap: 16,
    },
    cardTitle: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
    },
    cardDesc: {
      color: colors.mutedForeground,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      lineHeight: 20,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 48,
    },
    inputRowError: {
      borderColor: colors.destructive,
    },
    inputIcon: {
      marginRight: 8,
    },
    input: {
      flex: 1,
      color: colors.foreground,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      flex: 1,
    },
    btn: {
      borderRadius: colors.radius,
      overflow: 'hidden',
    },
    btnPressed: {
      opacity: 0.85,
    },
    btnDisabled: {
      opacity: 0.6,
    },
    btnGradient: {
      height: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    btnText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
    },
    footer: {
      textAlign: 'center',
      color: colors.mutedForeground,
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
    },
  });
}
