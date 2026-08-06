import React from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListTrips } from '@workspace/api-client-react';
import colors from '@/constants/colors';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  driver_arriving: 'Conductor llegando',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFB800',
  accepted: '#3B82F6',
  driver_arriving: '#6366F1',
  in_progress: '#10B981',
  completed: '#00D48B',
  cancelled: '#FF4757',
};

function TripCard({ item }: { item: any }) {
  const isActive = ['pending', 'accepted', 'driver_arriving', 'in_progress'].includes(item.status);
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => isActive && router.push(`/trip/${item.id}`)}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] ?? colors.light.mutedForeground }]} />
        <Text style={styles.statusText}>{STATUS_LABELS[item.status] ?? item.status}</Text>
        <Text style={styles.priceText}>
          ${((item.finalPrice ?? item.estimatedPrice) as number).toLocaleString('es-CO')}
        </Text>
      </View>
      <View style={styles.routeRow}>
        <Feather name="circle" size={12} color={colors.light.primary} />
        <Text style={styles.addressText} numberOfLines={1}>{item.originAddress}</Text>
      </View>
      <View style={styles.routeLine} />
      <View style={styles.routeRow}>
        <Feather name="map-pin" size={12} color={colors.light.destructive} />
        <Text style={styles.addressText} numberOfLines={1}>{item.destinationAddress}</Text>
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.metaText}>
          {item.distanceKm ? `${Number(item.distanceKm).toFixed(1)} km • ` : ''}
          {item.vehicleType} • {item.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}
        </Text>
        {isActive && (
          <View style={styles.activeChip}>
            <Text style={styles.activeChipText}>Ver viaje</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { data: trips, isLoading, refetch, isRefetching } = useListTrips();

  return (
    <View style={[styles.root, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis Viajes</Text>
      </View>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.light.primary} />
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => <TripCard item={item} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 100) }
          ]}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={48} color={colors.light.mutedForeground} />
              <Text style={styles.emptyText}>No tienes viajes aún</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.background },
  header: { paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  card: {
    backgroundColor: colors.light.card, borderRadius: colors.radius,
    padding: 16, borderWidth: 1, borderColor: colors.light.border, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.light.mutedForeground, fontFamily: 'Inter_600SemiBold' },
  priceText: { fontSize: 15, fontWeight: '700', color: colors.light.foreground, fontFamily: 'Inter_700Bold' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeLine: { width: 1, height: 12, backgroundColor: colors.light.border, marginLeft: 5 },
  addressText: { flex: 1, fontSize: 14, color: colors.light.foreground, fontFamily: 'Inter_400Regular' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaText: { fontSize: 12, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
  activeChip: {
    backgroundColor: colors.light.primary + '20', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  activeChipText: { fontSize: 12, fontWeight: '600', color: colors.light.primary, fontFamily: 'Inter_600SemiBold' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80, gap: 16 },
  emptyText: { fontSize: 16, color: colors.light.mutedForeground, fontFamily: 'Inter_400Regular' },
});
