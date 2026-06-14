// Placeholder anime (opacity loop 0.5 <-> 1, 750ms) pour les cellules
// de grille en cours de chargement. Violet leger brand (C.primaryLight)
// au lieu du gris #E5E7EB -> coherent avec l identite, page jamais blanche.

import React, { useRef, useEffect } from 'react';
import { Animated } from 'react-native';
import { C } from '../constants/colors';

export function SkeletonCell({ size }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.5, duration: 750, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return (
    <Animated.View style={{
      width: size, height: size,
      borderRadius: 12,
      backgroundColor: C.primaryLight,
      opacity: op,
    }} />
  );
}
