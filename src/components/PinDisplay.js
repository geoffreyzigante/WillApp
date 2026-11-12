// Affichage PIN en lecture seule (detail event organizer, masque/reveal).
// Chiffres gros, espaces 10px, monospace violet. 4 ou 6 chiffres selon
// l epoque de l event (cf src/utils/pin.js).

import React from 'react';
import { View, Text, Platform } from 'react-native';
import { C } from '../constants/colors';
import { isKnownPin } from '../utils/pin';

export function PinDisplay({ pin, masked = true }) {
  const valid = isKnownPin(pin);
  const chars = valid ? String(pin).split('') : ['', '', '', ''];
  const display = masked ? chars.map(() => '•') : chars;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {display.map((c, i) => (
        <Text
          key={i}
          style={{
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 28, 
            color: valid ? C.primary : '#A89CB8',
            minWidth: 22, textAlign: 'center',
          }}
        >
          {valid ? c : '—'}
        </Text>
      ))}
    </View>
  );
}
