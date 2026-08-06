// Web stub — react-native-maps is not available on web.
// Renders a dark placeholder so the app doesn't crash.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const PROVIDER_DEFAULT = null;

type MapViewProps = {
  style?: any;
  region?: Region;
  initialRegion?: Region;
  onRegionChangeComplete?: (r: Region) => void;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  pitchEnabled?: boolean;
  rotateEnabled?: boolean;
  provider?: any;
  children?: React.ReactNode;
  [key: string]: any;
};

export const MapView = React.forwardRef<any, MapViewProps>(
  ({ style, children }, _ref) => (
    <View style={[styles.map, style]}>
      <Text style={styles.label}>🗺️ Mapa disponible en la app móvil</Text>
      {children}
    </View>
  ),
);
MapView.displayName = 'MapView';

export function Marker(_props: {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  children?: React.ReactNode;
  [key: string]: any;
}) {
  return null;
}

export function Polyline(_props: {
  coordinates: { latitude: number; longitude: number }[];
  strokeColor?: string;
  strokeWidth?: number;
  [key: string]: any;
}) {
  return null;
}

const styles = StyleSheet.create({
  map: {
    backgroundColor: '#0f1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#555',
    fontSize: 14,
  },
});
