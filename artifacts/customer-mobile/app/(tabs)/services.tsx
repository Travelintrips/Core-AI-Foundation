import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { apiFetch } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

type CatalogService = {
  id: number;
  categoryId: number;
  serviceCode: string;
  serviceName: string;
  shortDescription: string;
  serviceFlow: 'fixed_price' | 'custom_project' | 'enterprise';
  pricingModel: string;
  startingPrice: string;
  currency: string;
  estimatedDelivery: string;
  humanReview: boolean;
  deliverables: string[] | null;
  isFeatured?: boolean;
};

type ServicePackage = {
  id: number;
  serviceId: number;
  packageName: string;
  packageType: string;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  oneTimePrice: string | null;
  featuresJson: string[] | null;
  paymentPolicy: string;
};

type ServiceDetail = CatalogService & { packages: ServicePackage[] };

type ServiceCategory = {
  id: number;
  code: string;
  name: string;
  description: string | null;
};

type PublicCatalog = {
  categories: ServiceCategory[];
  services: CatalogService[];
};

type ServiceRequestInput = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  companyName?: string;
  notes?: string;
  packageId?: number;
};

type ServiceRequestResult = {
  requestId: string;
  total: string;
  currency: string;
  status: string;
};

// ─── Data hooks ──────────────────────────────────────────────────────────────

function usePublicCatalog() {
  return useQuery({
    queryKey: ['catalog', 'public'],
    queryFn: ({ signal }) =>
      apiFetch<PublicCatalog>('/api/ai/catalog/public', { signal }),
    staleTime: 60_000,
  });
}

function useServiceDetail(serviceId: number | undefined) {
  return useQuery({
    queryKey: ['catalog', 'service', serviceId],
    queryFn: ({ signal }) =>
      apiFetch<ServiceDetail>(`/api/ai/catalog/services/${serviceId}`, { signal }),
    enabled: !!serviceId,
    staleTime: 120_000,
  });
}

function useRequestService(serviceId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ServiceRequestInput) =>
      apiFetch<ServiceRequestResult>(`/api/ai/catalog/services/${serviceId}/request`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FlowBadge({
  flow,
  colors,
}: {
  flow: string;
  colors: ReturnType<typeof useColors>;
}) {
  const label =
    flow === 'fixed_price' ? 'Fixed Price' : flow === 'custom_project' ? 'Custom' : 'Enterprise';
  const accent =
    flow === 'fixed_price' ? colors.emerald : flow === 'custom_project' ? colors.cyan : colors.gold;
  return (
    <View
      style={[badgeStyles.badge, { backgroundColor: accent + '18', borderColor: accent + '30' }]}
    >
      <Text style={[badgeStyles.text, { color: accent }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  text: { fontSize: 11, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
});

// ─── Request Form Modal ───────────────────────────────────────────────────────

type RequestModalProps = {
  service: CatalogService;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
};

function RequestModal({ service, visible, onClose, colors }: RequestModalProps) {
  const insets = useSafeAreaInsets();
  const { data: detail, isLoading: detailLoading } = useServiceDetail(service.id);
  const requestMutation = useRequestService(service.id);

  const [selectedPackageId, setSelectedPackageId] = useState<number | undefined>(undefined);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<ServiceRequestResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setSelectedPackageId(undefined);
    setName('');
    setEmail('');
    setCompany('');
    setPhone('');
    setNotes('');
    setSubmitted(false);
    setSubmitResult(null);
    setFieldErrors({});
    requestMutation.reset();
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Your name is required';
    if (!email.trim()) errs.email = 'Email address is required';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'Enter a valid email address';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      const result = await requestMutation.mutateAsync({
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim() || undefined,
        companyName: company.trim() || undefined,
        notes: notes.trim() || undefined,
        packageId: selectedPackageId,
      });
      setSubmitResult(result);
      setSubmitted(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const modalStyles = makeModalStyles(colors);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 16;
  const topPad = Platform.OS === 'web' ? 67 : insets.top + 12;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[modalStyles.root, { paddingTop: topPad }]}>
        {/* Header */}
        <View style={modalStyles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={modalStyles.modalTitle} numberOfLines={1}>
              {service.serviceName}
            </Text>
            <Text style={modalStyles.modalSub}>
              {service.currency} {service.startingPrice}+ · {service.estimatedDelivery}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [modalStyles.closeBtn, pressed && { opacity: 0.7 }]}
            onPress={handleClose}
          >
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {submitted && submitResult ? (
          // ── Success state ────────────────────────────────────────────────
          <View style={modalStyles.successContainer}>
            <LinearGradient
              colors={['#1A2540', '#0D1526']}
              style={modalStyles.successIcon}
            >
              <Ionicons name="checkmark-circle" size={48} color={colors.emerald} />
            </LinearGradient>
            <Text style={modalStyles.successTitle}>Request Submitted</Text>
            <Text style={modalStyles.successMsg}>
              Your service request has been received. The Creative AI Studio team will contact you
              shortly.
            </Text>
            <View style={[modalStyles.refCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Text style={[modalStyles.refLabel, { color: colors.mutedForeground }]}>Reference</Text>
              <Text style={[modalStyles.refValue, { color: colors.foreground }]}>
                #{submitResult.requestId}
              </Text>
            </View>
            <Pressable
              style={[modalStyles.doneBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              onPress={handleClose}
            >
              <Text style={[modalStyles.doneBtnText, { color: colors.foreground }]}>Done</Text>
            </Pressable>
          </View>
        ) : (
          // ── Request form ─────────────────────────────────────────────────
          <ScrollView
            contentContainerStyle={[modalStyles.formScroll, { paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Packages */}
            {detailLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : (detail?.packages ?? []).length > 0 ? (
              <View style={modalStyles.section}>
                <Text style={modalStyles.sectionLabel}>Select Package</Text>
                {detail!.packages.map((pkg) => {
                  const price = pkg.oneTimePrice ?? pkg.monthlyPrice ?? null;
                  const isSelected = selectedPackageId === pkg.id;
                  return (
                    <Pressable
                      key={pkg.id}
                      style={[
                        modalStyles.packageCard,
                        {
                          backgroundColor: isSelected ? colors.primary + '18' : colors.surface2,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedPackageId(isSelected ? undefined : pkg.id);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[modalStyles.pkgName, { color: colors.foreground }]}>
                          {pkg.packageName}
                        </Text>
                        {pkg.featuresJson?.slice(0, 2).map((f, i) => (
                          <Text key={i} style={[modalStyles.pkgFeature, { color: colors.mutedForeground }]}>
                            · {f}
                          </Text>
                        ))}
                      </View>
                      {price && (
                        <Text style={[modalStyles.pkgPrice, { color: isSelected ? colors.primary : colors.foreground }]}>
                          {service.currency} {price}
                        </Text>
                      )}
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* Contact info */}
            <View style={modalStyles.section}>
              <Text style={modalStyles.sectionLabel}>Your Details</Text>

              <FormField
                label="Full Name"
                value={name}
                onChangeText={(v) => { setName(v); setFieldErrors((e) => ({ ...e, name: '' })); }}
                placeholder="Jane Smith"
                error={fieldErrors.name}
                colors={colors}
                autoComplete="name"
              />
              <FormField
                label="Email Address"
                value={email}
                onChangeText={(v) => { setEmail(v); setFieldErrors((e) => ({ ...e, email: '' })); }}
                placeholder="jane@company.com"
                error={fieldErrors.email}
                colors={colors}
                keyboardType="email-address"
                autoComplete="email"
              />
              <FormField
                label="Company (optional)"
                value={company}
                onChangeText={setCompany}
                placeholder="Acme Corp"
                colors={colors}
                autoComplete="organization"
              />
              <FormField
                label="Phone (optional)"
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 555 000 0000"
                colors={colors}
                keyboardType="phone-pad"
                autoComplete="tel"
              />
            </View>

            {/* Brief notes */}
            <View style={modalStyles.section}>
              <Text style={modalStyles.sectionLabel}>Project Notes (optional)</Text>
              <TextInput
                style={[
                  modalStyles.notesInput,
                  {
                    backgroundColor: colors.input,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                placeholder="Tell us about your brand, goals, or any requirements..."
                placeholderTextColor={colors.mutedForeground}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Error */}
            {requestMutation.isError && (
              <View style={[modalStyles.errorBanner, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '40' }]}>
                <Ionicons name="alert-circle" size={16} color={colors.destructive} />
                <Text style={[modalStyles.errorBannerText, { color: colors.destructive }]}>
                  {requestMutation.error instanceof Error
                    ? requestMutation.error.message
                    : 'Submission failed. Please try again.'}
                </Text>
              </View>
            )}

            {/* Submit */}
            <Pressable
              style={({ pressed }) => [
                modalStyles.submitBtn,
                pressed && { opacity: 0.85 },
                requestMutation.isPending && { opacity: 0.6 },
              ]}
              onPress={handleSubmit}
              disabled={requestMutation.isPending}
            >
              <LinearGradient
                colors={['#9D91FB', '#7C6EFA', '#5F52D0']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={modalStyles.submitGradient}
              >
                {requestMutation.isPending ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <Text style={modalStyles.submitText}>Submit Request</Text>
                    <Ionicons name="send" size={16} color="#FFF" />
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  colors,
  keyboardType,
  autoComplete,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  colors: ReturnType<typeof useColors>;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoComplete?: 'name' | 'email' | 'organization' | 'tel';
}) {
  return (
    <View style={ffStyles.wrap}>
      <Text style={[ffStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[
          ffStyles.input,
          {
            backgroundColor: colors.input,
            borderColor: error ? colors.destructive : colors.border,
            color: colors.foreground,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        autoCorrect={false}
        autoComplete={autoComplete}
      />
      {error ? <Text style={[ffStyles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </View>
  );
}

const ffStyles = StyleSheet.create({
  wrap: { gap: 4, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '500' as const, fontFamily: 'Inter_500Medium' },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  error: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});

function makeModalStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 20,
      paddingBottom: 16,
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    modalSub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginTop: 2,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    formScroll: { paddingHorizontal: 20, paddingTop: 20, gap: 4 },
    section: { marginBottom: 20 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: colors.mutedForeground,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 10,
    },
    packageCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 8,
    },
    pkgName: { fontSize: 14, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
    pkgFeature: { fontSize: 12, fontFamily: 'Inter_400Regular' },
    pkgPrice: { fontSize: 15, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
    notesInput: {
      borderRadius: 10,
      borderWidth: 1,
      padding: 12,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      minHeight: 100,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      marginBottom: 12,
    },
    errorBannerText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
    submitBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 4 },
    submitGradient: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    submitText: { color: '#FFF', fontSize: 15, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
    // Success
    successContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 16,
    },
    successIcon: { width: 88, height: 88, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    successTitle: {
      fontSize: 22,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      textAlign: 'center',
    },
    successMsg: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 20,
    },
    refCard: {
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      gap: 4,
      width: '100%',
    },
    refLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', textTransform: 'uppercase', letterSpacing: 0.5 },
    refValue: { fontSize: 18, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
    doneBtn: {
      width: '100%',
      height: 50,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneBtnText: { fontSize: 15, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
  });
}

// ─── Service Card ─────────────────────────────────────────────────────────────

function ServiceCard({
  service,
  colors,
  onRequest,
}: {
  service: CatalogService;
  colors: ReturnType<typeof useColors>;
  onRequest: (service: CatalogService) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      style={({ pressed }) => [
        cardStyles.card,
        {
          backgroundColor: colors.surface1,
          borderColor: expanded ? colors.primary + '40' : colors.border,
        },
        pressed && { opacity: 0.9 },
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setExpanded((v) => !v);
      }}
    >
      <View style={cardStyles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.name, { color: colors.foreground }]}>{service.serviceName}</Text>
          <Text
            style={[cardStyles.desc, { color: colors.mutedForeground }]}
            numberOfLines={expanded ? undefined : 2}
          >
            {service.shortDescription}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedForeground}
        />
      </View>

      <View style={cardStyles.metaRow}>
        <FlowBadge flow={service.serviceFlow} colors={colors} />
        <Text style={[cardStyles.price, { color: colors.primary }]}>
          {service.currency} {service.startingPrice}+
        </Text>
        <View style={cardStyles.delivery}>
          <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
          <Text style={[cardStyles.deliveryText, { color: colors.mutedForeground }]}>
            {service.estimatedDelivery}
          </Text>
        </View>
      </View>

      {expanded && (
        <>
          {service.deliverables && (
            <View style={[cardStyles.deliverables, { borderTopColor: colors.border }]}>
              <Text style={[cardStyles.delTitle, { color: colors.mutedForeground }]}>Deliverables</Text>
              {service.deliverables.slice(0, 4).map((d, i) => (
                <View key={i} style={cardStyles.delRow}>
                  <Ionicons name="checkmark" size={14} color={colors.emerald} />
                  <Text style={[cardStyles.delText, { color: colors.foreground }]}>{d}</Text>
                </View>
              ))}
              {service.humanReview && (
                <View style={cardStyles.delRow}>
                  <Ionicons name="person-circle-outline" size={14} color={colors.gold} />
                  <Text style={[cardStyles.delText, { color: colors.gold }]}>
                    Human review included
                  </Text>
                </View>
              )}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              cardStyles.requestBtn,
              { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
              pressed && { opacity: 0.75 },
            ]}
            onPress={(e) => {
              e.stopPropagation?.();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onRequest(service);
            }}
          >
            <Ionicons name="send-outline" size={14} color={colors.primary} />
            <Text style={[cardStyles.requestBtnText, { color: colors.primary }]}>Request Service</Text>
          </Pressable>
        </>
      )}
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12, marginBottom: 10 },
  cardTop: { flexDirection: 'row', gap: 10 },
  name: { fontSize: 15, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  desc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  price: { fontSize: 14, fontWeight: '700' as const, fontFamily: 'Inter_700Bold' },
  delivery: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  deliveryText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  deliverables: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 6 },
  delTitle: {
    fontSize: 11,
    fontWeight: '600' as const,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  delRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  requestBtnText: { fontSize: 14, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ServicesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [requestingService, setRequestingService] = useState<CatalogService | null>(null);

  const { data, isLoading, refetch, isRefetching } = usePublicCatalog();

  const categories = data?.categories ?? [];
  const allServices = data?.services ?? [];
  const filteredServices = selectedCategoryId
    ? allServices.filter((s) => s.categoryId === selectedCategoryId)
    : allServices;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Services</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {allServices.length} available services
        </Text>
      </View>

      {/* Category pills */}
      {categories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsRow}
          style={styles.pillsScroll}
        >
          <Pressable
            style={[
              styles.pill,
              {
                backgroundColor: selectedCategoryId === null ? colors.primary : colors.surface2,
                borderColor: selectedCategoryId === null ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setSelectedCategoryId(null)}
          >
            <Text
              style={[
                styles.pillText,
                { color: selectedCategoryId === null ? '#FFF' : colors.mutedForeground },
              ]}
            >
              All
            </Text>
          </Pressable>
          {categories.map((cat) => (
            <Pressable
              key={cat.id}
              style={[
                styles.pill,
                {
                  backgroundColor: selectedCategoryId === cat.id ? colors.primary : colors.surface2,
                  borderColor: selectedCategoryId === cat.id ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedCategoryId(selectedCategoryId === cat.id ? null : cat.id);
              }}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: selectedCategoryId === cat.id ? '#FFF' : colors.mutedForeground },
                ]}
              >
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Service list */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filteredServices.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cube-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No services found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredServices}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ServiceCard service={item} colors={colors} onRequest={setRequestingService} />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!filteredServices.length}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {/* Request modal */}
      {requestingService && (
        <RequestModal
          service={requestingService}
          visible={!!requestingService}
          onClose={() => setRequestingService(null)}
          colors={colors}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 2 },
  title: { fontSize: 28, fontWeight: '700' as const, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  sub: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  pillsScroll: { flexGrow: 0 },
  pillsRow: { paddingHorizontal: 20, paddingBottom: 16, gap: 8, flexDirection: 'row' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 13, fontWeight: '500' as const, fontFamily: 'Inter_500Medium' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  list: { paddingHorizontal: 20, paddingTop: 4 },
});
