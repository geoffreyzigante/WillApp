// Sous-modal full-screen pour edit un champ texte unique (email, nom,
// password, etc.). Pattern iOS "Settings" : header avec titre + croix +
// TextInput + bouton Enregistrer en bas, suit le clavier.
//
// Suivi manuel kbHeight : KeyboardAvoidingView est peu fiable sur iOS dans
// une Modal (encore moins avec presentationStyle).

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, TextInput,
  Keyboard, Platform, StyleSheet, ActivityIndicator,
} from 'react-native';
import { C } from '../../constants/colors';

export function SubModalInputText({ visible, title, value, onChangeText, placeholder, keyboardType, autoCapitalize, secureTextEntry, onClose, onSave, busy }) {
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!visible) { setKbHeight(0); return; }
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sh = Keyboard.addListener(showName, e => setKbHeight(e?.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideName, () => setKbHeight(0));
    return () => { sh.remove(); hd.remove(); };
  }, [visible]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
        <View style={{
          paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(123,47,255,0.3)',
          backgroundColor: '#fff',
        }}>
          <View style={{ width: 60 }} />
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
            <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={value || ''}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor="#9CA3AF"
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            secureTextEntry={!!secureTextEntry}
            style={{
              fontSize: 17, color: C.text,
              paddingVertical: 14, paddingHorizontal: 16,
              backgroundColor: '#fff', borderRadius: 14,
              marginHorizontal: 16,
            }}
            autoFocus
          />
        </ScrollView>
        <View style={{ paddingBottom: kbHeight }}>
          <TouchableOpacity
            onPress={onSave}
            disabled={busy}
            style={{
              marginHorizontal: 16, marginBottom: kbHeight > 0 ? 12 : 28,
              paddingVertical: 14, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
