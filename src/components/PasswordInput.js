// Champ mot de passe avec icone oeil pour afficher/masquer.
// Props pass-through au TextInput interne + autoCapitalize default 'none'.

import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Icon } from './Icon';

export function PasswordInput({ value, onChangeText, placeholder, style, autoFocus, autoCapitalize = 'none', placeholderTextColor }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ position: 'relative', justifyContent: 'center' }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        secureTextEntry={!visible}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        style={[style, { paddingRight: 44 }]}
      />
      <TouchableOpacity
        onPress={() => setVisible(v => !v)}
        hitSlop={10}
        style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}
      >
        {visible ? <Icon.EyeOff size={20} color="#9CA3AF" /> : <Icon.Eye size={20} color="#9CA3AF" />}
      </TouchableOpacity>
    </View>
  );
}
