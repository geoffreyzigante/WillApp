// Ligne d'instruction "Step N : faire X" avec pastille check verte si done.
// Utilisee dans PhotosEmptyState pour expliquer le flux selfie -> follow event
// -> photos auto.

import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from '../constants/colors';

export function PhotosStepRow({ num, text, done = false }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 8,
    }}>
      <View style={{
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: done ? C.success : '#EDE4FF',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {done ? (
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20 6L9 17l-5-5" />
          </Svg>
        ) : (
          <Text style={{ color: '#7B2FFF', fontSize: 13, fontWeight: '700' }}>{num}</Text>
        )}
      </View>
      <Text style={{ flex: 1, color: '#1A1426', fontSize: 14 }}>{text}</Text>
    </View>
  );
}
