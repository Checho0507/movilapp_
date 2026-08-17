import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Platform, Alert, KeyboardAvoidingView,
  Modal, ScrollView, Linking,
} from 'react-native';
import { MapView, Marker, Polyline, PROVIDER_DEFAULT } from '@/lib/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useGetTrip, useListTripMessages, useCreateMessage, useUpdateTripStatus, useUpdateDriverLocation,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import colors from '@/constants/colors';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? `https://${process.env.EXPO_PUBLIC_DOMAIN}`).replace(/\/api\/?$/i, '').replace(/\/$/, '') + '/api';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Buscando conductor...',
  accepted: 'Conductor asignado — en camino',
  driver_arriving: 'Conductor llegando',
  in_progress: 'Viaje en curso',
  completed: 'Viaje completado ✓',
  cancelled: 'Viaje cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFB800', accepted: '#3B82F6',
  driver_arriving: '#6366F1', in_progress: '#10B981',
  completed: '#00D48B', cancelled: '#FF4757',
};

// Generates 3 codes: correct + 2 random distractors, shuffled
function generateVerifyCodes(correct: string): string[] {
  const codes = new Set([correct]);
  while (codes.size < 3) {
    codes.add(String(Math.floor(Math.random() * 100)).padStart(2, '0'));
  }
  return [...codes].sort(() => Math.random() - 0.5);
}

// Fetch driving route from OSRM (free, no API key needed)
async function fetchOSRMRoute(
  oLat: number, oLng: number, dLat: number, dLng: number,
): Promise<{ latitude: number; longitude: number }[]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MovilApp/1.0' } });
    const json = await res.json();
    if (json.routes?.[0]) {
      return (json.routes[0].geometry.coordinates as [number, number][]).map(
        ([lng, lat]) => ({ latitude: lat, longitude: lng }),
      );
    }
  } catch { /* fallback to straight line */ }
  return [
    { latitude: oLat, longitude: oLng },
    { latitude: dLat, longitude: dLng },
  ];
}

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tripId = parseInt(id ?? '0');
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket, joinTrip, leaveTrip } = useSocket();
  const isDriver = user?.role === 'driver';

  const mapRef = useRef<MapView>(null);
  const flatRef = useRef<FlatList>(null);

  // Server data — hooks take id:number directly (not an object)
  const { data: tripData } = useGetTrip(tripId);
  const { data: serverMessages = [] } = useListTripMessages(tripId);
  const updateStatus = useUpdateTripStatus();
  const sendMsg = useCreateMessage();
  const pushLocation = useUpdateDriverLocation();

  // Local state
  const [trip, setTrip] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [unread, setUnread] = useState(0);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Verification flow (driver only)
  const [showVerify, setShowVerify] = useState(false);
  const [verifyCodes, setVerifyCodes] = useState<string[]>([]);
  const [verifyError, setVerifyError] = useState(false);

  // Rating flow (passenger only)
  const [showRating, setShowRating] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  // Price report flow (passenger, after rating)
  const [showPriceReport, setShowPriceReport] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [priceSubmitting, setPriceSubmitting] = useState(false);

  // Sync from server
  useEffect(() => { if (tripData) setTrip(tripData); }, [tripData]);
  useEffect(() => { if (serverMessages.length) setMessages(serverMessages); }, [serverMessages]);

  // Join socket room
  useEffect(() => {
    joinTrip(tripId);
    return () => leaveTrip(tripId);
  }, [tripId]);

  // Driver: watch GPS, update local state AND push to server so passenger sees movement
  useEffect(() => {
    if (!isDriver) return;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 15 },
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          // Update local map immediately
          setTrip((prev: any) => {
            if (!prev) return prev;
            const driver = prev.driver
              ? { ...prev.driver, currentLat: latitude, currentLng: longitude }
              : prev.driver;
            return { ...prev, driver };
          });
          // Push to server → server emits driver:location to trip room → passenger map updates
          try {
            await pushLocation.mutateAsync({ data: { lat: latitude, lng: longitude } });
          } catch { /* ignore */ }
        },
      );
    })();
    return () => { sub?.remove(); };
  }, [isDriver]);

  // 4-minute countdown when driver accepted
  useEffect(() => {
    if (trip?.status !== 'accepted' || !trip?.driverAcceptedAt) { setCountdown(null); return; }
    const accepted = new Date(trip.driverAcceptedAt).getTime();
    const LIMIT = 4 * 60 * 1000;
    const update = () => setCountdown(Math.max(0, Math.floor((LIMIT - (Date.now() - accepted)) / 1000)));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [trip?.status, trip?.driverAcceptedAt]);

  // Fetch OSRM route whenever trip loads or status changes
  useEffect(() => {
    if (!trip) return;
    if (trip.status === 'in_progress') {
      // Trip active: full route origin → destination
      fetchOSRMRoute(
        Number(trip.originLat), Number(trip.originLng),
        Number(trip.destinationLat), Number(trip.destinationLng),
      ).then(setRouteCoords);
    } else if (isDriver && (trip.status === 'accepted' || trip.status === 'driver_arriving')) {
      // Driver heading to pickup: route from driver position → origin
      const dLat = trip.driver?.currentLat != null ? Number(trip.driver.currentLat) : null;
      const dLng = trip.driver?.currentLng != null ? Number(trip.driver.currentLng) : null;
      if (dLat !== null && dLng !== null) {
        fetchOSRMRoute(dLat, dLng, Number(trip.originLat), Number(trip.originLng))
          .then(setRouteCoords);
      } else {
        // No driver coords yet — draw straight dashed line to origin
        setRouteCoords([]);
      }
    } else {
      setRouteCoords([]);
    }
  // trip?.id ensures this re-runs when trip first arrives, not only on status changes
  }, [trip?.id, trip?.status, trip?.driver?.currentLat, trip?.driver?.currentLng]);

  // Show rating when trip completes (passenger)
  useEffect(() => {
    if (!isDriver && trip?.status === 'completed' && !ratingSubmitted) setShowRating(true);
  }, [trip?.status]);

  // Socket events
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (updated: any) => setTrip(updated);
    const onMsg = (msg: any) => {
      setMessages(prev => [...prev, msg]);
      if (!showChat) setUnread(n => n + 1);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
    };
    const onDriverLoc = ({ lat, lng }: { lat: number; lng: number }) =>
      setTrip((prev: any) => {
        if (!prev) return prev;
        const driver = prev.driver ? { ...prev.driver, currentLat: lat, currentLng: lng } : prev.driver;
        return { ...prev, driver };
      });

    ['accepted', 'driver_arriving', 'in_progress', 'completed', 'cancelled'].forEach(s =>
      socket.on(`trip:${s}`, onUpdate),
    );
    socket.on('message:new', onMsg);
    socket.on('driver:location', onDriverLoc);
    return () => {
      ['accepted', 'driver_arriving', 'in_progress', 'completed', 'cancelled'].forEach(s =>
        socket.off(`trip:${s}`, onUpdate),
      );
      socket.off('message:new', onMsg);
      socket.off('driver:location', onDriverLoc);
    };
  }, [socket, showChat]);

  // ─── Waze navigation ─────────────────────────────────────────────────────

  const openWaze = useCallback((lat: number, lng: number) => {
    const wazeApp = `waze://?ll=${lat},${lng}&navigate=yes`;
    const wazeWeb = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    Linking.canOpenURL(wazeApp)
      .then(supported => Linking.openURL(supported ? wazeApp : wazeWeb))
      .catch(() => Linking.openURL(wazeWeb));
  }, []);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleStatusUpdate = async (nextStatus: string) => {
    try {
      const updated = await updateStatus.mutateAsync({ id: tripId, data: { status: nextStatus as any } });
      setTrip(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.data?.error ?? 'No se pudo actualizar el estado.');
    }
  };

  const openVerify = () => {
    if (!trip?.passengerCode) return;
    setVerifyCodes(generateVerifyCodes(trip.passengerCode));
    setVerifyError(false);
    setShowVerify(true);
  };

  const handleVerifyCode = (code: string) => {
    if (code !== trip?.passengerCode) { setVerifyError(true); return; }
    setShowVerify(false);
    handleStatusUpdate('in_progress');
  };

  const handleSendMessage = async () => {
    const content = msgText.trim();
    if (!content) return;
    setMsgText('');
    try { await sendMsg.mutateAsync({ id: tripId, data: { content } }); } catch { /* ignore */ }
  };

  const submitRating = async () => {
    if (ratingStars === 0) return;
    try {
      const token = await AsyncStorage.getItem('auth_token');
      await fetch(`${BASE_URL}/trips/${tripId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ score: ratingStars }),
      });
      setRatingSubmitted(true);
      setShowRating(false);
      setShowPriceReport(true);
    } catch { setShowRating(false); setShowPriceReport(true); }
  };

  const submitPrice = async () => {
    const price = parseFloat(priceInput.replace(/\D/g, ''));
    if (!isNaN(price) && price > 0) {
      setPriceSubmitting(true);
      try {
        const token = await AsyncStorage.getItem('auth_token');
        await fetch(`${BASE_URL}/trips/${tripId}/actual-price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ price }),
        });
      } catch { /* ignore */ }
      setPriceSubmitting(false);
    }
    setShowPriceReport(false);
    router.back();
  };

  const skipPrice = () => { setShowPriceReport(false); router.back(); };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!trip) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.light.primary} />
        <Text style={styles.loadingText}>Cargando viaje...</Text>
      </View>
    );
  }

  const driverLat = trip.driver?.currentLat ?? trip.originLat;
  const driverLng = trip.driver?.currentLng ?? trip.originLng;

  const mapRegion = {
    latitude: (trip.originLat + trip.destinationLat) / 2,
    longitude: (trip.originLng + trip.destinationLng) / 2,
    latitudeDelta: Math.abs(trip.originLat - trip.destinationLat) * 2.8 + 0.04,
    longitudeDelta: Math.abs(trip.originLng - trip.destinationLng) * 2.8 + 0.04,
  };

  const isDone = trip.status === 'completed' || trip.status === 'cancelled';

  const countdownStr = countdown !== null
    ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
    : null;

  // Driver action button logic
  const driverAction: { label: string; next?: string; action?: () => void } | null = isDriver
    ? trip.status === 'pending' ? { label: 'Aceptar carrera', next: 'accepted' }
    : trip.status === 'accepted' ? { label: 'Estoy llegando', next: 'driver_arriving' }
    : trip.status === 'driver_arriving' ? { label: 'Verificar pasajero', action: openVerify }
    : trip.status === 'in_progress' ? { label: 'Completar viaje', next: 'completed' }
    : null
    : null;

  return (
    <View style={styles.root}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={mapRegion}
      >
        <Marker coordinate={{ latitude: trip.originLat, longitude: trip.originLng }} title="Origen">
          <View style={[styles.markerPin, { backgroundColor: colors.light.primary }]} />
        </Marker>
        <Marker coordinate={{ latitude: trip.destinationLat, longitude: trip.destinationLng }} title="Destino">
          <View style={[styles.markerPin, { backgroundColor: colors.light.destructive }]} />
        </Marker>
        {trip.driver && (
          <Marker coordinate={{ latitude: driverLat, longitude: driverLng }} title={trip.driver.name}>
            <View style={styles.taxiMarker}>
              <Text style={{ fontSize: 20 }}>🚕</Text>
            </View>
          </Marker>
        )}
        {/* Route when in progress */}
        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor={colors.light.primary} strokeWidth={4} />
        )}
        {/* Straight line when pending/accepted */}
        {routeCoords.length === 0 && (
          <Polyline
            coordinates={[
              { latitude: trip.originLat, longitude: trip.originLng },
              { latitude: trip.destinationLat, longitude: trip.destinationLng },
            ]}
            strokeColor={colors.light.border}
            strokeWidth={2}
            lineDashPattern={[8, 5]}
          />
        )}
      </MapView>

      {/* Status header */}
      <View style={[styles.header, { top: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.light.foreground} />
        </TouchableOpacity>

        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[trip.status] }]} />
          <Text style={styles.statusText}>{STATUS_LABELS[trip.status] ?? trip.status}</Text>
        </View>

        <TouchableOpacity
          style={[styles.chatBtn, unread > 0 && styles.chatBtnActive]}
          onPress={() => { setShowChat(v => !v); setUnread(0); }}
        >
          <Feather name="message-circle" size={20} color={showChat ? colors.light.primary : colors.light.foreground} />
          {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
        </TouchableOpacity>
      </View>

      {/* Countdown pill */}
      {countdownStr && (
        <View style={[styles.countdownPill, { top: insets.top + (Platform.OS === 'web' ? 120 : 80) }]}>
          <Feather name="clock" size={14} color={countdown! < 60 ? colors.light.destructive : colors.light.accent} />
          <Text style={[styles.countdownText, countdown! < 60 && { color: colors.light.destructive }]}>
            {countdown! <= 0 ? 'Tiempo agotado' : `El conductor llega en ${countdownStr}`}
          </Text>
        </View>
      )}

      {/* Bottom panel */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.panel, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 16) }]}
      >
        {showChat ? (
          /* ── Chat ── */
          <>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>Chat del viaje</Text>
              <TouchableOpacity onPress={() => setShowChat(false)}>
                <Feather name="chevron-down" size={20} color={colors.light.mutedForeground} />
              </TouchableOpacity>
            </View>
            <FlatList
              ref={flatRef}
              data={messages}
              keyExtractor={item => String(item.id)}
              style={styles.msgList}
              contentContainerStyle={{ padding: 10, gap: 8 }}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                const mine = item.senderId === user?.id;
                return (
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                    {!mine && <Text style={styles.senderName}>{item.senderName}</Text>}
                    <Text style={styles.bubbleText}>{item.content}</Text>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyChat}>Sin mensajes aún</Text>}
            />
            <View style={styles.inputRow}>
              <TextInput
                style={styles.chatInput}
                value={msgText}
                onChangeText={setMsgText}
                placeholder="Escribe un mensaje..."
                placeholderTextColor={colors.light.mutedForeground}
                returnKeyType="send"
                onSubmitEditing={handleSendMessage}
              />
              <TouchableOpacity style={[styles.sendBtn, !msgText.trim() && { opacity: 0.4 }]} onPress={handleSendMessage} disabled={!msgText.trim()}>
                <Feather name="send" size={18} color={colors.light.primaryForeground} />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          /* ── Trip info ── */
          <>
            {/* Price + route */}
            <View style={styles.tripInfo}>
              <View style={styles.priceRow}>
                <Text style={styles.priceValue}>${Number(trip.finalPrice ?? trip.estimatedPrice).toLocaleString('es-CO')}</Text>
                {!trip.finalPrice && <Text style={styles.priceEstLabel}> estimado</Text>}
                <Text style={styles.payMethod}>· Efectivo</Text>
              </View>
              <View style={styles.routeBlock}>
                <View style={styles.routeRow}><Feather name="circle" size={9} color={colors.light.primary} /><Text style={styles.routeText} numberOfLines={1}>{trip.originAddress}</Text></View>
                <View style={styles.routeRow}><Feather name="map-pin" size={9} color={colors.light.destructive} /><Text style={styles.routeText} numberOfLines={1}>{trip.destinationAddress}</Text></View>
              </View>

              {/* Passenger code (for passenger, shown while driver hasn't started trip) */}
              {!isDriver && ['accepted', 'driver_arriving'].includes(trip.status) && (
                <View style={styles.codeCard}>
                  <View>
                    <Text style={styles.codeLabel}>Tu código de identificación</Text>
                    <Text style={styles.codeHint}>Muéstraselo al conductor si te lo pide</Text>
                  </View>
                  <Text style={styles.codeValue}>{trip.passengerCode}</Text>
                </View>
              )}

              {/* Driver info */}
              {trip.driver && (
                <View style={styles.driverRow}>
                  <View style={styles.driverAvatar}>
                    <Text style={styles.driverAvatarText}>{trip.driver.name?.[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{trip.driver.name}</Text>
                    <Text style={styles.driverRating}>★ {Number(trip.driver.rating).toFixed(1)} · Taxi</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Action buttons */}
            {!isDone && (
              <View style={styles.actions}>
                {isDriver && driverAction && (
                  <TouchableOpacity
                    style={styles.actionPrimary}
                    onPress={driverAction.action ?? (() => handleStatusUpdate(driverAction.next!))}
                    disabled={updateStatus.isPending}
                    activeOpacity={0.85}
                  >
                    {updateStatus.isPending
                      ? <ActivityIndicator color={colors.light.primaryForeground} />
                      : <Text style={styles.actionPrimaryText}>{driverAction.label}</Text>
                    }
                  </TouchableOpacity>
                )}

                {/* Waze navigation for driver */}
                {isDriver && (trip.status === 'accepted' || trip.status === 'driver_arriving') && (
                  <TouchableOpacity
                    style={styles.wazeBtn}
                    onPress={() => openWaze(Number(trip.originLat), Number(trip.originLng))}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.wazeIcon}>🗺️</Text>
                    <Text style={styles.wazeBtnText}>Navegar al origen con Waze</Text>
                  </TouchableOpacity>
                )}
                {isDriver && trip.status === 'in_progress' && (
                  <TouchableOpacity
                    style={styles.wazeBtn}
                    onPress={() => openWaze(Number(trip.destinationLat), Number(trip.destinationLng))}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.wazeIcon}>🗺️</Text>
                    <Text style={styles.wazeBtnText}>Navegar al destino con Waze</Text>
                  </TouchableOpacity>
                )}

                {!isDriver && trip.status === 'pending' && (
                  <TouchableOpacity
                    style={styles.actionCancel}
                    onPress={() => Alert.alert('Cancelar', '¿Cancelar la solicitud?', [
                      { text: 'No', style: 'cancel' },
                      { text: 'Sí, cancelar', style: 'destructive', onPress: () => handleStatusUpdate('cancelled') },
                    ])}
                  >
                    <Text style={styles.actionCancelText}>Cancelar solicitud</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {isDone && (
              <TouchableOpacity style={styles.actionPrimary} onPress={() => router.back()}>
                <Text style={styles.actionPrimaryText}>Volver al inicio</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </KeyboardAvoidingView>

      {/* ── Verify code modal (driver) ── */}
      <Modal visible={showVerify} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Verificar pasajero</Text>
            <Text style={styles.modalSubtitle}>
              ¿Cuál es el código del pasajero?{'\n'}(últimos 2 dígitos de su celular)
            </Text>
            {verifyError && (
              <View style={styles.verifyErrorBadge}>
                <Feather name="alert-circle" size={14} color={colors.light.destructive} />
                <Text style={styles.verifyErrorText}>Código incorrecto, intenta de nuevo</Text>
              </View>
            )}
            <View style={styles.codesRow}>
              {verifyCodes.map(code => (
                <TouchableOpacity
                  key={code}
                  style={[styles.codeOption, verifyError && styles.codeOptionError]}
                  onPress={() => handleVerifyCode(code)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.codeOptionText}>{code}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowVerify(false)} style={styles.modalCancelBtn}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Rating modal (passenger) ── */}
      <Modal visible={showRating} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Cómo fue tu viaje?</Text>
            <Text style={styles.modalSubtitle}>Califica el servicio de tu conductor</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(s => (
                <TouchableOpacity key={s} onPress={() => setRatingStars(s)} activeOpacity={0.7}>
                  <Text style={[styles.star, s <= ratingStars && styles.starActive]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            {ratingStars > 0 && (
              <Text style={styles.ratingLabel}>
                {ratingStars === 1 ? 'Muy malo' : ratingStars === 2 ? 'Malo' : ratingStars === 3 ? 'Regular' : ratingStars === 4 ? 'Bueno' : 'Excelente'}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.actionPrimary, ratingStars === 0 && { opacity: 0.4 }]}
              onPress={submitRating}
              disabled={ratingStars === 0}
            >
              <Text style={styles.actionPrimaryText}>Enviar calificación</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowRating(false); setShowPriceReport(true); }} style={styles.modalCancelBtn}>
              <Text style={styles.modalCancelText}>Omitir</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Price report modal (passenger, optional) ── */}
      <Modal visible={showPriceReport} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Cuánto pagaste?</Text>
            <Text style={styles.modalSubtitle}>
              Reportar el precio real ayuda al sistema a calcular tarifas más precisas
              y evitar cobros inflados. Es completamente opcional.
            </Text>
            <TextInput
              style={styles.priceReportInput}
              value={priceInput}
              onChangeText={t => setPriceInput(t.replace(/\D/g, ''))}
              placeholder="Ej: 12500"
              placeholderTextColor={colors.light.mutedForeground}
              keyboardType="numeric"
            />
            <Text style={styles.priceReportNote}>Precio en pesos colombianos (COP)</Text>
            <TouchableOpacity
              style={[styles.actionPrimary, (!priceInput || priceSubmitting) && { opacity: 0.4 }]}
              onPress={submitPrice}
              disabled={!priceInput || priceSubmitting}
            >
              {priceSubmitting
                ? <ActivityIndicator color={colors.light.primaryForeground} />
                : <Text style={styles.actionPrimaryText}>Reportar precio</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={skipPrice} style={styles.modalCancelBtn}>
              <Text style={styles.modalCancelText}>Omitir por ahora</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.light.background, gap: 12 },
  loadingText: { color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  markerPin: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  taxiMarker: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  // Header
  header: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.light.card + 'F0', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.light.border,
  },
  statusBadge: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.light.card + 'F0', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.light.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600', color: colors.light.foreground, fontFamily: 'Inter_600SemiBold', flexShrink: 1 },
  chatBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.light.card + 'F0', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.light.border,
  },
  chatBtnActive: { borderColor: colors.light.primary },
  badge: {
    position: 'absolute', top: -4, right: -4, width: 16, height: 16,
    backgroundColor: colors.light.destructive, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' },
  // Countdown
  countdownPill: {
    position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.light.card + 'F4', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.light.border,
  },
  countdownText: { fontSize: 13, fontWeight: '600', color: colors.light.accent, fontFamily: 'Inter_600SemiBold', flex: 1 },
  // Panel
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.light.card + 'F8',
    borderTopWidth: 1, borderTopColor: colors.light.border,
    paddingHorizontal: 16, paddingTop: 14, maxHeight: '55%',
  },
  tripInfo: { gap: 10, marginBottom: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  priceValue: { fontSize: 22, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  priceEstLabel: { fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  payMethod: { fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', marginLeft: 4 },
  routeBlock: { gap: 6 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeText: { flex: 1, fontSize: 13, color: colors.light.foreground, fontFamily: 'Inter_400Regular' },
  // Passenger code card
  codeCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.light.primary + '18', borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.primary + '50', paddingHorizontal: 14, paddingVertical: 10,
  },
  codeLabel: { fontSize: 13, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  codeHint: { fontSize: 11, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
  codeValue: { fontSize: 36, fontWeight: '900', color: colors.light.primary, fontFamily: 'Inter_700Bold', letterSpacing: 4 },
  // Driver row
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.light.primary, alignItems: 'center', justifyContent: 'center',
  },
  driverAvatarText: { fontSize: 16, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  driverName: { fontSize: 14, fontWeight: '600', color: colors.light.foreground, fontFamily: 'Inter_600SemiBold' },
  driverRating: { fontSize: 12, color: colors.light.accent, fontFamily: 'Inter_400Regular' },
  // Actions
  actions: { gap: 8 },
  actionPrimary: {
    backgroundColor: colors.light.primary, borderRadius: colors.radius,
    paddingVertical: 14, alignItems: 'center',
  },
  actionPrimaryText: { fontSize: 15, fontWeight: '700', color: colors.light.primaryForeground, fontFamily: 'Inter_700Bold' },
  actionCancel: {
    borderWidth: 1, borderColor: colors.light.destructive + '60',
    borderRadius: colors.radius, paddingVertical: 12, alignItems: 'center',
    backgroundColor: colors.light.destructive + '12',
  },
  actionCancelText: { fontSize: 14, fontWeight: '600', color: colors.light.destructive, fontFamily: 'Inter_600SemiBold' },
  // Chat
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.light.border },
  chatTitle: { fontSize: 15, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  msgList: { maxHeight: 180 },
  emptyChat: { textAlign: 'center', color: colors.light.mutedForeground, padding: 16, fontFamily: 'Inter_400Regular' },
  bubble: { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, gap: 2 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.light.primary },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: colors.light.secondary },
  senderName: { fontSize: 10, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  bubbleText: { fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_400Regular' },
  inputRow: { flexDirection: 'row', gap: 10, paddingTop: 10, alignItems: 'center' },
  chatInput: {
    flex: 1, backgroundColor: colors.light.input, borderRadius: 20,
    borderWidth: 1, borderColor: colors.light.border,
    paddingHorizontal: 14, paddingVertical: 10,
    color: colors.light.foreground, fontSize: 14, fontFamily: 'Inter_400Regular',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.light.primary, alignItems: 'center', justifyContent: 'center',
  },
  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: '#00000090',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: colors.light.card, borderRadius: colors.radius + 4,
    padding: 24, width: '100%', gap: 14,
    borderWidth: 1, borderColor: colors.light.border,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  modalSubtitle: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  // Verify
  verifyErrorBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.light.destructive + '18', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  verifyErrorText: { fontSize: 13, color: colors.light.destructive, fontFamily: 'Inter_400Regular' },
  codesRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  codeOption: {
    flex: 1, height: 70, borderRadius: colors.radius,
    backgroundColor: colors.light.secondary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.light.border,
  },
  codeOptionError: { borderColor: colors.light.destructive + '60' },
  codeOptionText: { fontSize: 28, fontWeight: '900', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  modalCancelBtn: { alignItems: 'center', paddingVertical: 4 },
  modalCancelText: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  // Stars
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  star: { fontSize: 44, color: colors.light.border },
  starActive: { color: '#FFB800' },
  ratingLabel: { textAlign: 'center', fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_600SemiBold' },
  // Waze button
  wazeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#00BBEE',
    borderRadius: colors.radius, paddingVertical: 12,
    backgroundColor: '#00BBEE18',
  },
  wazeIcon: { fontSize: 18 },
  wazeBtnText: { fontSize: 14, fontWeight: '600', color: '#00BBEE', fontFamily: 'Inter_600SemiBold' },
  // Price report
  priceReportInput: {
    backgroundColor: colors.light.input, borderRadius: colors.radius,
    borderWidth: 1, borderColor: colors.light.border,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 22, fontWeight: '700', color: colors.light.foreground,
    fontFamily: 'Inter_700Bold', textAlign: 'center',
  },
  priceReportNote: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
