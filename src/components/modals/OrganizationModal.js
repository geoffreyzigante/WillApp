// Bottom-sheet "Organisation" : choix entre Espace organisateur (gere et
// cree evenements) et Espace photographe (capture coureurs en direct).
// Affichee depuis le pill org sur le HomeScreen.

import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icon';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';

export function OrganizationModal({ visible, onClose, onPickRole }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>

          <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4 }]}>
            Organisation
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 20 }}>
            Choisis ton espace
          </Text>

          {/* Carte Espace organisateur */}
          <TouchableOpacity
            onPress={() => onPickRole('organizer')}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#faf9ff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: C.pinkPill,
              alignItems: 'center', justifyContent: 'center',
              marginRight: 14,
            }}>
              <Icon.Events color="#fff" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>Espace organisateur</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Crée et gère tes événements</Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          {/* Carte Espace photographe */}
          <TouchableOpacity
            onPress={() => onPickRole('photographer')}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#faf9ff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 8,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: C.primary,
              alignItems: 'center', justifyContent: 'center',
              marginRight: 14,
            }}>
              <Icon.PhotoCam size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>Espace photographe</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Capture les coureurs en direct</Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
