// Hook commun pour les bottom sheets auth : slide-in spring au visible
// + drag-to-dismiss avec PanResponder sur la handle.
//
// Comportement :
//   - tap (deplacement < 5px) = close immediat
//   - drag > 120px OU velocity > 0.5 = close en anim
//   - sinon snap back en spring au repos
//
// Retourne { sheetTranslate, handlePanHandlers } a binder sur la Animated.View
// du sheet : style transform translateY = sheetTranslate, et
// handlePanHandlers spread sur la handle.

import { useRef, useEffect } from 'react';
import { Animated, PanResponder } from 'react-native';

export function useDismissibleSheet(visible, onClose) {
  const sheetTranslate = useRef(new Animated.Value(1000)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      sheetTranslate.setValue(1000);
      Animated.spring(sheetTranslate, {
        toValue: 0, useNativeDriver: true,
        friction: 11, tension: 80,
      }).start();
    }
  }, [visible]);

  const handlePanHandlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) sheetTranslate.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const tap = Math.abs(g.dy) < 5 && Math.abs(g.dx) < 5;
        if (tap) {
          onCloseRef.current?.();
          return;
        }
        const shouldClose = g.dy > 120 || g.vy > 0.5;
        if (shouldClose) {
          Animated.timing(sheetTranslate, {
            toValue: 1000, duration: 220, useNativeDriver: true,
          }).start(() => onCloseRef.current?.());
        } else {
          Animated.spring(sheetTranslate, {
            toValue: 0, useNativeDriver: true, friction: 11, tension: 80,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetTranslate, {
          toValue: 0, useNativeDriver: true, friction: 11, tension: 80,
        }).start();
      },
    })
  ).current.panHandlers;

  return { sheetTranslate, handlePanHandlers };
}
