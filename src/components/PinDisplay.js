// Affichage PIN en lecture seule (detail event organizer, masque/reveal).
// 4 chiffres gros, espaces 10px, monospace violet.

import React from 'react';
import { View, Text, Platform } from 'react-native';
import { C } from '../constants/colors';
import { isValidPin } from '../utils/pin';

export function PinDisplay({ pin, masked = true }) {
  const valid = isValidPin(pin);
  const chars = valid ? String(pin).split('') : ['', '', '', ''];
  const display = masked ? ['•', '•', '•', '•'] : chars;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {display.map((c, i) => (
        <Text
          key={i}
          style={{
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 28, fontWeight: '700',
            color: valid ? C.primary : C.textSoft,
            minWidth: 22, textAlign: 'center',
          }}
        >
          {valid ? c : '—'}
        </Text>
      ))}
    </View>
  );
}
