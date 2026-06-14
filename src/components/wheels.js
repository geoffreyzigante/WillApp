// Wheel pickers : composants de selection horizontale style "iOS picker"
// utilises pour les filtres course/distance dans EventDetailScreen et
// PhotographerScreen.
//
// WheelItem : item interpole entre accent et blanc selon scrollX (anime
//   via reanimated, interpolateColor sur 3 stops [-0.5, 0, +0.5] * ITEM_W).
//
// FilterWheel : FlatList horizontale loopee (WHEEL_LOOPS x items) avec
//   snap au centre, scrollX synchronise pour l'interpolateColor des items.
//
// RaceDropdown : alternative dropdown classique (Modal centre fade) au
//   FilterWheel pour les listes longues (course/km galerie publique).
//   Mirror website .race-dropdown / .km-dropdown.

import React, { useState, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, Modal, ScrollView } from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolateColor,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { C } from '../constants/colors';

// 140 (vs 100 avant) pour accommoder les labels type complets
// ("Triathlon 12 km", "Course sur route 42 km" ...). Labels plus longs sont
// tronques en ellipsis (numberOfLines=1 sur le Text de l item).
export const WHEEL_ITEM_W = 140;
export const WHEEL_H = 30;
export const WHEEL_LOOPS = 30;

const ReAnimatedFlatList = ReAnimated.createAnimatedComponent(FlatList);

export function WheelItem({ index, label, accent, scrollX, onPress }) {
  const animStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      scrollX.value,
      [
        (index - 0.5) * WHEEL_ITEM_W,
        index * WHEEL_ITEM_W,
        (index + 0.5) * WHEEL_ITEM_W,
      ],
      [accent, '#ffffff', accent],
    );
    return { color };
  });
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        width: WHEEL_ITEM_W, height: WHEEL_H,
        alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 8,
      }}
    >
      <ReAnimated.Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[{
          fontWeight: '600',
          fontSize: 13.5,
          fontFamily: 'Montserrat',
          maxWidth: '100%',
        }, animStyle]}>{label}</ReAnimated.Text>
    </TouchableOpacity>
  );
}

export function FilterWheel({ items, activeKey, onChange, accent, bg, marginRight = 10 }) {
  const listRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const n = items.length;
  const activeIdx = Math.max(0, items.findIndex(it => it.key === activeKey));
  const middleStart = Math.floor(WHEEL_LOOPS / 2) * n;
  const initialIdx = middleStart + activeIdx;
  // scrollX initialise pile sur l item actif : au mount, interpolateColor
  // place le blanc sur le bon item des le 1er paint, pas l item 0.
  const scrollX = useSharedValue(initialIdx * WHEEL_ITEM_W);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollX.value = e.contentOffset.x; },
  });
  const looped = useMemo(() => {
    const arr = [];
    for (let i = 0; i < WHEEL_LOOPS; i++) {
      for (let j = 0; j < n; j++) {
        arr.push({ ...items[j], _li: i * n + j });
      }
    }
    return arr;
  }, [items, n]);
  const padH = containerW > 0 ? (containerW - WHEEL_ITEM_W) / 2 : 0;
  return (
    <View
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      style={{
        flex: 1, marginRight, height: WHEEL_H,
        backgroundColor: bg, borderRadius: 14,
        overflow: 'hidden', position: 'relative',
      }}
    >
      {containerW > 0 && (
        <>
          {/* Cadre central fixe (accent). Rendu AVANT la FlatList pour
              que les items texte passent par-dessus dans l ordre naturel. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 3, bottom: 3,
              left: padH, width: WHEEL_ITEM_W,
              backgroundColor: accent, borderRadius: 10,
            }}
          />
          <ReAnimatedFlatList
            ref={listRef}
            data={looped}
            horizontal
            keyExtractor={(it) => `wheel-${it._li}`}
            showsHorizontalScrollIndicator={false}
            snapToInterval={WHEEL_ITEM_W}
            decelerationRate="fast"
            initialScrollIndex={initialIdx}
            getItemLayout={(_, index) => ({ length: WHEEL_ITEM_W, offset: WHEEL_ITEM_W * index, index })}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => listRef.current?.scrollToOffset({
                offset: (info.averageItemLength || WHEEL_ITEM_W) * info.index, animated: false,
              }), 50);
            }}
            contentContainerStyle={{ paddingHorizontal: padH }}
            scrollEventThrottle={16}
            onScroll={scrollHandler}
            onMomentumScrollEnd={(e) => {
              const offset = e.nativeEvent.contentOffset.x;
              const idx = Math.round(offset / WHEEL_ITEM_W);
              // Cole scrollX exactement sur l item snap pour ne pas rester
              // a +/-1px (texte interpole = pas tout-a-fait blanc).
              scrollX.value = idx * WHEEL_ITEM_W;
              const realIdx = ((idx % n) + n) % n;
              const newKey = items[realIdx].key;
              if (newKey !== activeKey) onChange(newKey);
            }}
            renderItem={({ item, index }) => {
              const realIdx = ((index % n) + n) % n;
              return (
                <WheelItem
                  index={index}
                  label={item.label}
                  accent={accent}
                  scrollX={scrollX}
                  onPress={() => {
                    listRef.current?.scrollToIndex({ index, animated: true });
                    const newKey = items[realIdx].key;
                    if (newKey !== activeKey) onChange(newKey);
                  }}
                />
              );
            }}
          />
        </>
      )}
    </View>
  );
}

// Dropdown course / km (niveau 1 et 2 du filtre galerie publique). Bouton
// compact affichant le titre actif, tap ouvre un Modal avec la liste
// (Toutes + items). Mirror website .race-dropdown / .km-dropdown.
// compact=true => flex 0 + min-width 110 (niveau 2 km, a droite).
export function RaceDropdown({ items, activeKey, onChange, accent, bg, compact = false }) {
  const [open, setOpen] = useState(false);
  const active = items.find(it => String(it.key) === String(activeKey)) || items[0];
  const wrapStyle = compact
    ? { flex: 0, minWidth: 110, marginRight: 10 }
    : { flex: 1, marginRight: 10 };
  return (
    <View style={wrapStyle}>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        style={{
          backgroundColor: bg,
          borderRadius: 16,
          paddingHorizontal: 14, paddingVertical: 8,
          minHeight: 32,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Text numberOfLines={1} ellipsizeMode="tail" style={{
          flex: 1,
          color: accent,
          fontFamily: 'Montserrat',
          fontSize: 13,
          fontWeight: '500',
        }}>{active?.label || 'Toutes les photos'}</Text>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ marginLeft: 8, transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Path d="M6 9l6 6 6-6" stroke={accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 24 }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{
            backgroundColor: '#fff',
            borderRadius: 16,
            paddingVertical: 6,
            maxHeight: 360,
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {items.map((it, i) => {
                const isActive = String(it.key) === String(activeKey);
                return (
                  <TouchableOpacity
                    key={String(it.key) + ':' + i}
                    onPress={() => { onChange(it.key); setOpen(false); }}
                    activeOpacity={0.6}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 12,
                      backgroundColor: isActive ? accent : 'transparent',
                      marginHorizontal: 4, marginVertical: 1,
                      borderRadius: 10,
                    }}
                  >
                    <Text numberOfLines={1} ellipsizeMode="tail" style={{
                      color: isActive ? '#fff' : C.text,
                      fontFamily: 'Montserrat',
                      fontSize: 14,
                      fontWeight: '500',
                    }}>{it.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
