// Loaders + pull-to-refresh custom.
//
// LoadingIcon : SVG pur, le 9-pointed star Will (rendu par toutes les surfaces).
// SpinningLoader : rotation 360 boucle 900ms, native driver.
// RefreshableScrollView : custom replace de RefreshControl iOS pour utiliser
//   le LoadingIcon a la place du spinner blanc systeme. Pull threshold 70px,
//   gesture handler en mode runOnJS pour eviter le worklet sur le state JS.

import React, { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Animated, Easing } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

export const LoadingIcon = ({ size = 26, color = '#c9beed' }) => (
  <Svg width={size} height={size} viewBox="0 0 57.49 57.49">
    <Path
      fill={color}
      d="M51.14,31.27c.13-.05.26-.1.39-.16,4.9-2.25,7.25-7.59,5.25-11.93-1.72-3.74-6.1-5.5-10.41-4.49.05-.13.11-.25.16-.39,1.87-5.05-.25-10.49-4.73-12.15-3.86-1.43-8.21.42-10.53,4.19-.05-.13-.1-.26-.16-.39C28.86,1.07,23.52-1.28,19.18.71c-3.74,1.72-5.5,6.1-4.49,10.41-.13-.05-.25-.11-.39-.16-5.05-1.87-10.49.25-12.15,4.73-1.43,3.86.42,8.21,4.19,10.53-.13.05-.26.1-.39.16-4.9,2.25-7.25,7.59-5.25,11.93,1.72,3.74,6.1,5.5,10.41,4.49-.05.13-.11.25-.16.39-1.87,5.05.25,10.49,4.73,12.15,3.86,1.43,8.21-.42,10.53-4.19.05.13.1.26.16.39,2.25,4.9,7.59,7.25,11.93,5.25,3.74-1.72,5.5-6.1,4.49-10.41.13.05.25.11.39.16,5.05,1.87,10.49-.25,12.15-4.73,1.43-3.86-.42-8.21-4.19-10.53ZM36.36,39.02c-5.03,3.73-12.52,2.15-16.72-3.53-4.2-5.68-3.53-13.3,1.5-17.02s12.52-2.15,16.72,3.53c4.2,5.68,3.53,13.3-1.5,17.02Z"
    />
  </Svg>
);

export const SpinningLoader = ({ size = 24, color = '#c9beed' }) => {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [rotation]);
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <LoadingIcon size={size} color={color} />
    </Animated.View>
  );
};

export const PULL_THRESHOLD = 45;

export const RefreshableScrollView = React.forwardRef(({ onRefresh, hideTopRefresh, children, ...props }, ref) => {
  const [refreshing, setRefreshing] = useState(false);
  const scrollPosRef = useRef(0);
  const refreshingRef = useRef(false);
  const rotation = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);

  useEffect(() => {
    if (refreshing) {
      Animated.spring(translateYAnim, {
        toValue: 40, useNativeDriver: true, tension: 90, friction: 12,
      }).start();
      Animated.timing(opacityAnim, {
        toValue: 1, duration: 120, useNativeDriver: true,
      }).start();
      rotation.setValue(0);
      const anim = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear,
        })
      );
      anim.start();
      return () => anim.stop();
    }
    Animated.timing(opacityAnim, {
      toValue: 0, duration: 320, useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) translateYAnim.setValue(15);
    });
  }, [refreshing, rotation, opacityAnim, translateYAnim]);

  const onScroll = (e) => {
    scrollPosRef.current = e.nativeEvent.contentOffset.y;
  };

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.resolve(onRefresh?.());
    } finally {
      setRefreshing(false);
    }
  };

  const panGesture = Gesture.Pan()
    .activeOffsetY(8)
    .runOnJS(true)
    .onUpdate((e) => {
      if (scrollPosRef.current <= 0 && !refreshingRef.current && e.translationY > 0) {
        const dist = Math.min(e.translationY * 0.55, 140);
        const progress = Math.min(1, dist / PULL_THRESHOLD);
        translateYAnim.setValue(Math.max(15, dist * 0.5));
        rotation.setValue(progress);
        opacityAnim.setValue(progress);
      }
    })
    .onEnd((e) => {
      if (refreshingRef.current) return;
      if (e.translationY * 0.55 >= PULL_THRESHOLD && scrollPosRef.current <= 0) {
        triggerRefresh();
      } else {
        Animated.parallel([
          Animated.timing(translateYAnim, { toValue: 15, duration: 220, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(rotation, { toValue: 0, duration: 220, useNativeDriver: true }),
        ]).start();
      }
    });

  const composed = Gesture.Simultaneous(panGesture, Gesture.Native());

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ flex: 1 }}>
      {!hideTopRefresh && (
        <Animated.View pointerEvents="none" style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          alignItems: 'center', zIndex: 1000,
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        }}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <LoadingIcon size={26} color="#c9beed" />
          </Animated.View>
        </Animated.View>
      )}
      <GestureDetector gesture={composed}>
        <ScrollView
          ref={ref}
          {...props}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {children}
        </ScrollView>
      </GestureDetector>
    </View>
  );
});
