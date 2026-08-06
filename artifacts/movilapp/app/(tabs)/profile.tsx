import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import colors from '@/constants/colors';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

type DigitalPayment = 'nequi' | 'daviplata' | 'breve';

const PAYMENT_OPTIONS: { key: DigitalPayment; label: string; icon: string }[] = [
  { key: 'nequi',     label: 'Nequi',     icon: '💜' },
  { key: 'daviplata', label: 'Daviplata', icon: '🔴' },
  { key: 'breve',     label: 'Breve',     icon: '🟡' },
];

interface SubInfo {
  id: number;
  plan: string;
  planLabel: string;
  priceCop: number;
  startsAt: string;
  expiresAt: string;
  isTrial: boolean;
  isActive: boolean;
  daysRemaining: number;
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={18} color={colors.light.mutedForeground} />
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

function SubscriptionCard({ sub }: { sub: SubInfo }) {
  const statusColor = !sub.isActive
    ? colors.light.destructive
    : sub.isTrial
    ? '#FFB800'
    : colors.light.primary;

  const statusLabel = !sub.isActive
    ? 'Vencida'
    : sub.isTrial
    ? 'Período de prueba'
    : 'Activa';

  const expiryDate = new Date(sub.expiresAt).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <View style={[styles.subCard, { borderColor: statusColor + '40' }]}>
      <View style={styles.subCardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="credit-card" size={18} color={statusColor} />
          <Text style={styles.subCardTitle}>Mi Suscripción</Text>
        </View>
        <View style={[styles.subBadge, { backgroundColor: statusColor + '20' }]}>
          <View style={[styles.subBadgeDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.subBadgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.subPlanRow}>
        <View>
          <Text style={styles.subPlanLabel}>{sub.planLabel}</Text>
          {sub.isTrial ? (
            <Text style={styles.subPlanNote}>Primeros 2 meses gratis</Text>
          ) : (
            <Text style={styles.subPlanNote}>{formatCOP(sub.priceCop)} por período</Text>
          )}
        </View>
        {sub.isActive && (
          <View style={styles.subDaysBox}>
            <Text style={[styles.subDaysNum, { color: statusColor }]}>{sub.daysRemaining}</Text>
            <Text style={styles.subDaysLabel}>días</Text>
          </View>
        )}
      </View>

      <View style={styles.subFooter}>
        <Feather name="calendar" size={13} color={colors.light.mutedForeground} />
        <Text style={styles.subFooterText}>
          {sub.isActive ? `Vence el ${expiryDate}` : `Venció el ${expiryDate}`}
        </Text>
      </View>

      {!sub.isActive && (
        <View style={styles.subExpiredBanner}>
          <Feather name="alert-circle" size={14} color={colors.light.destructive} />
          <Text style={styles.subExpiredText}>
            Tu suscripción venció. Contacta al administrador para renovar tu plan y volver a conectarte.
          </Text>
        </View>
      )}

      {sub.isActive && sub.daysRemaining <= 5 && (
        <View style={[styles.subExpiredBanner, { backgroundColor: '#FFB80018', borderColor: '#FFB80040' }]}>
          <Feather name="clock" size={14} color="#FFB800" />
          <Text style={[styles.subExpiredText, { color: '#FFB800' }]}>
            Tu {sub.isTrial ? 'período de prueba' : 'suscripción'} vence pronto. Contacta al administrador.
          </Text>
        </View>
      )}
    </View>
  );
}

function PaymentMethodsCard({
  initialPayments,
  onSave,
}: {
  initialPayments: DigitalPayment[];
  onSave: (methods: DigitalPayment[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<DigitalPayment[]>(initialPayments);
  const [saving, setSaving] = useState(false);

  const toggle = (method: DigitalPayment) => {
    setSelected(prev =>
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected);
      setEditing(false);
    } catch {
      Alert.alert('Error', 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSelected(initialPayments);
    setEditing(false);
  };

  return (
    <View style={styles.payCard}>
      <View style={styles.payCardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="credit-card" size={18} color={colors.light.primary} />
          <Text style={styles.payCardTitle}>Medios de pago</Text>
        </View>
        {!editing && (
          <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
            <Feather name="edit-2" size={14} color={colors.light.primary} />
            <Text style={styles.editBtnText}>Editar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cash — always on */}
      <View style={styles.payChipRow}>
        <View style={[styles.payChip, styles.payChipOn]}>
          <Text style={styles.payChipIcon}>💵</Text>
          <Text style={styles.payChipLabelOn}>Efectivo</Text>
          <Feather name="check" size={13} color={colors.light.primaryForeground} />
        </View>
      </View>

      {/* Digital methods */}
      <View style={styles.payChipRow}>
        {PAYMENT_OPTIONS.map(opt => {
          const active = editing ? selected.includes(opt.key) : initialPayments.includes(opt.key);
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.payChip, active ? styles.payChipOn : styles.payChipOff]}
              onPress={() => editing && toggle(opt.key)}
              activeOpacity={editing ? 0.75 : 1}
            >
              <Text style={styles.payChipIcon}>{opt.icon}</Text>
              <Text style={active ? styles.payChipLabelOn : styles.payChipLabelOff}>{opt.label}</Text>
              {active && <Feather name="check" size={13} color={colors.light.primaryForeground} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {!editing && initialPayments.length === 0 && (
        <Text style={styles.payNote}>Solo aceptas efectivo.</Text>
      )}

      {editing && (
        <View style={styles.payActions}>
          <TouchableOpacity style={styles.cancelEditBtn} onPress={handleCancel} disabled={saving}>
            <Text style={styles.cancelEditText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color={colors.light.primaryForeground} />
              : <Text style={styles.saveBtnText}>Guardar</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* Security note */}
      <View style={styles.securityNote}>
        <Feather name="shield" size={13} color={colors.light.mutedForeground} />
        <Text style={styles.securityNoteText}>
          Para cambiar tu nombre o la placa de tu vehículo, comunícate con administración por motivos de seguridad.
        </Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, updateUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: subscription } = useQuery<SubInfo>({
    queryKey: ['my-subscription'],
    queryFn: async () => {
      const token = await AsyncStorage.getItem('auth_token');
      const res = await fetch(`${BASE_URL}/drivers/me/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('no subscription');
      return res.json();
    },
    enabled: user?.role === 'driver',
    retry: false,
  });

  const handleSavePayments = async (methods: DigitalPayment[]) => {
    const token = await AsyncStorage.getItem('auth_token');
    const res = await fetch(`${BASE_URL}/drivers/payment-methods`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acceptedPayments: methods }),
    });
    if (!res.ok) throw new Error('save failed');
    const updated = await res.json();
    updateUser({ acceptedPayments: updated.acceptedPayments });
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Deseas salir de tu cuenta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: logout },
    ]);
  };

  if (!user) return null;

  const roleLabel = user.role === 'driver' ? 'Conductor' : user.role === 'admin' ? 'Administrador' : 'Pasajero';
  const roleIcon = user.role === 'driver' ? 'truck' : user.role === 'admin' ? 'shield' : 'user';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0),
        paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 110),
        paddingHorizontal: 20,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Mi Perfil</Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
        <Text style={styles.userName}>{user.name}</Text>
        <View style={styles.roleBadge}>
          <Feather name={roleIcon as any} size={13} color={colors.light.primary} />
          <Text style={styles.roleBadgeText}>{roleLabel}</Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{user.rating.toFixed(1)}</Text>
          <Text style={styles.statLabel}>Calificación</Text>
          <Feather name="star" size={14} color={colors.light.accent} style={{ marginTop: 2 }} />
        </View>
        <View style={[styles.statCard, styles.statCardMiddle]}>
          <Text style={styles.statValue}>{user.ratingCount}</Text>
          <Text style={styles.statLabel}>Evaluaciones</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statusDot, { backgroundColor: user.isActive ? colors.light.primary : colors.light.destructive }]} />
          <Text style={styles.statLabel}>{user.isActive ? 'Activo' : 'Inactivo'}</Text>
        </View>
      </View>

      {/* Subscription card — drivers only */}
      {user.role === 'driver' && subscription && (
        <SubscriptionCard sub={subscription} />
      )}

      {/* Payment methods — drivers only */}
      {user.role === 'driver' && (
        <PaymentMethodsCard
          initialPayments={(user as any).acceptedPayments ?? []}
          onSave={handleSavePayments}
        />
      )}

      {/* Contact info */}
      <View style={styles.infoCard}>
        <InfoRow icon="phone" label="Celular" value={user.phone} />
        {user.email && <InfoRow icon="mail" label="Correo" value={user.email} />}
        <InfoRow
          icon="calendar"
          label="Miembro desde"
          value={new Date(user.createdAt).toLocaleDateString('es-CO', { year: 'numeric', month: 'long' })}
        />
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Feather name="log-out" size={18} color={colors.light.destructive} />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.light.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  userName: { fontSize: 22, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.light.primary + '20',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  roleBadgeText: { fontSize: 13, fontWeight: '600', color: colors.light.primary, fontFamily: 'Inter_600SemiBold' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: colors.light.card, borderRadius: colors.radius,
    padding: 16, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.light.border,
  },
  statCardMiddle: { borderColor: colors.light.border },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  // Subscription
  subCard: {
    backgroundColor: colors.light.card, borderRadius: colors.radius,
    borderWidth: 1, padding: 16, marginBottom: 16, gap: 12,
  },
  subCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subCardTitle: { fontSize: 15, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  subBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  subBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  subBadgeText: { fontSize: 12, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  subPlanRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subPlanLabel: { fontSize: 18, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  subPlanNote: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
  subDaysBox: { alignItems: 'center', minWidth: 50 },
  subDaysNum: { fontSize: 28, fontWeight: '900', fontFamily: 'Inter_700Bold', lineHeight: 30 },
  subDaysLabel: { fontSize: 11, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  subFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subFooterText: { fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  subExpiredBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: colors.light.destructive + '15',
    borderWidth: 1, borderColor: colors.light.destructive + '40',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  subExpiredText: { flex: 1, fontSize: 12, color: colors.light.destructive, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  // Payment methods card
  payCard: {
    backgroundColor: colors.light.card, borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.border,
    padding: 16, marginBottom: 16, gap: 12,
  },
  payCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payCardTitle: { fontSize: 15, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.light.primary + '15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: colors.light.primary, fontFamily: 'Inter_600SemiBold' },
  payChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1,
  },
  payChipOn: { backgroundColor: colors.light.primary, borderColor: colors.light.primary },
  payChipOff: { backgroundColor: colors.light.secondary, borderColor: colors.light.border },
  payChipIcon: { fontSize: 14 },
  payChipLabelOn: { fontSize: 13, fontWeight: '600', color: colors.light.primaryForeground, fontFamily: 'Inter_600SemiBold' },
  payChipLabelOff: { fontSize: 13, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  payNote: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  payActions: { flexDirection: 'row', gap: 10 },
  cancelEditBtn: {
    flex: 1, paddingVertical: 10, borderRadius: colors.radius,
    backgroundColor: colors.light.secondary, alignItems: 'center',
    borderWidth: 1, borderColor: colors.light.border,
  },
  cancelEditText: { fontSize: 14, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  saveBtn: {
    flex: 1, paddingVertical: 10, borderRadius: colors.radius,
    backgroundColor: colors.light.primary, alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  securityNote: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: colors.light.secondary,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.light.border,
  },
  securityNoteText: {
    flex: 1, fontSize: 12, color: colors.light.mutedForeground,
    fontFamily: 'Inter_400Regular', lineHeight: 17,
  },
  // Info
  infoCard: {
    backgroundColor: colors.light.card, borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.border,
    marginBottom: 20, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: colors.light.border,
  },
  infoText: { flex: 1 },
  infoLabel: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  infoValue: { fontSize: 15, color: colors.light.foreground, fontFamily: 'Inter_500Medium', marginTop: 1 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: colors.radius,
    backgroundColor: colors.light.destructive + '15',
    borderWidth: 1, borderColor: colors.light.destructive + '40',
    marginBottom: 8,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.light.destructive, fontFamily: 'Inter_600SemiBold' },
});
