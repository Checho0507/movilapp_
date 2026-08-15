import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, Alert, Animated, Vibration,
} from 'react-native';
import { MapView, Marker, PROVIDER_DEFAULT } from '@/lib/maps';
import type { Region } from '@/lib/maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCreateTrip, useUpdateDriverStatus, useUpdateDriverLocation, useUpdateTripStatus } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import colors from '@/constants/colors';

const BOGOTA: Region = { latitude: 4.711, longitude: -74.0721, latitudeDelta: 0.06, longitudeDelta: 0.06 };
const DRIVER_ACCEPT_RADIUS_KM = 1;

const PAYMENT_OPTIONS = [
  { key: 'cash',      label: 'Efectivo', icon: '💵' },
  { key: 'nequi',     label: 'Nequi',    icon: '💜' },
  { key: 'daviplata', label: 'Daviplata',icon: '🔴' },
  { key: 'breve',     label: 'Breve',    icon: '🟡' },
] as const;

type PaymentKey = typeof PAYMENT_OPTIONS[number]['key'];

type Step = 'idle' | 'selectOrigin' | 'selectDest' | 'confirm' | 'searching' | 'no_drivers';
type Pin = { lat: number; lng: number; address: string };

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`,
      { headers: { 'User-Agent': 'MóvilApp/1.0' } },
    );
    const data = await res.json();
    if (data.display_name) {
      const parts = (data.display_name as string).split(',');
      return parts.slice(0, 3).join(',').trim();
    }
  } catch { /* ignore */ }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Passenger Home ───────────────────────────────────────────────────────
function PassengerHome() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket, joinTrip, leaveTrip } = useSocket();
  const mapRef = useRef<MapView>(null);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [step, setStep] = useState<Step>('idle');
  const [region, setRegion] = useState<Region>(BOGOTA);
  const [centerAddress, setCenterAddress] = useState('');
  const [origin, setOrigin] = useState<Pin | null>(null);
  const [dest, setDest] = useState<Pin | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [activeTripId, setActiveTripId] = useState<number | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentKey>('cash');

  const createTrip = useCreateTrip();

  // Pulsing animation for searching state
  useEffect(() => {
    if (step !== 'searching') return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [step]);

  // Get initial location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r: Region = {
        latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        latitudeDelta: 0.01, longitudeDelta: 0.01,
      };
      setRegion(r);
      mapRef.current?.animateToRegion(r, 600);
    })();
  }, []);

  // Immediately geocode current center when entering selectDest
  // (the map doesn't move so onRegionChangeComplete never fires on its own)
  useEffect(() => {
    if (step !== 'selectDest') return;
    setIsGeocoding(true);
    reverseGeocode(region.latitude, region.longitude).then(addr => {
      setCenterAddress(addr);
      setIsGeocoding(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Reverse-geocode map center when in selection mode
  const handleRegionChange = useCallback((r: Region) => {
    setRegion(r);
    if (step !== 'selectOrigin' && step !== 'selectDest') return;
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      setIsGeocoding(true);
      const addr = await reverseGeocode(r.latitude, r.longitude);
      setCenterAddress(addr);
      setIsGeocoding(false);
    }, 600);
  }, [step]);

  // Estimate price when origin + dest are known
  useEffect(() => {
    if (!origin || !dest) return;
    const km = haversine(origin.lat, origin.lng, dest.lat, dest.lng);
    setDistanceKm(km);
    setEstimatedPrice(Math.round(4500 + km * 1800));
  }, [origin, dest]);

  // Listen for trip events while searching
  useEffect(() => {
    if (step !== 'searching' || !activeTripId || !socket) return;

    const onStatusUpdated = (data: any) => {
      if (data.id !== activeTripId) return;
      if (data.status === 'accepted') {
        leaveTrip(activeTripId);
        setActiveTripId(null);
        setStep('idle');
        router.push(`/trip/${data.id}`);
      } else if (data.status === 'cancelled') {
        leaveTrip(activeTripId);
        setActiveTripId(null);
        setStep('no_drivers');
      }
    };

    socket.on('trip_status_updated', onStatusUpdated);
    return () => {
      socket.off('trip_status_updated', onStatusUpdated);
    };
  }, [step, activeTripId, socket]);

  const startSelectOrigin = async () => {
    // Center on current location
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r: Region = {
        latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        latitudeDelta: 0.008, longitudeDelta: 0.008,
      };
      setRegion(r);
      mapRef.current?.animateToRegion(r, 500);
      const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      setCenterAddress(addr);
    } catch { setCenterAddress(''); }
    setStep('selectOrigin');
  };

  const confirmOrigin = () => {
    setOrigin({ lat: region.latitude, lng: region.longitude, address: centerAddress });
    setCenterAddress('');
    setStep('selectDest');
  };

  const confirmDest = () => {
    setDest({ lat: region.latitude, lng: region.longitude, address: centerAddress });
    setStep('confirm');
  };

  const requestTaxi = async () => {
    if (!origin || !dest) return;
    setStep('searching');
    try {
      const trip = await createTrip.mutateAsync({
        data: {
          originLat: origin.lat, originLng: origin.lng, originAddress: origin.address,
          destinationLat: dest.lat, destinationLng: dest.lng, destinationAddress: dest.address,
          vehicleType: 'taxi', paymentMethod,
        },
      });
      setActiveTripId(trip.id);
      joinTrip(trip.id);
    } catch (err: any) {
      setStep('confirm');
      Alert.alert('Error', err?.data?.error ?? 'No se pudo solicitar el taxi.');
    }
  };

  const cancelSearch = async () => {
    if (activeTripId) {
      try {
        const token = await AsyncStorage.getItem('auth_token');
        const base = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
        await fetch(`${base}/trips/${activeTripId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: 'cancelled' }),
        });
        leaveTrip(activeTripId);
      } catch { /* ignore */ }
    }
    setActiveTripId(null);
    setStep('idle');
  };

  const resetSelection = () => {
    setOrigin(null);
    setDest(null);
    setStep('idle');
  };

  const isSelectingMode = step === 'selectOrigin' || step === 'selectDest';
  const pinColor = step === 'selectOrigin' ? colors.light.primary : colors.light.destructive;

  return (
    <View style={styles.root}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        region={region}
        onRegionChangeComplete={handleRegionChange}
        showsUserLocation
        showsMyLocationButton={false}
        scrollEnabled={isSelectingMode}
        zoomEnabled
        pitchEnabled={false}
        rotateEnabled={false}
      >
        {origin && step !== 'selectOrigin' && (
          <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title="Origen">
            <View style={[styles.markerDot, { backgroundColor: colors.light.primary }]} />
          </Marker>
        )}
        {dest && step === 'confirm' && (
          <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} title="Destino">
            <View style={[styles.markerDot, { backgroundColor: colors.light.destructive }]} />
          </Marker>
        )}
      </MapView>

      {/* Center crosshair (selection modes) */}
      {isSelectingMode && (
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <Feather name="map-pin" size={40} color={pinColor} style={{ marginBottom: -4 }} />
          <View style={[styles.crosshairShadow, { backgroundColor: pinColor + '40' }]} />
        </View>
      )}

      {/* Top label (selection modes) */}
      {isSelectingMode && (
        <View style={[styles.topLabel, { top: insets.top + (Platform.OS === 'web' ? 67 : 16) }]}>
          <Text style={styles.topLabelText}>
            {step === 'selectOrigin' ? '📍 Mueve el mapa para ajustar tu punto de partida' : '🎯 Mueve el mapa hasta tu destino'}
          </Text>
        </View>
      )}

      {/* Searching overlay */}
      {step === 'searching' && (
        <View style={styles.searchingOverlay}>
          <Animated.View style={[styles.searchingCircle, { transform: [{ scale: pulseAnim }] }]}>
            <Feather name="navigation" size={40} color={colors.light.primaryForeground} />
          </Animated.View>
          <Text style={styles.searchingTitle}>Buscando el taxi más cercano...</Text>
          <Text style={styles.searchingSubtitle}>Notificando conductores a menos de 1 km</Text>
          <TouchableOpacity style={styles.cancelSearchBtn} onPress={cancelSearch}>
            <Text style={styles.cancelSearchText}>Cancelar búsqueda</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* No drivers overlay */}
      {step === 'no_drivers' && (
        <View style={styles.searchingOverlay}>
          <View style={styles.noDriversCircle}>
            <Feather name="alert-circle" size={44} color={colors.light.destructive} />
          </View>
          <Text style={styles.noDriversTitle}>No hay conductores disponibles</Text>
          <Text style={styles.noDriversSubtitle}>
            No encontramos ningún taxi cerca en este momento.{'\n'}Intenta de nuevo en unos minutos.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setStep('confirm'); }}
            activeOpacity={0.85}
          >
            <Feather name="refresh-cw" size={16} color={colors.light.primaryForeground} />
            <Text style={styles.retryBtnText}>Volver a intentar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelSearchBtn} onPress={() => setStep('idle')}>
            <Text style={styles.cancelSearchText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom sheet — idle */}
      {step === 'idle' && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          <Text style={styles.sheetTitle}>Hola, {user?.name?.split(' ')[0]} 👋</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={startSelectOrigin} activeOpacity={0.85}>
            <Feather name="navigation" size={18} color={colors.light.primaryForeground} />
            <Text style={styles.primaryBtnText}>Pedir taxi</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom sheet — selecting origin */}
      {step === 'selectOrigin' && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          <View style={styles.addressRow}>
            <Feather name="circle" size={12} color={colors.light.primary} />
            <Text style={styles.addressText} numberOfLines={2}>
              {isGeocoding ? 'Localizando...' : centerAddress || 'Mueve el mapa...'}
            </Text>
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={confirmOrigin} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Confirmar punto de partida</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={resetSelection}>
            <Text style={styles.secondaryBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom sheet — selecting destination */}
      {step === 'selectDest' && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          <View style={[styles.addressRow, { marginBottom: 6 }]}>
            <Feather name="circle" size={10} color={colors.light.primary} />
            <Text style={[styles.addressText, { color: colors.light.mutedForeground, fontSize: 13 }]} numberOfLines={1}>
              {origin?.address}
            </Text>
          </View>
          <View style={[styles.addressRow, { marginBottom: 16 }]}>
            <Feather name="map-pin" size={12} color={colors.light.destructive} />
            <Text style={styles.addressText} numberOfLines={2}>
              {isGeocoding ? 'Localizando...' : centerAddress || 'Mueve el mapa al destino...'}
            </Text>
          </View>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.light.destructive }]} onPress={confirmDest} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Confirmar destino</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('selectOrigin')}>
            <Text style={styles.secondaryBtnText}>← Cambiar origen</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom sheet — confirm */}
      {step === 'confirm' && origin && dest && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          <View style={styles.routeSummary}>
            <View style={styles.routeRow}>
              <Feather name="circle" size={10} color={colors.light.primary} />
              <Text style={styles.routeText} numberOfLines={2}>{origin.address}</Text>
            </View>
            <View style={[styles.routeConnector]} />
            <View style={styles.routeRow}>
              <Feather name="map-pin" size={10} color={colors.light.destructive} />
              <Text style={styles.routeText} numberOfLines={2}>{dest.address}</Text>
            </View>
          </View>

          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>Precio estimado</Text>
              <Text style={styles.priceNote}>⚠️ Este es un precio estimado, puede variar</Text>
            </View>
            <Text style={styles.priceValue}>${estimatedPrice.toLocaleString('es-CO')}</Text>
          </View>
          <Text style={styles.distanceNote}>{distanceKm.toFixed(1)} km · Taxi</Text>

          {/* Payment method selector */}
          <View style={styles.paySection}>
            <Text style={styles.payLabel}>¿Cómo vas a pagar?</Text>
            <View style={styles.payRow}>
              {PAYMENT_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.payChip, paymentMethod === opt.key && styles.payChipActive]}
                  onPress={() => setPaymentMethod(opt.key)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.payChipIcon}>{opt.icon}</Text>
                  <Text style={[styles.payChipText, paymentMethod === opt.key && styles.payChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={requestTaxi} disabled={createTrip.isPending} activeOpacity={0.85}>
            {createTrip.isPending
              ? <ActivityIndicator color={colors.light.primaryForeground} />
              : <><Feather name="navigation" size={18} color={colors.light.primaryForeground} /><Text style={styles.primaryBtnText}>Solicitar taxi</Text></>
            }
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={resetSelection}>
            <Text style={styles.secondaryBtnText}>Cambiar ruta</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Driver Home ──────────────────────────────────────────────────────────
function DriverHome() {
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const { socket } = useSocket();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isOnline, setIsOnline] = useState(user?.isOnline ?? false);
  const [requests, setRequests] = useState<any[]>([]);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [panicPending, setPanicPending] = useState(false);
  const panicAnim = useRef(new Animated.Value(1)).current;
  const updateStatus = useUpdateDriverStatus();
  const updateLocation = useUpdateDriverLocation();
  const acceptTrip = useUpdateTripStatus();

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({});
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (isOnline) {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 8_000, distanceInterval: 30 },
          async (p) => {
            setLocation({ lat: p.coords.latitude, lng: p.coords.longitude });
            try { await updateLocation.mutateAsync({ data: { lat: p.coords.latitude, lng: p.coords.longitude } }); } catch { }
          },
        );
      }
    })();
    return () => { sub?.remove(); };
  }, [isOnline]);

  // Listen for trip requests
  useEffect(() => {
    if (!socket || !isOnline) return;
    const handler = (trip: any) => {
      setRequests(prev => prev.find(r => r.id === trip.id) ? prev : [trip, ...prev].slice(0, 3));
    };
    socket.on('trip:new_request', handler);
    return () => { socket.off('trip:new_request', handler); };
  }, [socket, isOnline]);

  // Listen for forced-offline event when subscription expires mid-session
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { message: string }) => {
      setIsOnline(false);
      updateUser({ isOnline: false });
      setRequests([]);
      Alert.alert(
        '⚠️ Suscripción vencida',
        data.message ?? 'Tu suscripción ha vencido. Has sido desconectado automáticamente.',
        [
          { text: 'Ver suscripción', onPress: () => router.push('/(tabs)/profile') },
          { text: 'Entendido' },
        ],
      );
    };
    socket.on('driver:subscription_expired', handler);
    return () => { socket.off('driver:subscription_expired', handler); };
  }, [socket]);

  // Listen for panic alerts from OTHER drivers
  useEffect(() => {
    if (!socket) return;
    const handler = (data: {
      driverId: number; driverName: string;
      lat: number | null; lng: number | null;
      message?: string; timestamp: string;
    }) => {
      Vibration.vibrate([0, 300, 200, 300]);
      const locStr = data.lat && data.lng
        ? `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`
        : 'ubicación no disponible';
      Alert.alert(
        '🚨 ALERTA DE PÁNICO',
        `El conductor ${data.driverName} activó el botón de pánico.\n\nUbicación: ${locStr}${data.message ? `\n\n"${data.message}"` : ''}`,
        [{ text: 'Entendido', style: 'destructive' }],
      );
    };
    socket.on('driver:panic_alert', handler);
    return () => { socket.off('driver:panic_alert', handler); };
  }, [socket]);

  // Pulse animation for panic button
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(panicAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(panicAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const handleAccept = async (req: any) => {
    setAcceptingId(req.id);
    try {
      await acceptTrip.mutateAsync({ id: req.id, data: { status: 'accepted' as any } });
    } catch (e: any) {
      Alert.alert('Error', e?.data?.error ?? 'No se pudo aceptar la carrera.');
      setAcceptingId(null);
      return;
    }
    setRequests(p => p.filter(r => r.id !== req.id));
    setAcceptingId(null);
    router.push(`/trip/${req.id}`);
  };

  const toggleOnline = async () => {
    const next = !isOnline;
    try {
      await updateStatus.mutateAsync({ data: { isOnline: next } });
      setIsOnline(next);
      updateUser({ isOnline: next });
      if (!next) setRequests([]);
    } catch (e: any) {
      const err = e?.data ?? e;
      if (err?.code === 'SUBSCRIPTION_REQUIRED' || e?.status === 403) {
        Alert.alert(
          '⚠️ Suscripción requerida',
          err?.error ?? 'Tu suscripción ha vencido. Contacta al administrador para renovar tu plan.',
          [
            { text: 'Entendido', style: 'cancel' },
            { text: 'Ver suscripción', onPress: () => router.push('/(tabs)/profile') },
          ],
        );
      } else {
        Alert.alert('Error', err?.error ?? 'Error al cambiar estado');
      }
    }
  };

  const triggerPanic = () => {
    Alert.alert(
      '🚨 Botón de Pánico',
      '¿Confirmas que necesitas ayuda urgente? Se alertará a administradores y conductores cercanos con tu ubicación.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'SÍ, NECESITO AYUDA',
          style: 'destructive',
          onPress: async () => {
            setPanicPending(true);
            Vibration.vibrate([0, 200, 100, 200, 100, 400]);
            try {
              const token = await AsyncStorage.getItem('auth_token');
              const base = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
              const res = await fetch(`${base}/drivers/panic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: 'Necesito ayuda urgente' }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json?.error ?? 'Error');
              Alert.alert(
                '✅ Alerta enviada',
                `Se notificó a ${json.notifiedDrivers} conductor(es) y al equipo de administración.`,
                [{ text: 'OK' }],
              );
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'No se pudo enviar la alerta.');
            } finally {
              setPanicPending(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={BOGOTA}
        region={location ? { latitude: location.lat, longitude: location.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 } : undefined}
        showsUserLocation
        showsMyLocationButton={false}
      />

      <View style={[styles.topLabel, { top: insets.top + (Platform.OS === 'web' ? 67 : 16) }]}>
        <View style={styles.driverTopRow}>
          <View>
            <Text style={styles.topLabelText}>{isOnline ? '🟢 En línea — recibiendo solicitudes' : '⚫ Fuera de línea'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.toggleBtn, isOnline ? styles.toggleBtnOn : styles.toggleBtnOff]}
            onPress={toggleOnline}
            disabled={updateStatus.isPending}
          >
            {updateStatus.isPending
              ? <ActivityIndicator size="small" color={colors.light.primaryForeground} />
              : <Text style={styles.toggleBtnText}>{isOnline ? 'Desconectar' : 'Conectar'}</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {requests.length > 0 && (
        <View style={[styles.requestsWrap, { bottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          {requests.map(req => (
            <View key={req.id} style={styles.requestCard}>
              <View style={styles.requestTop}>
                <Feather name="bell" size={14} color={colors.light.accent} />
                <Text style={styles.requestTitle}>Nueva solicitud de taxi</Text>
                <TouchableOpacity onPress={() => setRequests(p => p.filter(r => r.id !== req.id))}>
                  <Feather name="x" size={14} color={colors.light.mutedForeground} />
                </TouchableOpacity>
              </View>
              <View style={{ gap: 4 }}>
                <View style={styles.reqRow}><Feather name="circle" size={9} color={colors.light.primary} /><Text style={styles.reqText} numberOfLines={1}>{req.originAddress}</Text></View>
                <View style={styles.reqRow}><Feather name="map-pin" size={9} color={colors.light.destructive} /><Text style={styles.reqText} numberOfLines={1}>{req.destinationAddress}</Text></View>
              </View>
              <View style={styles.requestMeta}>
                <Text style={styles.reqPrice}>${Number(req.estimatedPrice).toLocaleString('es-CO')}</Text>
                <Text style={styles.reqDist}>{Number(req.distanceKm).toFixed(1)} km</Text>
                <View style={styles.reqPayBadge}>
                  <Text style={styles.reqPayText}>
                    {PAYMENT_OPTIONS.find(p => p.key === (req.paymentMethod ?? 'cash'))?.icon ?? '💵'}{' '}
                    {PAYMENT_OPTIONS.find(p => p.key === (req.paymentMethod ?? 'cash'))?.label ?? 'Efectivo'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.acceptBtn, acceptingId === req.id && { opacity: 0.6 }]}
                onPress={() => handleAccept(req)}
                disabled={acceptingId !== null}
                activeOpacity={0.85}
              >
                {acceptingId === req.id
                  ? <ActivityIndicator size="small" color={colors.light.primaryForeground} />
                  : <Text style={styles.acceptText}>Aceptar carrera</Text>
                }
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {!isOnline && (
        <View style={[styles.offlineCard, { bottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          <Text style={styles.offlineText}>Conéctate para recibir solicitudes de taxi</Text>
        </View>
      )}

      {/* ── Panic Button ── always visible for drivers ── */}
      <Animated.View
        style={[
          styles.panicBtnWrap,
          { bottom: insets.bottom + (Platform.OS === 'web' ? 100 : 148) },
          { transform: [{ scale: panicAnim }] },
        ]}
      >
        <TouchableOpacity
          style={[styles.panicBtn, panicPending && { opacity: 0.7 }]}
          onPress={triggerPanic}
          disabled={panicPending}
          activeOpacity={0.8}
        >
          {panicPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Feather name="alert-triangle" size={22} color="#fff" />
          }
          <Text style={styles.panicBtnText}>PÁNICO</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  if (!user) return null;
  return user.role === 'driver' ? <DriverHome /> : <PassengerHome />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  crosshairWrap: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  },
  crosshairShadow: { width: 14, height: 6, borderRadius: 7, marginTop: 2 },
  topLabel: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: colors.light.card + 'F4', borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.border,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  topLabelText: { fontSize: 13, fontWeight: '600', color: colors.light.foreground, fontFamily: 'Inter_600SemiBold' },
  driverTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  toggleBtnOn: { backgroundColor: colors.light.destructive + 'CC' },
  toggleBtnOff: { backgroundColor: colors.light.primary },
  toggleBtnText: { fontSize: 12, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' },
  // Searching overlay
  searchingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.light.background + 'F0',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  searchingCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.light.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.light.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 20, elevation: 10,
  },
  searchingTitle: { fontSize: 20, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  searchingSubtitle: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  cancelSearchBtn: {
    marginTop: 8, paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1, borderColor: colors.light.destructive + '80',
    backgroundColor: colors.light.destructive + '18',
  },
  cancelSearchText: { fontSize: 14, fontWeight: '600', color: colors.light.destructive, fontFamily: 'Inter_600SemiBold' },
  // No drivers state
  noDriversCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.light.destructive + '18',
    borderWidth: 2, borderColor: colors.light.destructive + '50',
    alignItems: 'center', justifyContent: 'center',
  },
  noDriversTitle: { fontSize: 20, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  noDriversSubtitle: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 24, backgroundColor: colors.light.primary,
  },
  retryBtnText: { fontSize: 15, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  // Bottom sheet
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.light.card + 'F8',
    borderTopWidth: 1, borderTopColor: colors.light.border,
    paddingHorizontal: 20, paddingTop: 18, gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  addressText: { flex: 1, fontSize: 15, color: colors.light.foreground, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  routeSummary: { gap: 8 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  routeText: { flex: 1, fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  routeConnector: { width: 1, height: 12, backgroundColor: colors.light.border, marginLeft: 5 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceLabel: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  priceNote: { fontSize: 11, color: '#FFB800', fontFamily: 'Inter_400Regular', marginTop: 2 },
  priceValue: { fontSize: 26, fontWeight: '700', color: colors.light.primary, fontFamily: 'Inter_700Bold' },
  distanceNote: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.light.primary, borderRadius: colors.radius, paddingVertical: 15,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  secondaryBtn: { alignItems: 'center', paddingVertical: 10 },
  secondaryBtnText: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  // Driver requests
  requestsWrap: { position: 'absolute', left: 16, right: 16, gap: 10 },
  requestCard: {
    backgroundColor: colors.light.card + 'F8', borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.border, padding: 14, gap: 10,
  },
  requestTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requestTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqText: { flex: 1, fontSize: 13, color: colors.light.foreground, fontFamily: 'Inter_400Regular' },
  requestMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reqPrice: { fontSize: 20, fontWeight: '700', color: colors.light.primary, fontFamily: 'Inter_700Bold' },
  reqDist: { fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  reqPayBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.light.secondary, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.light.border,
  },
  reqPayText: { fontSize: 12, color: colors.light.foreground, fontFamily: 'Inter_600SemiBold' },
  // Payment method selector in confirm sheet
  paySection: { gap: 8 },
  payLabel: { fontSize: 13, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.light.secondary, borderWidth: 1, borderColor: colors.light.border,
  },
  payChipActive: { backgroundColor: colors.light.primary, borderColor: colors.light.primary },
  payChipIcon: { fontSize: 14 },
  payChipText: { fontSize: 13, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  payChipTextActive: { color: colors.light.primaryForeground },
  acceptBtn: { backgroundColor: colors.light.primary, borderRadius: colors.radius - 2, paddingVertical: 12, alignItems: 'center' },
  acceptText: { fontSize: 15, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  offlineCard: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: colors.light.card + 'F0', borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.border, paddingVertical: 14, alignItems: 'center',
  },
  offlineText: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  markerDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  // Panic button
  panicBtnWrap: {
    position: 'absolute',
    right: 20,
  },
  panicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 22,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 12,
  },
  panicBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1.5,
    fontFamily: 'Inter_700Bold',
  },
});
