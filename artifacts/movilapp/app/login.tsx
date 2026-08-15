import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLoginUser, useRegisterUser } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { router } from 'expo-router';
import colors from '@/constants/colors';
import { Feather } from '@expo/vector-icons';

type Role = 'passenger' | 'driver';
type DigitalPayment = 'nequi' | 'daviplata' | 'breve';

const PAYMENT_OPTIONS: { key: DigitalPayment; label: string; icon: string }[] = [
  { key: 'nequi',     label: 'Nequi',     icon: '💜' },
  { key: 'daviplata', label: 'Daviplata', icon: '🔴' },
  { key: 'breve',     label: 'Breve',     icon: '🟡' },
];

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('passenger');
  const [showPass, setShowPass] = useState(false);
  const [acceptedPayments, setAcceptedPayments] = useState<DigitalPayment[]>([]);

  const loginMutation = useLoginUser();
  const registerMutation = useRegisterUser();

  const isLoading = loginMutation.isPending || registerMutation.isPending;

  const togglePayment = (method: DigitalPayment) => {
    setAcceptedPayments(prev =>
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  const handleSubmit = async () => {
    if (!phone.trim() || !password.trim()) {
      Alert.alert('Error', 'Por favor ingresa tu número y contraseña.');
      return;
    }
    if (isRegister && !name.trim()) {
      Alert.alert('Error', 'Por favor ingresa tu nombre.');
      return;
    }
    try {
      let result: { token: string; user: any };
      if (isRegister) {
        result = await registerMutation.mutateAsync({
          data: {
            name: name.trim(),
            phone: phone.trim(),
            password,
            role,
            ...(role === 'driver' ? { acceptedPayments } : {}),
          } as any,
        });
      } else {
        result = await loginMutation.mutateAsync({
          data: { phone: phone.trim(), password },
        });
      }
      await login(result.token, result.user);
      router.replace('/(tabs)');
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? 'Error al iniciar sesión';
      Alert.alert('Error', msg);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.container, {
        paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 32),
        paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24),
      }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo */}
      <View style={styles.logoArea}>
        <View style={styles.logoSquare}>
          <Image
            source={require('../assets/images/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.appName}>MóvilApp</Text>
        <Text style={styles.tagline}>Tu movilidad, a un toque</Text>
      </View>

      {/* Toggle */}
      <View style={styles.toggle}>
        <TouchableOpacity
          style={[styles.toggleBtn, !isRegister && styles.toggleBtnActive]}
          onPress={() => setIsRegister(false)}
        >
          <Text style={[styles.toggleText, !isRegister && styles.toggleTextActive]}>Ingresar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, isRegister && styles.toggleBtnActive]}
          onPress={() => setIsRegister(true)}
        >
          <Text style={[styles.toggleText, isRegister && styles.toggleTextActive]}>Registrarse</Text>
        </TouchableOpacity>
      </View>

      {/* Form */}
      <View style={styles.form}>
        {isRegister && (
          <View style={styles.field}>
            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Juan Pérez"
              placeholderTextColor={colors.light.mutedForeground}
              autoCapitalize="words"
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Número de celular</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="300 000 0000"
            placeholderTextColor={colors.light.mutedForeground}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.passRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.light.mutedForeground}
              secureTextEntry={!showPass}
              autoComplete="password"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(v => !v)}>
              <Feather name={showPass ? 'eye-off' : 'eye'} size={20} color={colors.light.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {isRegister && (
          <View style={styles.field}>
            <Text style={styles.label}>Soy</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleBtn, role === 'passenger' && styles.roleBtnActive]}
                onPress={() => setRole('passenger')}
              >
                <Feather name="user" size={18} color={role === 'passenger' ? colors.light.primaryForeground : colors.light.mutedForeground} />
                <Text style={[styles.roleText, role === 'passenger' && styles.roleTextActive]}>Pasajero</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleBtn, role === 'driver' && styles.roleBtnActive]}
                onPress={() => setRole('driver')}
              >
                <Feather name="truck" size={18} color={role === 'driver' ? colors.light.primaryForeground : colors.light.mutedForeground} />
                <Text style={[styles.roleText, role === 'driver' && styles.roleTextActive]}>Conductor</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Payment methods — only for drivers during registration */}
        {isRegister && role === 'driver' && (
          <View style={styles.field}>
            <Text style={styles.label}>Medios de pago que aceptas</Text>
            <Text style={styles.paymentNote}>
              Siempre recibirás efectivo. Activa los métodos adicionales que deseas aceptar.
            </Text>
            {/* Cash — always enabled */}
            <View style={styles.paymentRow}>
              <View style={[styles.paymentChip, styles.paymentChipCash]}>
                <Text style={styles.paymentIcon}>💵</Text>
                <Text style={styles.paymentLabelActive}>Efectivo</Text>
                <Feather name="check" size={14} color={colors.light.primaryForeground} />
              </View>
            </View>
            {/* Digital options */}
            <View style={styles.paymentRow}>
              {PAYMENT_OPTIONS.map(opt => {
                const selected = acceptedPayments.includes(opt.key);
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.paymentChip, selected && styles.paymentChipSelected]}
                    onPress={() => togglePayment(opt.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.paymentIcon}>{opt.icon}</Text>
                    <Text style={[styles.paymentLabel, selected && styles.paymentLabelActive]}>
                      {opt.label}
                    </Text>
                    {selected && <Feather name="check" size={14} color={colors.light.primaryForeground} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.light.primaryForeground} />
          ) : (
            <Text style={styles.submitText}>
              {isRegister ? 'Crear cuenta' : 'Ingresar'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  container: { paddingHorizontal: 24, flexGrow: 1 },
  logoArea: { alignItems: 'center', marginBottom: 40 },
  logoSquare: {
    width: 110, height: 110, borderRadius: 26,
    backgroundColor: '#08080F', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, borderWidth: 1.5, borderColor: colors.light.border, overflow: 'hidden',
  },
  logoImage: { width: 90, height: 90 },
  appName: { fontSize: 28, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  tagline: { fontSize: 14, color: colors.light.mutedForeground, marginTop: 4, fontFamily: 'Inter_400Regular' },
  toggle: {
    flexDirection: 'row', backgroundColor: colors.light.secondary,
    borderRadius: colors.radius, padding: 4, marginBottom: 32,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: colors.radius - 2 },
  toggleBtnActive: { backgroundColor: colors.light.primary },
  toggleText: { fontSize: 14, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  toggleTextActive: { color: colors.light.primaryForeground },
  form: { gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  input: {
    backgroundColor: colors.light.input, borderWidth: 1, borderColor: colors.light.border,
    borderRadius: colors.radius, paddingHorizontal: 16, paddingVertical: 14,
    color: colors.light.foreground, fontSize: 16, fontFamily: 'Inter_400Regular',
  },
  passRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: {
    padding: 14, backgroundColor: colors.light.input,
    borderRadius: colors.radius, borderWidth: 1, borderColor: colors.light.border,
  },
  roleRow: { flexDirection: 'row', gap: 12 },
  roleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: colors.radius,
    backgroundColor: colors.light.secondary, borderWidth: 1, borderColor: colors.light.border,
  },
  roleBtnActive: { backgroundColor: colors.light.primary, borderColor: colors.light.primary },
  roleText: { fontSize: 15, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  roleTextActive: { color: colors.light.primaryForeground },
  // Payment methods
  paymentNote: {
    fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', lineHeight: 17,
  },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  paymentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: colors.light.secondary, borderWidth: 1, borderColor: colors.light.border,
  },
  paymentChipSelected: { backgroundColor: colors.light.primary, borderColor: colors.light.primary },
  paymentChipCash: { backgroundColor: colors.light.primary + '20', borderColor: colors.light.primary + '40' },
  paymentIcon: { fontSize: 15 },
  paymentLabel: { fontSize: 14, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  paymentLabelActive: { fontSize: 14, fontWeight: '600', color: colors.light.primaryForeground, fontFamily: 'Inter_600SemiBold' },
  submitBtn: {
    backgroundColor: colors.light.primary, borderRadius: colors.radius,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { fontSize: 16, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
});
