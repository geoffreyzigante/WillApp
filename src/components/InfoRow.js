// Ligne label/valeur avec separateur en bas (sauf si last=true). Utilise
// dans les profile menus (Runner et Organizer) pour afficher email / role /
// session info.

import React from 'react';
import { View, Text } from 'react-native';
import { C } from '../constants/colors';

export function InfoRow({ label, value, last }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: '#f0eaff',
    }}>
      <Text style={{ color: C.textSoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' }} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}
