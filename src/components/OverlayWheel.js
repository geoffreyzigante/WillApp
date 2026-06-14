// iOS-style picker INFINI vertical (refonte 2026-06-02).
//
// items dupliques REPEAT (20) fois, snap-back silencieux au middle block
// des qu'on s'approche des bords (boucle infinie en pratique).
// PAD_V_TOP reduit a ITEM_H/2 pour rapprocher le titre de la selection.
//
// Visual feedback INSTANTANE : visualIndex track la position courante
// pendant le scroll (onScroll), pas seulement au stop. Le coloring rose
// et l'opacite suivent en temps reel ; onChange n'est appele qu'au
// momentum end pour eviter le spam de setState externes.
//
// Haptics UISelectionFeedbackGenerator a chaque cran traverse (meme
// pattern que les picker iOS natifs).

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../constants/colors';
import { Haptics } from '../services/haptics';

export function OverlayWheel({ items, selectedIndex, onChange }) {
  const ITEM_H = 24;
  const HEIGHT = 4 * ITEM_H;
  const PAD_V_TOP = Math.round(ITEM_H / 2);    // 12 : titre proche du slot select
  const PAD_V_BOTTOM = 2 * ITEM_H;             // 48 : 2 items visibles en-dessous
  const PINK = C.pinkPill;
  const HAIRLINE = StyleSheet.hairlineWidth;
  const REPEAT = 20;
  const N = items.length;
  const middleStart = Math.floor(REPEAT / 2) * N;
  const initialGi = middleStart + selectedIndex;
  const totalCount = REPEAT * N;
  const SAFE = 3;
  const scrollRef = useRef(null);
  const lastGiRef = useRef(initialGi);
  // visualIndex = item actuellement DANS le slot selectionne (suivi du scroll).
  // Sert au coloring rose. Synchronise sur selectedIndex en cas de change ext.
  const [visualIndex, setVisualIndex] = useState(selectedIndex);
  useEffect(() => { setVisualIndex(selectedIndex); }, [selectedIndex]);

  useEffect(() => {
    const cur = lastGiRef.current;
    const curBlock = Math.floor(cur / N);
    const candidates = [
      curBlock * N + selectedIndex,
      (curBlock - 1) * N + selectedIndex,
      (curBlock + 1) * N + selectedIndex,
    ].filter(gi => gi >= 0 && gi < totalCount);
    if (candidates.length === 0) return;
    const target = candidates.reduce((best, gi) =>
      Math.abs(gi - cur) < Math.abs(best - cur) ? gi : best, candidates[0]);
    if (target !== cur) {
      lastGiRef.current = target;
      scrollRef.current?.scrollTo({ y: target * ITEM_H, animated: true });
    }
  }, [selectedIndex, N, totalCount]);

  return (
    <View style={{ height: HEIGHT, alignSelf: 'stretch', position: 'relative' }}>
      <ScrollView
        ref={scrollRef}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: initialGi * ITEM_H }}
        contentContainerStyle={{ paddingTop: PAD_V_TOP, paddingBottom: PAD_V_BOTTOM }}
        onMomentumScrollEnd={e => {
          let gi = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          const block = Math.floor(gi / N);
          if (block < SAFE || block >= REPEAT - SAFE) {
            const offsetWithinBlock = gi - block * N;
            gi = middleStart + offsetWithinBlock;
            scrollRef.current?.scrollTo({ y: gi * ITEM_H, animated: false });
          }
          lastGiRef.current = gi;
          const idx = ((gi % N) + N) % N;
          if (idx !== selectedIndex) onChange(idx);
        }}
        onScroll={e => {
          const gi = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          lastGiRef.current = gi;
          const idx = ((gi % N) + N) % N;
          if (idx !== visualIndex) {
            try { Haptics?.selectionAsync?.(); } catch {}
            setVisualIndex(idx);
          }
        }}
        scrollEventThrottle={16}
      >
        {Array.from({ length: totalCount }, (_, gi) => {
          const i = gi % N;
          const it = items[i];
          const isSel = i === visualIndex;
          const delta = i - visualIndex;
          // Non-selected items en gris fonce + Montserrat 300 (light) pour
          // typo plus fine. Selected en rose brand, Montserrat 400.
          let opacity = 0.18;
          if (isSel) opacity = 1;
          else if (delta === -1) opacity = 0.3;
          else if (delta === 1) opacity = 0.45;
          return (
            <View key={gi} style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, overflow: 'hidden' }}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  color: isSel ? PINK : 'rgba(255,255,255,0.7)',
                  opacity,
                  fontSize: isSel ? 17 : 15,
                  fontWeight: isSel ? '400' : '300',
                  fontFamily: 'Montserrat',
                  maxWidth: '100%',
                }}>{it.label}</Text>
            </View>
          );
        })}
      </ScrollView>
      {/* Fade vers le noir, en haut */}
      <LinearGradient
        pointerEvents="none"
        colors={['#000', 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: PAD_V_TOP }}
      />
      {/* Fade vers le noir, en bas */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', '#000']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: PAD_V_BOTTOM }}
      />
      {/* Lignes roses hairline au-dessus et au-dessous du slot selectionne */}
      <View pointerEvents="none" style={{
        position: 'absolute',
        top: PAD_V_TOP, left: 24, right: 24,
        height: HAIRLINE,
        backgroundColor: PINK,
      }} />
      <View pointerEvents="none" style={{
        position: 'absolute',
        top: PAD_V_TOP + ITEM_H - HAIRLINE, left: 24, right: 24,
        height: HAIRLINE,
        backgroundColor: PINK,
      }} />
    </View>
  );
}
