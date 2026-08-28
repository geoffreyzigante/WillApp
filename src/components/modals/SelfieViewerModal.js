// Modal full-screen pour visualiser le selfie en grand depuis le profile menu.

import React from 'react';
import { Modal, View, TouchableOpacity } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';

export function SelfieViewerModal({ visible, uri, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Fond sombre plutot que violet plein cadre : on regarde une photo,
          on ne change pas d univers. */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(15,7,35,0.92)', justifyContent: 'center', alignItems: 'center' }}
      >
        <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: 60, right: 20, padding: 10 }} hitSlop={20}>
          <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
        {uri ? (
          <ExpoImage source={{ uri }} style={{ width: '78%', aspectRatio: 1, borderRadius: 24 }} contentFit="cover" />
        ) : null}
      </TouchableOpacity>
    </Modal>
  );
}
