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
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { useCreateTrip, useUpdateDriverStatus, useUpdateDriverLocation, useUpdateTripStatus } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import colors from '@/constants/colors';
import { getApiUrl } from '@/lib/api-config';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

const BOGOTA: Region = { latitude: 4.711, longitude: -74.0721, latitudeDelta: 0.06, longitudeDelta: 0.06 };
const DRIVER_ACCEPT_RADIUS_KM = 1;

const PAYMENT_OPTIONS = [
  { key: 'cash', label: 'Efectivo' },
  { key: 'transfer', label: 'Transferencia' },
] as const;

const TRANSFER_OPTIONS = [
  { key: 'nequi', label: 'Nequi' },
  { key: 'daviplata', label: 'Daviplata' },
  { key: 'breve', label: 'Breve' },
] as const;

type PaymentKey = 'cash' | 'transfer';
type TransferKey = typeof TRANSFER_OPTIONS[number]['key'];

function PaymentIcon({ type }: { type: 'cash' | 'transfer' | 'nequi' | 'daviplata' | 'breve' }) {
  const yellow = '#F6C949';
  const yellowSoft = '#F0B400';
  const dark = '#1E1B18';

  if (type === 'cash') {
    return (
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Rect x="3.5" y="6" width="17" height="12" rx="2.5" fill={yellow} />
        <Path d="M7 10.5H15.5C16.88 10.5 18 9.38 18 8V7.5H9.5C8.12 7.5 7 8.62 7 10V10.5Z" fill={yellowSoft} opacity={0.8} />
        <Path d="M8 14.5H16.5M8 17.5H14" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />
        <Circle cx="17.5" cy="10" r="1.8" fill={dark} />
      </Svg>
    );
  }

  if (type === 'transfer') {
    return (
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Rect x="4" y="5" width="12" height="14" rx="2.8" fill={yellow} />
        <Rect x="8" y="3.5" width="12" height="14" rx="2.8" fill={yellowSoft} opacity={0.95} />
        <Path d="M9 10.5L7.5 9L9 7.5M15 13.5L16.5 15L15 16.5" stroke={dark} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M7.5 9H13.5C15.16 9 16.5 10.34 16.5 12V13M16.5 15H10.5C8.84 15 7.5 13.66 7.5 12V11" stroke={dark} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }

  const accent = type === 'nequi' ? '#F7D449' : type === 'daviplata' ? '#F0B400' : '#F8E27F';
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8" fill={yellow} />
      <Path d="M8.5 8.5H15.5V10.3H12.5V15.5H10.7V10.3H8.5V8.5Z" fill={dark} />
      <Circle cx="16.2" cy="7.5" r="2.2" fill={accent} opacity={0.65} />
    </Svg>
  );
}

function getPaymentInfo(method?: string) {
  if (method === 'cash') return { kind: 'cash' as const, label: 'Efectivo' };
  const transferMatch = TRANSFER_OPTIONS.find(opt => opt.key === method);
  if (transferMatch) return { kind: method as 'nequi' | 'daviplata' | 'breve', label: `Transferencia (${transferMatch.label})` };
  return { kind: 'cash' as const, label: 'Efectivo' };
}

type Step = 'idle' | 'selectOrigin' | 'selectDest' | 'confirm' | 'searching' | 'no_drivers';
type Pin = { lat: number; lng: number; address: string };

type SearchResult = { lat: number; lng: number; address: string };

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const NOMINATIM_TIMEOUT_MS = 1500;
const UA = { 'User-Agent': 'MovilApp/1.0' };
const geocodeCache = new Map<string, SearchResult[]>();

// Expand common Colombian address abbreviations so the geocoder understands them
function normalizeAddress(raw: string): string {
  let s = ' ' + raw.trim() + ' ';
  const subs: [RegExp, string][] = [
    [/\s(cra|cr|kra|kr|carr|carrea)\.? (?=[\s\d#])/gi, ' Carrera '],
    [/\s(cll|cl|cle)\.? (?=[\s\d#])/gi, ' Calle '],
    [/\s(av|avda)\.? (?=[\s\d#])/gi, ' Avenida '],
    [/\s(dg|diag)\.? (?=[\s\d#])/gi, ' Diagonal '],
    [/\s(tv|transv|trans)\.? (?=[\s\d#])/gi, ' Transversal '],
    [/\s(no|nro|num)\.? (?=[\s\d#])/gi, ' # '],
  ];
  for (const [re, rep] of subs) s = s.replace(re, rep);
  s = s.replace(/(Carrera|Calle|Avenida|Diagonal|Transversal)\s+(\d+[a-zA-Z]{0,2})\s+(\d+)\s+(\d+)/gi, '$1 $2 # $3-$4');
  s = s.replace(/#\s*(\d+[a-zA-Z]?)\s*[-–]?\s*(\d+)/g, '# $1-$2');
  s = s.replace(/#\s*(\d+[a-zA-Z]?)\s+(\d+)/g, '# $1-$2');
  return s.replace(/\s+/g, ' ').trim();
}

// Parse "Carrera 44 # 11A-09" → main street + implied cross street (Calle 11A)
// Handle both the standard form and the common shorthand that omits the dash: "#11A09".
function parseColombianAddress(normalized: string): { main: string; cross: string; plate: string } | null {
  const patterns = [
    /(Carrera|Calle|Avenida|Diagonal|Transversal)\s+(\d+[a-zA-Z]{0,2})\s*(bis)?\s*#\s*(\d+[a-zA-Z]{0,2})\s*-\s*(\d+)/i,
    /(Carrera|Calle|Avenida|Diagonal|Transversal)\s+(\d+[a-zA-Z]{0,2})\s*(bis)?\s*#\s*(\d+[a-zA-Z]{0,2})(\d+)/i,
  ];

  for (const pattern of patterns) {
    const m = normalized.match(pattern);
    if (!m) continue;
    const [, type, num, bis, crossNum, house] = m;
    const t = type.toLowerCase();
    // In Colombian nomenclature, Carreras cross Calles and vice versa.
    const crossType = (t === 'carrera' || t === 'transversal') ? 'Calle' : 'Carrera';
    const mainName = bis ? `${type} ${num} Bis` : `${type} ${num}`;
    return {
      main: mainName,
      cross: `${crossType} ${crossNum}`,
      plate: `${mainName} # ${crossNum}-${house}`,
    };
  }

  return null;
}

async function nominatimSearch(params: string, limit = 6, signal?: AbortSignal): Promise<any[]> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${NOMINATIM}/search?format=json&limit=${limit}&countrycodes=co&accept-language=es&${params}`,
      { headers: UA, signal: controller.signal },
    );
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    clearTimeout(timer);
  }
}

function normalizeCityName(city: string | null): string | null {
  if (!city) return null;
  const cleaned = city
    .replace(/^(perímetro\s+urbano|perimetro\s+urbano|urbano\s+|area\s+urbana\s+)/gi, '')
    .replace(/^\s*[-,\s]+|[-,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}

function normalizeNeighborhoodName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(barrio|vereda|urbanización|urbanizacion|sector|asentamiento|corregimiento)\s+/i, '')
    .replace(/^(perímetro\s+urbano|perimetro\s+urbano|urbano\s+)/i, '')
    .replace(/^\s*[-,\s]+|[-,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}

function pickNeighborhoodFromDisplayName(displayName: string | null): string | null {
  const parts = (displayName ?? '').split(',').map(part => part.trim()).filter(Boolean);
  const generic = /^(colombia|departamento|municipio|localidad|ciudad|comuna|upz|rap|caldas|antioquia|bogotá|bogota|manizales|medellín|medellin|cundinamarca|perímetro urbano|perimetro urbano|zona)$/i;

  for (const part of parts) {
    const cleaned = normalizeNeighborhoodName(part);
    if (!cleaned || generic.test(cleaned)) continue;
    if (/^(calle|carrera|avenida|av|kra|cra|cll|tv|transversal|diagonal|#)/i.test(cleaned)) continue;
    if (/\d/.test(cleaned)) continue;
    return cleaned;
  }

  return null;
}

function formatExactPlateAddress(raw: string, city: string | null, displayName?: string | null): string {
  const safeNeighborhood = pickNeighborhoodFromDisplayName(displayName ?? null);
  const normalized = normalizeAddress(raw);
  const preserveHyphen =
    /#\s*\d+[a-zA-Z]?\s*[-–]\s*\d+/i.test(raw) ||
    /#\s*\d+\s+\d+/i.test(raw) ||
    /\b\d+\s+\d+\s+\d+\b/.test(raw) ||
    /\b\d+\s+\d+\s*-\s*\d+\b/.test(raw);
  const formatted = normalized
    .replace(/\s*#\s*/g, ' #')
    .replace(/#\s*(\d+)([a-zA-Z]?)(?:[-–])?(\d+)/gi, (_, first: string, letter: string, last: string) => {
      const suffix = (letter || '').toLowerCase();
      return preserveHyphen ? `#${first}${suffix}-${last}` : `#${first}${suffix}${last}`;
    })
    .replace(/(\d+)([a-zA-Z])(?=\s|$|#)/g, (_, num: string, letter: string) => `${num}${letter.toLowerCase()}`)
    .replace(/\s+/g, ' ')
    .trim();

  const exact = safeNeighborhood ? `${formatted}, ${safeNeighborhood}` : formatted;
  return exact.replace(/\s+,/g, ',').trim();
}

function formatAddressWithNeighborhood(displayName: string, fallback?: string): string {
  const parts = (displayName ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return fallback ?? '';

  const neighborhood = pickNeighborhoodFromDisplayName(displayName) || parts.find((part) => /^(barrio|vereda|urbanización|urbanizacion|sector|asentamiento|corregimiento)\b/i.test(part));
  const meaningful = parts.filter((part) => !/^(comuna|localidad|municipio|distrito|departamento|upz|rap|colombia|perímetro urbano|perimetro urbano|ciudad|bogotá|bogota|medellín|medellin)$/i.test(part));

  const base = meaningful.slice(0, 4).join(', ').trim();
  if (neighborhood && !base.toLowerCase().includes(neighborhood.toLowerCase())) {
    return `${base}, ${normalizeNeighborhoodName(neighborhood) || neighborhood}`.trim();
  }

  return base || fallback || parts.slice(0, 4).join(', ');
}

function toResult(r: any): SearchResult {
  const displayName = (r.display_name as string) ?? '';
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    address: formatAddressWithNeighborhood(displayName, displayName.split(',').slice(0, 4).join(',').trim()),
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
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (signal?.aborted) return [];

  const normalized = normalizeAddress(query);
  const cacheKey = `${normalized}|${near ? `${near.lat.toFixed(4)}:${near.lng.toFixed(4)}` : 'global'}|${city ?? ''}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  if (normalized.length < 3) {
    geocodeCache.set(cacheKey, []);
    return [];
  }

  const parsed = parseColombianAddress(normalized);
  const useCity = !queryMentionsCity(normalized, city) ? city : null;
  const fullQuery = useCity ? `${normalized}, ${useCity}` : normalized;
  const exactDisplay = parsed ? formatExactPlateAddress(normalized, useCity || city || null, null) : null;

  let viewbox = '';
  if (near) {
    const d = 0.55;
    viewbox = `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
  }

  let direct = await nominatimSearch(`q=${encodeURIComponent(fullQuery)}${viewbox}`, 5, signal);
  if (signal?.aborted) return [];

  if (direct.length === 0 && viewbox) {
    direct = await nominatimSearch(`q=${encodeURIComponent(normalized)}${viewbox}&bounded=1`, 5, signal);
    if (signal?.aborted) return [];
  }

  if (direct.length === 0 && useCity) {
    direct = await nominatimSearch(`q=${encodeURIComponent(normalized)}${viewbox}`, 5, signal);
    if (signal?.aborted) return [];
  }

  if (direct.length > 0) {
    const exact = direct.filter((r: any) => r.type === 'house' || r.class === 'building' || r.addresstype === 'house');
    const results = exact.length > 0 ? exact.map(toResult) : direct.map(toResult);
    if (near) results.sort((a, b) => haversine(near.lat, near.lng, a.lat, a.lng) - haversine(near.lat, near.lng, b.lat, b.lng));
    const isExactPlateQuery = /#\s*\d+[a-zA-Z]?(?:\s*-\s*\d+)?/i.test(normalized);
    if (parsed && isExactPlateQuery && exactDisplay) {
      const intersectionCandidates = [
        `${parsed.main} ${parsed.cross}${useCity ? `, ${useCity}` : ''}`,
        `${parsed.main}${useCity ? `, ${useCity}` : ''}`,
      ];

      for (const candidate of intersectionCandidates) {
        const intersection = await nominatimSearch(`q=${encodeURIComponent(candidate)}${viewbox}&bounded=1`, 4, signal);
        if (signal?.aborted) return [];
        if (intersection.length > 0) {
          const intersectionResults = intersection.map(toResult).slice(0, 3);
          intersectionResults.forEach((result) => {
            const display = result.address || '';
            result.address = formatExactPlateAddress(normalized, useCity || city || null, display);
          });
          geocodeCache.set(cacheKey, intersectionResults);
          return intersectionResults;
        }
      }

      results.forEach((result) => {
        const display = result.address || '';
        result.address = formatExactPlateAddress(normalized, useCity || city || null, display);
      });
    }
    geocodeCache.set(cacheKey, results);
    return results;
  }

  const isStreetLikeQuery = /\b(calle|carrera|av|avda|avenida|transversal|diagonal|kr|cra|cll|tv)\b|\d/.test(normalized.toLowerCase());
  const isExactPlateQuery = /#\s*\d+[a-zA-Z]?(?:\s*-\s*\d+)?/i.test(normalized);
  if (parsed && isStreetLikeQuery && normalized.length >= 6) {
    const typedCity = /,/.test(query) ? query.split(',').pop()!.trim() : null;
    const cityParam = typedCity || city || '';

    if (isExactPlateQuery) {
      const plateWithoutHyphen = parsed.plate.replace(/#\s*([A-Za-z0-9]+)-([A-Za-z0-9]+)/i, '# $1$2');
      const exactDisplay = formatExactPlateAddress(normalized, cityParam || null, null);
      const exactCandidates = [
        `${parsed.plate}${cityParam ? `, ${cityParam}` : ''}`,
        `${plateWithoutHyphen}${cityParam ? `, ${cityParam}` : ''}`,
        `${parsed.main} ${parsed.cross}${cityParam ? `, ${cityParam}` : ''}`,
        `${parsed.main}${cityParam ? `, ${cityParam}` : ''}`,
      ];

      for (const candidate of exactCandidates) {
        const single = await nominatimSearch(`q=${encodeURIComponent(candidate)}${viewbox}&bounded=1`, 5, signal);
        if (signal?.aborted) return [];
        if (single.length > 0) {
          const results = single.map(toResult).slice(0, 4);
          results.forEach((result) => {
            const display = result.address || '';
            result.address = formatExactPlateAddress(normalized, cityParam || null, display);
          });
          geocodeCache.set(cacheKey, results);
          return results;
        }
      }

      if (cityParam) {
        const streetResults = await nominatimSearch(`street=${encodeURIComponent(parsed.main)}&city=${encodeURIComponent(cityParam)}`, 6, signal);
        if (signal?.aborted) return [];
        if (streetResults.length > 0) {
          const results = streetResults.map(toResult).slice(0, 4);
          results.forEach((result) => {
            const display = result.address || '';
            result.address = formatExactPlateAddress(normalized, cityParam || null, display);
          });
          geocodeCache.set(cacheKey, results);
          return results;
        }
      }

      const fallback = {
        lat: near?.lat ?? BOGOTA.latitude,
        lng: near?.lng ?? BOGOTA.longitude,
        address: formatExactPlateAddress(normalized, cityParam || city || null, null),
      };
      geocodeCache.set(cacheKey, [fallback]);
      return [fallback];
    }

    if (cityParam) {
      const streetQuery = `street=${encodeURIComponent(parsed.main)}&city=${encodeURIComponent(cityParam)}`;
      const streetResults = await nominatimSearch(streetQuery, 6, signal);
      if (signal?.aborted) return [];
      if (streetResults.length > 0) {
        const results = streetResults.map(toResult).slice(0, 4);
        if (parsed) {
          results.forEach((result) => {
            const displayName = result.address || '';
            result.address = formatAddressWithNeighborhood(displayName, normalized);
          });
        }
        geocodeCache.set(cacheKey, results);
        return results;
      }
    }
  }

  geocodeCache.set(cacheKey, []);
  return [];
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
    const displayName = (data.display_name as string) ?? '';
    const city = normalizeCityName(
      a.city ?? a.town ?? a.municipality ?? a.village ?? null,
    );

    if (data.display_name) {
      const parts = displayName.split(',');
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

function buildNearbyTaxis(center: { lat: number; lng: number } | null, count = 5) {
  if (!center) return [];
  const factories = [
    { lat: 0.0032, lng: -0.0041 }, { lat: -0.0038, lng: 0.0045 }, { lat: 0.0054, lng: 0.0032 },
    { lat: -0.0061, lng: -0.0039 }, { lat: 0.0016, lng: 0.0055 }, { lat: -0.0053, lng: 0.0026 },
  ];
  return Array.from({ length: count }, (_, index) => {
    const offset = factories[index % factories.length];
    const jitterLat = offset.lat + ((index % 2 === 0 ? 1 : -1) * (index + 1) * 0.0008);
    const jitterLng = offset.lng + ((index % 3 === 0 ? 1 : -1) * (index + 2) * 0.0006);
    return {
      id: `taxi-${index}`,
      lat: center.lat + jitterLat,
      lng: center.lng + jitterLng,
      angle: (index * 32) % 360,
    };
  });
}

function numberToWords(value: number): string {
  const ones = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
  const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

  if (value < 10) return ones[value];
  if (value < 20) return teens[value - 10];
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const rest = value % 10;
    const head = tens[ten];
    return rest === 0 ? head : `${head} y ${ones[rest]}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    const prefix = hundreds === 1 ? 'cien' : `${ones[hundreds]}cientos`;
    return rest === 0 ? prefix : `${prefix} ${numberToWords(rest)}`;
  }
  return String(value);
}

function toSpeechAddress(address: string): string {
  const raw = (address || 'Ubicación de origen').replace(/\s+/g, ' ').trim();
  if (!raw || raw.toLowerCase() === 'ubicación de origen') return 'ubicación cercana';

  let text = raw
    .replace(/\b(cra|carrea|carrera)\b/gi, 'carrera')
    .replace(/\b(av|avenida)\b/gi, 'avenida')
    .replace(/\b(cll|calle)\b/gi, 'calle')
    .replace(/\b(tv|transversal)\b/gi, 'transversal')
    .replace(/\b(dg|diagonal)\b/gi, 'diagonal')
    .replace(/\s*#\s*/gi, ' número ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/(\d+)([a-zA-Z])(?=\s|$|,)/g, (_, num: string, letter: string) => {
    const parsed = Number(num);
    return `${numberToWords(parsed)} ${letter.toUpperCase()}`;
  });

  text = text.replace(/número\s+(\d+)([a-zA-Z])\s*(\d+)/gi, (_, n1: string, letter: string, n2: string) => {
    const first = numberToWords(Number(n1));
    const second = numberToWords(Number(n2));
    return `número ${first} ${letter.toUpperCase()} ${second}`;
  });

  text = text.replace(/número\s+(\d+)/gi, (_, num: string) => `número ${numberToWords(Number(num))}`);
  text = text.replace(/\b(\d+)\b/g, (_, num: string) => numberToWords(Number(num)));
  text = text.replace(/\s*,\s*/g, ', ');

  return text.replace(/\s+/g, ' ').trim();
}

// ─── Passenger Home ───────────────────────────────────────────────────────
function PassengerHome() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { socket, joinTrip, leaveTrip } = useSocket();
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
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
  const [transferMethod, setTransferMethod] = useState<TransferKey>('nequi');

  const effectivePaymentMethod = paymentMethod === 'transfer' ? transferMethod : paymentMethod;

  // Address search state
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [nearbyTaxis, setNearbyTaxis] = useState<Array<{ id: string; lat: number; lng: number; angle: number }>>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pending, setPending] = useState<Pin | null>(null); // candidate awaiting confirmation
  const searchReqId = useRef(0);
  const searchControllerRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    const focusPoint = pending ?? origin ?? (userLoc ? { lat: userLoc.lat, lng: userLoc.lng, address: 'Mi ubicación' } : null);
    const center = focusPoint ? { lat: focusPoint.lat, lng: focusPoint.lng } : null;
    setNearbyTaxis(buildNearbyTaxis(center, focusPoint ? 5 : 3));
  }, [pending, origin, userLoc, step]);

  // Debounced address search while typing (guarded against stale responses)
  useEffect(() => {
    if (step !== 'selectOrigin' && step !== 'selectDest') return;
    if (pending) return; // a candidate was chosen; don't re-search until the user edits the text
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults([]); setIsSearching(false); return; }

    const reqId = ++searchReqId.current;
    const controller = new AbortController();
    if (searchControllerRef.current) searchControllerRef.current.abort();
    searchControllerRef.current = controller;
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);

    geocodeTimer.current = setTimeout(async () => {
      setIsSearching(true);
      const found = await searchAddress(trimmed, userLoc, userCity, controller.signal);
      if (controller.signal.aborted || reqId !== searchReqId.current) return;
      setResults(found);
      setIsSearching(false);
    }, 100);

    return () => {
      searchReqId.current++;
      if (searchControllerRef.current) searchControllerRef.current.abort();
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

  const startSelectOrigin = () => {
    // Enter origin selection mode and require the user to type the address.
    // Do NOT auto-fill with GPS — the app still uses userLoc / userCity (from initial permissions)
    // to scope searches but the input must be provided by the user.
    selectSessionId.current += 1;
    setQuery('');
    setResults([]);
    setPending(null);
    setStep('selectOrigin');
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

  const skipDestination = () => {
    if (!origin) return;
    // Preserve a valid destination object so the UI can detect that the destination is intentionally omitted
    // and drivers see "Destino sin especificar" instead of a null/invalid destination.
    setDest({
      lat: origin.lat,
      lng: origin.lng,
      address: origin.address?.trim() || 'Ubicación de origen',
    });
    setPending(null);
    setQuery('');
    setResults([]);
    setStep('confirm');
  };

  const requestTaxi = async () => {
    if (!origin) return;
    setStep('searching');

    const tripPayload: Record<string, any> = {
      originLat: origin.lat,
      originLng: origin.lng,
      originAddress: origin.address?.trim() || 'Ubicación de origen',
      vehicleType: 'taxi',
      paymentMethod: effectivePaymentMethod,
    };

    try {
      const normalizedOriginAddress = origin.address?.trim() || 'Ubicación de origen';
      const normalizedDestinationAddress = typeof dest?.address === 'string' ? dest.address.trim() : '';
      const sameAsOrigin = !!dest && Number.isFinite(dest.lat) && Number.isFinite(dest.lng)
        && Number(dest.lat) === Number(origin.lat)
        && Number(dest.lng) === Number(origin.lng);
      const hasDestination = !!dest && Number.isFinite(dest.lat) && Number.isFinite(dest.lng)
        && normalizedDestinationAddress.length > 0
        && !sameAsOrigin;
      const fallbackDestinationAddress = normalizedDestinationAddress || normalizedOriginAddress || 'Ubicación de origen';

      tripPayload.originAddress = normalizedOriginAddress;

      if (hasDestination) {
        tripPayload.destinationLat = Number(dest!.lat);
        tripPayload.destinationLng = Number(dest!.lng);
        tripPayload.destinationAddress = normalizedDestinationAddress;
        tripPayload.estimatedPrice = Number(estimatedPrice) || 0;
        tripPayload.destinationPending = false;
      } else {
        // When the destination is intentionally omitted or equal to the origin,
        // we keep the same origin values in destination to avoid nulls and let the UI show "Destino sin especificar".
        tripPayload.destinationLat = Number(origin.lat);
        tripPayload.destinationLng = Number(origin.lng);
        tripPayload.destinationAddress = fallbackDestinationAddress;
        tripPayload.destinationPending = true;
        tripPayload.estimatedPrice = 0;
      }

      for (const k of Object.keys(tripPayload)) {
        const v = (tripPayload as any)[k];
        if (v === null || v === undefined) {
          delete (tripPayload as any)[k];
          continue;
        }
        if (k.toLowerCase().endsWith('lat') || k.toLowerCase().endsWith('lng') || k.toLowerCase().includes('price') || k === 'estimatedPrice') {
          (tripPayload as any)[k] = Number(v) || 0;
        }
      }

      try {
        console.log('createTrip payload:', JSON.stringify(tripPayload));
      } catch (e) { console.log('createTrip payload (unserializable)', e); }
      console.log('API base URL:', getApiUrl());

      const trip = await createTrip.mutateAsync({ data: tripPayload as any });
      setActiveTripId(trip.id);
      joinTrip(trip.id);
    } catch (err: any) {
      console.error('createTrip error:', err);

      const msg = err?.data?.error ?? err?.message ?? (typeof err === 'string' ? err : null);
      if (msg && typeof msg === 'string' && msg.toLowerCase().includes('network request failed')) {
        try {
          const base = getApiUrl();
          console.log('Retrying createTrip with direct fetch to', `${base}/trips`);
          const token = await AsyncStorage.getItem('auth_token');
          const res = await fetch(`${base}/trips`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '', },
            body: JSON.stringify(tripPayload),
          });
          const text = await res.text();
          console.log('Direct fetch response status:', res.status, 'body:', text);
          if (!res.ok) throw new Error(`Direct fetch failed: ${res.status} ${text}`);
          const json = JSON.parse(text || '{}');
          setActiveTripId(json.id);
          joinTrip(json.id);
          return;
        } catch (e2: any) {
          console.error('Direct fetch createTrip error:', e2);
        }
      }

      setStep('confirm');
      const fallbackMsg = err?.data?.error ?? err?.message ?? (typeof err === 'string' ? err : 'No se pudo solicitar el taxi.');
      Alert.alert('Error', fallbackMsg);
    }
  };

  const cancelSearch = async () => {
    if (activeTripId) {
      try {
        const token = await AsyncStorage.getItem('auth_token');
        const base = getApiUrl();
        await fetch(`${base}/trips/${activeTripId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '', },
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
        {nearbyTaxis.length > 0 && (
          nearbyTaxis.map((taxi) => (
            <Marker key={taxi.id} coordinate={{ latitude: taxi.lat, longitude: taxi.lng }} title="Taxi cercano">
              <View style={{ transform: [{ rotate: `${taxi.angle}deg` }] }}>
                <Text style={{ fontSize: 18 }}>🚕</Text>
              </View>
            </Marker>
          ))
        )}
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

          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <View>
                <Text style={styles.summaryLabel}>Servicio activo</Text>
                <Text style={styles.summaryTitle}>Tu viaje empieza aquí</Text>
              </View>
              <View style={styles.summaryBadge}>
                <Text style={styles.summaryBadgeText}>24/7</Text>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Feather name="clock" size={14} color={colors.light.primary} />
                <Text style={styles.summaryItemText}>Rápido</Text>
              </View>
              <View style={styles.summaryItem}>
                <Feather name="shield" size={14} color={colors.light.primary} />
                <Text style={styles.summaryItemText}>Seguro</Text>
              </View>
              <View style={styles.summaryItem}>
                <Feather name="credit-card" size={14} color={colors.light.primary} />
                <Text style={styles.summaryItemText}>Paga fácil</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={startSelectOrigin} activeOpacity={0.85}>
            <Feather name="navigation" size={18} color={colors.light.primaryForeground} />
            <Text style={styles.primaryBtnText}>Pedir taxi</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom sheet — address search (origin / destination) */}
      {isSelectingMode && (
        <KeyboardAwareScrollViewCompat
          maxExtraScroll={220}
          keyboardVerticalOffset={insets.top + (Platform.OS === 'web' ? 67 : 60)}
          style={styles.sheetKeyboardWrap}
          contentContainerStyle={[{ flexGrow: 1 }]} 
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

          {/* Allow skipping destination when selecting destination */}
          {step === 'selectDest' && (
            <TouchableOpacity
              style={[styles.skipBtn, { marginTop: 8 }]}
              onPress={skipDestination}
              activeOpacity={0.85}
            >
              <Text style={styles.skipBtnText}>Omitir destino (lo diré después)</Text>
            </TouchableOpacity>
          )}
        </View>
        </KeyboardAwareScrollViewCompat>
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
                  onPress={() => {
                    setPaymentMethod(opt.key as PaymentKey);
                    if (opt.key === 'transfer') setTransferMethod('nequi');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={styles.payChipIcon}><PaymentIcon type={opt.key === 'transfer' ? 'transfer' : 'cash'} /></View>
                  <Text style={[styles.payChipText, paymentMethod === opt.key && styles.payChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {paymentMethod === 'transfer' && (
              <View style={[styles.payRow, { marginTop: 8 }]}>
                {TRANSFER_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.payChip, transferMethod === opt.key && styles.payChipActive]}
                    onPress={() => setTransferMethod(opt.key as TransferKey)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.payChipIcon}><PaymentIcon type={opt.key as 'nequi' | 'daviplata' | 'breve'} /></View>
                    <Text style={[styles.payChipText, transferMethod === opt.key && styles.payChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={requestTaxi} disabled={createTrip.isPending} activeOpacity={0.85}>
            {createTrip.isPending
              ? <ActivityIndicator color={colors.light.primaryForeground} />
              : <><Feather name="navigation" size={18} color={colors.light.primaryForeground} /><Text style={styles.primaryBtnText}>Solicitar taxi</Text></>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              // go back to destination selection so user can change destination
              setStep('selectDest');
              setPending(dest);
              setQuery(dest?.address ?? '');
            }}
          >
            <Text style={styles.secondaryBtnText}>Cambiar ruta</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom sheet — confirm (origin set, destination omitted) */}
      {step === 'confirm' && origin && !dest && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }]}>
          <View style={styles.routeSummary}>
            <View style={styles.routeRow}>
              <Feather name="circle" size={10} color={colors.light.primary} />
              <Text style={styles.routeText} numberOfLines={2}>{origin.address}</Text>
            </View>
            <View style={[styles.routeConnector]} />
            <View style={styles.routeRow}>
              <Feather name="map-pin" size={10} color={colors.light.destructive} />
              <Text style={styles.routeText} numberOfLines={1}>Destino por confirmar</Text>
            </View>
          </View>

          {/* No price/distance when destination is missing */}

          {/* Payment method selector (still allow choosing) */}
          <View style={styles.paySection}>
            <Text style={styles.payLabel}>¿Cómo vas a pagar?</Text>
            <View style={styles.payRow}>
              {PAYMENT_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.payChip, paymentMethod === opt.key && styles.payChipActive]}
                  onPress={() => {
                    setPaymentMethod(opt.key as PaymentKey);
                    if (opt.key === 'transfer') setTransferMethod('nequi');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={styles.payChipIcon}><PaymentIcon type={opt.key === 'transfer' ? 'transfer' : 'cash'} /></View>
                  <Text style={[styles.payChipText, paymentMethod === opt.key && styles.payChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {paymentMethod === 'transfer' && (
              <View style={[styles.payRow, { marginTop: 8 }]}>
                {TRANSFER_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.payChip, transferMethod === opt.key && styles.payChipActive]}
                    onPress={() => setTransferMethod(opt.key as TransferKey)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.payChipIcon}><PaymentIcon type={opt.key as 'nequi' | 'daviplata' | 'breve'} /></View>
                    <Text style={[styles.payChipText, transferMethod === opt.key && styles.payChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={requestTaxi} disabled={createTrip.isPending} activeOpacity={0.85}>
            {createTrip.isPending
              ? <ActivityIndicator color={colors.light.primaryForeground} />
              : <><Feather name="navigation" size={18} color={colors.light.primaryForeground} /><Text style={styles.primaryBtnText}>Solicitar taxi</Text></>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              // go back to destination selection when destination was omitted
              setStep('selectDest');
              setPending(null);
              setQuery('');
            }}
          >
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

  useEffect(() => {
    const interval = setInterval(() => {
      setRequests(prev => prev.filter(req => {
        const deadline = Number(req.expiresAt ?? Date.now());
        return deadline > Date.now() + 250;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const panicAnim = useRef(new Animated.Value(1)).current;
  const updateStatus = useUpdateDriverStatus();
  const updateLocation = useUpdateDriverLocation();
  const acceptTrip = useUpdateTripStatus();

  const announceTripRequest = useCallback((trip: any) => {
    try {
      const originAddress = (trip?.originAddress || 'Ubicación de origen')
        .replace(/\s+/g, ' ')
        .replace(/,\s*$/, '')
        .trim();
      const originLabel = toSpeechAddress(originAddress);

      const paymentMethodLabel = (() => {
        const method = (trip?.paymentMethod || 'cash').toString().toLowerCase();
        if (method === 'cash') return 'Efectivo';
        if (method === 'nequi') return 'Nequi';
        if (method === 'daviplata') return 'Daviplata';
        if (method === 'breve') return 'Breve';
        return method || 'Efectivo';
      })();

      const message = `Solicitan taxi desde la dirección ${originLabel}. Pago: ${paymentMethodLabel}`;
      Speech.stop();
      Speech.speak(message, {
        language: 'es-ES',
        rate: 1.15,
        pitch: 1.0,
      });
    } catch {
      // Ignore TTS failures in unsupported environments.
    }
  }, []);

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
      setRequests(prev => {
        const next = [...prev];
        const index = next.findIndex(r => r.id === trip.id);
        const enriched = { ...trip, expiresAt: Date.now() + 10_000 };
        if (index >= 0) {
          next[index] = enriched;
        } else {
          next.unshift(enriched);
        }
        return next.slice(0, 4);
      });
      announceTripRequest(trip);
    };
    const onStatusUpdated = (trip: any) => {
      if (!trip || trip.status === 'pending') return;
      setRequests(prev => prev.filter(r => r.id !== trip.id));
    };
    socket.on('trip:new_request', handler);
    socket.on('trip_status_updated', onStatusUpdated);
    return () => {
      socket.off('trip:new_request', handler);
      socket.off('trip_status_updated', onStatusUpdated);
    };
  }, [socket, isOnline, announceTripRequest]);

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
              const base = getApiUrl();
              const res = await fetch(`${base}/drivers/panic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '', },
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
          <View style={{ flex: 1 }}>
            {isOnline ? (
              <>
                <Text style={styles.topLabelText}>🟢 En línea</Text>
                <Text style={styles.topLabelSubText}>Recibiendo solicitudes</Text>
              </>
            ) : (
              <Text style={styles.topLabelText}>⚫ Fuera de línea</Text>
            )}
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
                <View style={styles.countdownPill}>
                  <Feather name="clock" size={12} color={colors.light.accent} />
                  <Text style={styles.countdownText}>{Math.max(0, Math.ceil((Number(req.expiresAt ?? Date.now()) - Date.now()) / 1000))}s</Text>
                </View>
                <TouchableOpacity onPress={() => setRequests(p => p.filter(r => r.id !== req.id))}>
                  <Feather name="x" size={14} color={colors.light.mutedForeground} />
                </TouchableOpacity>
              </View>
              <View style={{ gap: 4 }}>
                <View style={styles.reqRow}><Feather name="circle" size={9} color={colors.light.primary} /><Text style={styles.reqText} numberOfLines={1}>{req.originAddress}</Text></View>
                {req.destinationAddress && req.destinationAddress !== req.originAddress && (
                  <View style={styles.reqRow}><Feather name="map-pin" size={9} color={colors.light.destructive} /><Text style={styles.reqText} numberOfLines={1}>{req.destinationAddress}</Text></View>
                )}
              </View>
              <View style={styles.requestMeta}>
                <Text style={styles.reqPrice}>${Number(req.estimatedPrice).toLocaleString('es-CO')}</Text>
                <Text style={styles.reqDist}>{Number(req.distanceKm).toFixed(1)} km</Text>
                <View style={styles.reqPayBadge}>
                  <View style={styles.reqPayIcon}><PaymentIcon type={getPaymentInfo(req.paymentMethod).kind} /></View>
                  <Text style={styles.reqPayText}>
                    {getPaymentInfo(req.paymentMethod).label}
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
  driverTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  toggleBtnOn: { backgroundColor: colors.light.destructive + 'CC' },
  toggleBtnOff: { backgroundColor: colors.light.primary },
  toggleBtnText: { fontSize: 12, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' },
  topLabelSubText: { fontSize: 12, color: colors.light.mutedForeground, marginTop: 2, fontFamily: 'Inter_600SemiBold' },
  topLabelText: { fontSize: 13, fontWeight: '600', color: colors.light.foreground, fontFamily: 'Inter_600SemiBold' },
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
  summaryCard: {
    backgroundColor: colors.light.secondary, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.light.border,
    padding: 14, gap: 12,
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 11, color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold', marginTop: 2 },
  summaryBadge: {
    backgroundColor: colors.light.primary + '20', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.light.primary + '40',
  },
  summaryBadgeText: { fontSize: 11, color: colors.light.primary, fontFamily: 'Inter_700Bold' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  summaryItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.light.card, borderRadius: 10, paddingVertical: 9, borderWidth: 1, borderColor: colors.light.border,
  },
  summaryItemText: { fontSize: 12, color: colors.light.foreground, fontFamily: 'Inter_600SemiBold' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  skipBtn: {
    backgroundColor: colors.light.primary, borderRadius: colors.radius, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.light.primary + '60',
  },
  skipBtnText: { color: colors.light.primaryForeground, fontWeight: '700', fontSize: 14 },
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
  countdownPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.light.secondary, borderRadius: 999,
    borderWidth: 1, borderColor: colors.light.border,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  countdownText: { fontSize: 11, fontWeight: '700', color: colors.light.accent, fontFamily: 'Inter_700Bold' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqText: { flex: 1, fontSize: 13, color: colors.light.foreground, fontFamily: 'Inter_400Regular' },
  requestMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reqPrice: { fontSize: 20, fontWeight: '700', color: colors.light.primary, fontFamily: 'Inter_700Bold' },
  reqDist: { fontSize: 13, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  reqPayBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.light.secondary, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.light.border,
  },
  reqPayIcon: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
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
  payChipIcon: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
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
