// Modal one-shot "Reconnaissance Will v2" : explique le passage du selfie
// par event au selfie unique (decision produit Phase D). Affichee a la
// 1ere ouverture post-migration uniquement.

import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export function PhaseDResetModal({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(26,20,38,0.45)',
        justifyContent: 'center', padding: 24,
      }}>
        <View style={{
          backgroundColor: '#fff', borderRadius: 20, padding: 24,
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
        }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: '#EDE4FF',
            alignItems: 'center', justifyContent: 'center',
            alignSelf: 'center', marginBottom: 14,
          }}>
            <Svg width={28} height={26} viewBox="-1 -1.5 22.78 20.61" fill="#7B2FFF">
              <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
            </Svg>
          </View>
          <Text style={{
            fontSize: 18, fontWeight: '800', color: '#1A1426',
            textAlign: 'center', marginBottom: 10, letterSpacing: -0.3,
          }}>
            Reconnaissance Will, version 2
          </Text>
          <Text style={{
            fontSize: 14, color: 'rgba(123,47,255,0.3)', lineHeight: 20,
            textAlign: 'center', marginBottom: 22,
          }}>
            <Text style={{ fontWeight: '700', color: '#1A1426' }}>Un seul selfie</Text> suffit désormais pour recevoir tes photos sur tous les events Will. Consentement valable 12 mois renouvelables. Tu peux le retirer à tout moment depuis ton profil.
          </Text>
          <TouchableOpacity onPress={onClose} style={{
            backgroundColor: '#7B2FFF', borderRadius: 999,
            paddingVertical: 13, alignItems: 'center',
          }} activeOpacity={0.85}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>J'ai compris</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
