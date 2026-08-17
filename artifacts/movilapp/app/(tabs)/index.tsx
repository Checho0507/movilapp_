import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, Alert, Animated, Vibration, Image, TextInput, ScrollView, Keyboard,
  KeyboardAvoidingView,
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

type SearchResult = { lat: number; lng: number; address: string };

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = { 'User-Agent': 'MovilApp/1.0' };

// Expand common Colombian address abbreviations so the geocoder understands them
function normalizeAddress(raw: string): string {
  let s = ' ' + raw.trim() + ' ';
  const subs: [RegExp, string][] = [
    [/\s(cra|cr|kra|kr|carr)\.?(?=[\s\d#])/gi, ' Carrera'],
    [/\s(cll|cl|cle)\.?(?=[\s\d#])/gi, ' Calle'],
    [/\s(av|avda)\.?(?=[\s\d#])/gi, ' Avenida'],
    [/\s(dg|diag)\.?(?=[\s\d#])/gi, ' Diagonal'],
    [/\s(tv|transv|trans)\.?(?=[\s\d#])/gi, ' Transversal'],
    [/\s(no|nro|num)\.?(?=[\s\d#])/gi, ' #'],
  ];
  for (const [re, rep] of subs) s = s.replace(re, rep);
  // "#11A09" / "# 11A-09" → "# 11A-09" (insert dash between cross-street number and house number)
  s = s.replace(/#\s*(\d+[a-zA-Z]?)\s*[-–]?\s*(\d+)/g, '# $1-$2');
  return s.replace(/\s+/g, ' ').trim();
}

// Parse "Carrera 44 # 11A-09" → main street + implied cross street (Calle 11A)
function parseColombianAddress(normalized: string): { main: string; cross: string; plate: string } | null {
  const m = normalized.match(/(Carrera|Calle|Avenida|Diagonal|Transversal)\s+(\d+[a-zA-Z]{0,2})\s*(bis)?\s*#\s*(\d+[a-zA-Z]{0,2})\s*-\s*(\d+)/i);
  if (!m) return null;
  const [, type, num, bis, crossNum, house] = m;
  const t = type.toLowerCase();
  // In Colombian nomenclature, Carreras cross Calles and vice versa
  const crossType = (t === 'carrera' || t === 'transversal') ? 'Calle' : 'Carrera';
  const mainName = bis ? `${type} ${num} Bis` : `${type} ${num}`;
  return {
    main: mainName,
    cross: `${crossType} ${crossNum}`,
    plate: `${mainName} # ${crossNum}-${house}`,
  };
}

async function nominatimSearch(params: string, limit = 6): Promise<any[]> {
  try {
    const res = await fetch(
      `${NOMINATIM}/search?format=json&limit=${limit}&countrycodes=co&accept-language=es&${params}`,
      { headers: UA },
    );
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function toResult(r: any): SearchResult {
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    address: (r.display_name as string).split(',').slice(0, 4).join(',').trim(),
  };
}

// Does the query already mention a city/municipality name (rough check: any word of the
// detected city appears), or contain a comma-separated locality?
function queryMentionsCity(query: string, city: string | null): boolean {
  if (/,/.test(query)) return true;
  if (!city) return false;
  return query.toLowerCase().includes(city.toLowerCase());
}

// Search addresses anywhere in Colombia. Automatically scopes to the user's GPS-detected
// city when the query doesn't mention one, and resolves Colombian plates
// ("Carrera 44 # 11A-09") to the street intersection so the pin lands in the right barrio.
async function searchAddress(
  query: string,
  near: { lat: number; lng: number } | null,
  city: string | null,
): Promise<SearchResult[]> {
  const normalized = normalizeAddress(query);
  const parsed = parseColombianAddress(normalized);
  const useCity = !queryMentionsCity(normalized, city) ? city : null;
  const fullQuery = useCity ? `${normalized}, ${useCity}` : normalized;

  // 1) Direct search (may hit an exact house number if mapped)
  let viewbox = '';
  if (near) {
    const d = 0.55; // bias (not restrict) toward ~60 km around the user
    viewbox = `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
  }
  let direct = await nominatimSearch(`q=${encodeURIComponent(fullQuery)}${viewbox}`);
  // POI names (e.g. "parque lleras") often fail with an appended city — retry without it,
  // first restricted to the user's area, then country-wide
  if (direct.length === 0 && viewbox) {
    direct = await nominatimSearch(`q=${encodeURIComponent(normalized)}${viewbox}&bounded=1`);
  }
  if (direct.length === 0 && useCity) {
    direct = await nominatimSearch(`q=${encodeURIComponent(normalized)}${viewbox}`);
  }

  // Exact building/house matches win
  const exact = direct.filter((r: any) => r.type === 'house' || r.class === 'building' || r.addresstype === 'house');
  if (exact.length > 0) {
    const results = exact.map(toResult);
    if (near) results.sort((a, b) => haversine(near.lat, near.lng, a.lat, a.lng) - haversine(near.lat, near.lng, b.lat, b.lng));
    return results;
  }

  // 2) Colombian plate: approximate the intersection of the two streets.
  // City scope: prefer the city the user typed (after a comma), else the GPS city.
  if (parsed) {
    const typedCity = /,/.test(query) ? query.split(',').pop()!.trim() : null;
    const cityParam = typedCity || city || '';
    const cityQ = cityParam ? `&city=${encodeURIComponent(cityParam)}` : '';
    if (cityQ) {
      const [mainSegs, crossSegs] = await Promise.all([
        nominatimSearch(`street=${encodeURIComponent(parsed.main)}${cityQ}`, 20),
        nominatimSearch(`street=${encodeURIComponent(parsed.cross)}${cityQ}`, 20),
      ]);
      let best: { d: number; a: any; b: any } | null = null;
      for (const a of mainSegs) {
        for (const b of crossSegs) {
          const d = haversine(parseFloat(a.lat), parseFloat(a.lon), parseFloat(b.lat), parseFloat(b.lon));
          if (!best || d < best.d) best = { d, a, b };
        }
      }
      // Only trust the pair when the segments are close enough to plausibly intersect
      if (best && best.d < 1.5) {
        const lat = (parseFloat(best.a.lat) + parseFloat(best.b.lat)) / 2;
        const lng = (parseFloat(best.a.lon) + parseFloat(best.b.lon)) / 2;
        // Barrio/city come from the main street segment's display name (skip the street part)
        const context = (best.a.display_name as string).split(',').slice(1, 4).join(',').trim();
        const approx: SearchResult = { lat, lng, address: `${parsed.plate} (aprox.), ${context}` };
        // Keep street matches as alternative options below the approximation
        const others = direct.map(toResult);
        return [approx, ...others.slice(0, 4)];
      }
    }
  }

  // 3) Fallback: street/place matches from the direct search
  const results = direct.map(toResult);
  if (near) results.sort((a, b) => haversine(near.lat, near.lng, a.lat, a.lng) - haversine(near.lat, near.lng, b.lat, b.lng));
  return results;
}

// Reverse geocode: returns short address plus the detected city/municipality
async function reverseGeocodeFull(lat: number, lng: number): Promise<{ address: string; city: string | null }> {
  try {
    const res = await fetch(
      `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`,
      { headers: UA },
    );
    const data = await res.json();
    const a = data.address ?? {};
    const city = a.city ?? a.town ?? a.municipality ?? a.village ?? null;
    if (data.display_name) {
      const parts = (data.display_name as string).split(',');
      return { address: parts.slice(0, 3).join(',').trim(), city };
    }
  } catch { /* ignore */ }
  return { address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, city: null };
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
  const [origin, setOrigin] = useState<Pin | null>(null);
  const [dest, setDest] = useState<Pin | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [activeTripId, setActiveTripId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentKey>('cash');

  // Address search state
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pending, setPending] = useState<Pin | null>(null); // candidate awaiting confirmation
  const searchReqId = useRef(0);
  const selectSessionId = useRef(0);

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
      setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setRegion(r);
      mapRef.current?.animateToRegion(r, 600);
      // Detect the user's city for automatic address scoping
      const { city } = await reverseGeocodeFull(pos.coords.latitude, pos.coords.longitude);
      if (city) setUserCity(city);
    })();
  }, []);

  // Debounced address search while typing (guarded against stale responses)
  useEffect(() => {
    if (step !== 'selectOrigin' && step !== 'selectDest') return;
    if (pending) return; // a candidate was chosen; don't re-search until the user edits the text
    if (query.trim().length < 3) { setResults([]); setIsSearching(false); return; }
    const reqId = ++searchReqId.current;
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      setIsSearching(true);
      const found = await searchAddress(query.trim(), userLoc, userCity);
      if (reqId !== searchReqId.current) return; // a newer search/step superseded this one
      setResults(found);
      setIsSearching(false);
    }, 700);
    return () => {
      searchReqId.current++; // invalidate in-flight response
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, step, pending, userLoc, userCity]);

  const pickResult = (r: SearchResult) => {
    Keyboard.dismiss();
    setPending({ lat: r.lat, lng: r.lng, address: r.address });
    setResults([]);
    setQuery(r.address);
    const reg: Region = { latitude: r.lat, longitude: r.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 };
    setRegion(reg);
    mapRef.current?.animateToRegion(reg, 500);
  };

  const handleRegionChange = useCallback((r: Region) => {
    setRegion(r);
  }, []);

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
    const session = ++selectSessionId.current;
    setQuery('');
    setResults([]);
    setPending(null);
    setStep('selectOrigin');
    // Suggest current GPS location as the starting point
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (session !== selectSessionId.current) return;
      const { latitude: lat, longitude: lng } = pos.coords;
      setUserLoc({ lat, lng });
      const reg: Region = { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.008 };
      setRegion(reg);
      mapRef.current?.animateToRegion(reg, 500);
      const { address: addr, city } = await reverseGeocodeFull(lat, lng);
      if (session !== selectSessionId.current) return;
      if (city) setUserCity(city);
      setPending({ lat, lng, address: addr });
      setQuery(addr);
    } catch { /* user will type the address */ }
  };

  const confirmOrigin = () => {
    if (!pending) return;
    setOrigin(pending);
    setPending(null);
    setQuery('');
    setResults([]);
    setStep('selectDest');
  };

  const confirmDest = () => {
    if (!pending) return;
    setDest(pending);
    setPending(null);
    setQuery('');
    setResults([]);
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
    selectSessionId.current++; // discard any in-flight GPS/geocode result
    setOrigin(null);
    setDest(null);
    setPending(null);
    setQuery('');
    setResults([]);
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
        scrollEnabled={false}
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
        {pending && isSelectingMode && (
          <Marker coordinate={{ latitude: pending.lat, longitude: pending.lng }} title={step === 'selectOrigin' ? 'Punto de partida' : 'Destino'}>
            <View style={[styles.markerDot, { backgroundColor: pinColor }]} />
          </Marker>
        )}
      </MapView>

      {/* Top label (selection modes) */}
      {isSelectingMode && (
        <View style={[styles.topLabel, { top: insets.top + (Platform.OS === 'web' ? 67 : 16) }]}>
          <Text style={styles.topLabelText}>
            {step === 'selectOrigin' ? '📍 Escribe la dirección de tu punto de partida' : '🎯 Escribe la dirección de tu destino'}
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

      {/* Bottom sheet — address search (origin / destination) */}
      {isSelectingMode && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetKeyboardWrap}
          pointerEvents="box-none"
        >
        <View style={[styles.sheet, styles.sheetStatic, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          {step === 'selectDest' && (
            <View style={[styles.addressRow, { marginBottom: 6 }]}>
              <Feather name="circle" size={10} color={colors.light.primary} />
              <Text style={[styles.addressText, { color: colors.light.mutedForeground, fontSize: 13 }]} numberOfLines={1}>
                {origin?.address}
              </Text>
            </View>
          )}

          <View style={styles.searchRow}>
            <Feather
              name={step === 'selectOrigin' ? 'circle' : 'map-pin'}
              size={14}
              color={pinColor}
            />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={(t) => { setQuery(t); setPending(null); }}
              placeholder={step === 'selectOrigin' ? 'Ej: Calle 45 # 20-15, Medellín' : '¿A dónde vas? Ej: Cra 7 # 32-10'}
              placeholderTextColor={colors.light.mutedForeground}
              autoCorrect={false}
            />
            {isSearching && <ActivityIndicator size="small" color={colors.light.primary} />}
            {!isSearching && query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setPending(null); }}>
                <Feather name="x" size={16} color={colors.light.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          {/* Search results */}
          {results.length > 0 && (
            <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
              {results.map((r, i) => (
                <TouchableOpacity key={i} style={styles.resultRow} onPress={() => pickResult(r)} activeOpacity={0.7}>
                  <Feather name="map-pin" size={14} color={colors.light.mutedForeground} />
                  <Text style={styles.resultText} numberOfLines={2}>{r.address}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {results.length === 0 && !isSearching && !pending && query.trim().length >= 3 && (
            <Text style={styles.noResultsText}>No encontramos esa dirección. Intenta agregar la ciudad, ej: "Calle 10 # 5-20, Cali"</Text>
          )}

          {/* Confirmation */}
          {pending && (
            <View style={styles.pendingBox}>
              <Text style={styles.pendingLabel}>¿Es correcta esta ubicación?</Text>
              <Text style={styles.pendingAddress} numberOfLines={2}>{pending.address}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              step === 'selectDest' && { backgroundColor: colors.light.destructive },
              !pending && styles.btnDisabled,
            ]}
            onPress={step === 'selectOrigin' ? confirmOrigin : confirmDest}
            disabled={!pending}
            activeOpacity={0.85}
          >
            <Feather name="check" size={18} color={colors.light.primaryForeground} />
            <Text style={styles.primaryBtnText}>
              {step === 'selectOrigin' ? 'Sí, es mi punto de partida' : 'Sí, es mi destino'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={step === 'selectOrigin' ? resetSelection : () => { setStep('selectOrigin'); setPending(origin); setQuery(origin?.address ?? ''); setResults([]); }}
          >
            <Text style={styles.secondaryBtnText}>{step === 'selectOrigin' ? 'Cancelar' : '← Cambiar origen'}</Text>
          </TouchableOpacity>
        </View>
        </KeyboardAvoidingView>
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
  // Always start offline — drivers must manually connect each session
  const [isOnline, setIsOnline] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [panicPending, setPanicPending] = useState(false);
  const panicAnim = useRef(new Animated.Value(1)).current;
  const updateStatus = useUpdateDriverStatus();
  const updateLocation = useUpdateDriverLocation();
  const acceptTrip = useUpdateTripStatus();

  // On mount, force the server state to offline so previous sessions don't linger
  useEffect(() => {
    updateStatus.mutate({ data: { isOnline: false } });
    updateUser({ isOnline: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const httpStatus = e?.response?.status ?? e?.status;
      if (err?.code === 'SUBSCRIPTION_REQUIRED' || httpStatus === 403) {
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
      <View style={styles.brandWrap}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.brandLogo}
          resizeMode="contain"
        />
        <Text style={styles.brandName}>MovilApp</Text>
        <Text style={styles.brandTagline}>Tu servicio de taxi confiable</Text>
      </View>

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
  brandWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  brandLogo: { width: 140, height: 140 },
  brandName: { fontSize: 30, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  brandTagline: { fontSize: 14, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
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
  sheetKeyboardWrap: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    justifyContent: 'flex-end',
  },
  sheetStatic: { position: 'relative', bottom: undefined, left: undefined, right: undefined },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.light.card + 'F8',
    borderTopWidth: 1, borderTopColor: colors.light.border,
    paddingHorizontal: 20, paddingTop: 18, gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.light.muted, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 12 : 4,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1, fontSize: 15, color: colors.light.foreground,
    fontFamily: 'Inter_400Regular', paddingVertical: Platform.OS === 'web' ? 0 : 10,
  },
  resultsList: { maxHeight: 190, marginBottom: 8 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.light.border,
  },
  resultText: { flex: 1, fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  noResultsText: {
    fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular',
    marginBottom: 10, lineHeight: 18,
  },
  pendingBox: {
    backgroundColor: colors.light.muted, borderRadius: 12,
    padding: 12, marginBottom: 12,
  },
  pendingLabel: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  pendingAddress: { fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_500Medium', lineHeight: 19 },
  btnDisabled: { opacity: 0.45 },
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
