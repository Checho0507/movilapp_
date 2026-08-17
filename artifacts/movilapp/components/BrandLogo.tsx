import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import colors from '@/constants/colors';

export function BrandLogo({
  size = 90,
  style,
  label = 'M',
}: {
  size?: number;
  style?: any;
  label?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <LinearGradient
        colors={[colors.light.primary, '#F59E0B']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.fallback,
          {
            width: size,
            height: size,
            borderRadius: size * 0.28,
          },
          style,
        ]}
      >
        <Text style={[styles.fallbackText, { fontSize: Math.max(24, size * 0.42) }]}>{label}</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={['rgba(255,184,0,0.18)', 'rgba(245,158,11,0.12)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.logoShell,
        {
          width: size + 16,
          height: size + 16,
          borderRadius: (size + 16) * 0.3,
        },
        style,
      ]}
    >
      <Image
        source={require('@/assets/images/logo.png')}
        style={[{ width: size, height: size }, styles.logoImage]}
        resizeMode="contain"
        onError={() => setHasError(true)}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  logoShell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: colors.light.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
    backgroundColor: 'rgba(12, 16, 26, 0.96)',
  },
  logoImage: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: colors.light.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  fallbackText: {
    color: colors.light.primaryForeground,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
