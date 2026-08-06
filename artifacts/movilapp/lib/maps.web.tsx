/**
 * Web stub for react-native-maps.
 * react-native-maps is native-only; on web we show a styled placeholder.
 */
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const PROVIDER_DEFAULT = null;

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/** Web MapView stub — shows a map placeholder */
export const MapView = forwardRef<any, any>(function MapView({ style, children }, ref) {
  useImperativeHandle(ref, () => ({
    animateToRegion: () => {},
    animateCamera: () => {},
    animateToCoordinate: () => {},
  }));
  return (
    <View style={[styles.mapStub, style]}>
      <Text style={styles.icon}>🗺️</Text>
      <Text style={styles.label}>Mapa disponible en la app móvil</Text>
      {/* Render children so markers appear as overlay elements */}
      {children}
    </View>
  );
});

/** Web Marker stub — invisible on web */
export const Marker: React.FC<any> = () => null;

/** Web Polyline stub — invisible on web */
export const Polyline: React.FC<any> = () => null;

const styles = StyleSheet.create({
  mapStub: {
    backgroundColor: '#0f1118',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  icon: { fontSize: 48 },
  label: { fontSize: 14, color: '#555', fontFamily: 'Inter_400Regular' },
});
