import React, { forwardRef, useImperativeHandle, useMemo } from 'react';
import { Image, View, type LayoutChangeEvent, StyleSheet } from 'react-native';
import { getMapTileUrl } from './api-config';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const PROVIDER_DEFAULT = null;
export const UrlTile: React.FC = () => null;

type MapViewProps = {
  style?: object;
  region?: Region;
  initialRegion?: Region;
  children?: React.ReactNode;
  onRegionChangeComplete?: (region: Region) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function tileGrid(region: Region) {
  const zoom = clamp(Math.round(Math.log2(360 / Math.max(region.longitudeDelta, 0.01))), 3, 19);
  const scale = 2 ** zoom;
  const centerX = ((region.longitude + 180) / 360) * scale;
  const latitudeRad = (region.latitude * Math.PI) / 180;
  const centerY = ((1 - Math.asinh(Math.tan(latitudeRad)) / Math.PI) / 2) * scale;
  const tileTemplate = getMapTileUrl();
  const tiles = [];

  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const x = Math.floor(centerX + offsetX);
      const y = Math.floor(centerY + offsetY);
      const wrappedX = ((x % scale) + scale) % scale;
      if (y < 0 || y >= scale) continue;
      tiles.push({
        key: `${zoom}-${wrappedX}-${y}`,
        uri: tileTemplate
          .replace('{z}', String(zoom))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(y)),
        left: (x - centerX) * 256 - 128,
        top: (y - centerY) * 256 - 128,
      });
    }
  }

  return tiles;
}

export const MapView = forwardRef<any, MapViewProps>(function MapView(
  { style, region, initialRegion, children, onRegionChangeComplete },
  ref,
) {
  const mapRegion = region ?? initialRegion ?? {
    latitude: 4.711,
    longitude: -74.0721,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
  };
  const tiles = useMemo(() => tileGrid(mapRegion), [mapRegion]);
  const markerElements = React.Children.toArray(children).filter((child) => {
    if (!React.isValidElement(child)) return false;
    return Boolean((child.props as { coordinate?: unknown }).coordinate);
  });

  useImperativeHandle(ref, () => ({
    animateToRegion: () => undefined,
    animateCamera: () => undefined,
    animateToCoordinate: () => undefined,
  }));

  const handleLayout = (_event: LayoutChangeEvent) => {
    onRegionChangeComplete?.(mapRegion);
  };

  return React.createElement(
    View,
    { style: [style, styles.container], onLayout: handleLayout },
    tiles.map((tile) =>
      React.createElement(Image, {
        key: tile.key,
        source: { uri: tile.uri },
        style: {
          position: 'absolute',
          width: 256,
          height: 256,
          left: '50%',
          top: '50%',
          transform: [{ translateX: tile.left }, { translateY: tile.top }],
        },
      }),
    ),
    markerElements.map((child, index) => {
      const props = (child as React.ReactElement<{ coordinate: { latitude: number; longitude: number }; title?: string }>).props;
      const left = 50 + ((props.coordinate.longitude - mapRegion.longitude) / mapRegion.longitudeDelta) * 100;
      const top = 50 - ((props.coordinate.latitude - mapRegion.latitude) / mapRegion.latitudeDelta) * 100;
      return React.createElement(
        View,
        {
          key: `marker-${index}`,
          accessible: true,
          accessibilityLabel: props.title,
          style: [styles.marker, { left: `${left}%`, top: `${top}%` }],
        },
        child,
      );
    }),
  );
});

MapView.displayName = 'MapView';

export const Marker: React.FC<any> = ({ children }) => children ?? null;
export const Polyline: React.FC<any> = () => null;

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  marker: { position: 'absolute', transform: [{ translateX: -10 }, { translateY: -10 }] },
});
