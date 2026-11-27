// Mention de droits au PREMIER acces d un photographe a un event — meme
// texte que l espace photographe web (dashboard/src/photographer/modals/
// MentionModal.js). La case est obligatoire ; l acceptation est horodatee
// cote serveur (POST /photographer/accept-cgu) et memorisee par photographe
// et par event.
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from '../../constants/colors';
import { T } from '../../constants/tokens';
import { lh } from '../../constants/typo';

export function MentionDroitsModal({ visible, nomEvent, onAccepter, envoi, erreur }) {
  const [coche, setCoche] = useState(false);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(26,20,38,0.55)', justifyContent: 'center', paddingHorizontal: 22 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 24 }}>
          <Text style={{ fontFamily: 'AVEstiana', fontSize: 24, lineHeight: lh(24, 28, 'AVEstiana'), color: T.couleur.texte, marginBottom: 10 }}>
            Avant ton premier envoi
          </Text>
          <Text style={{ fontFamily: 'Montserrat', fontSize: 14, lineHeight: lh(14, 21, 'Montserrat'), color: T.couleur.texteDoux, marginBottom: 18 }}>
            Tes photos seront publiées dans la galerie {nomEvent ? `de ${nomEvent}` : 'de cet event'}, et chaque coureur retrouvera les siennes.
          </Text>

          <TouchableOpacity
            onPress={() => setCoche(v => !v)}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: coche }}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: T.couleur.champFond, borderRadius: 12, padding: 14, marginBottom: 14 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 6, marginTop: 1, backgroundColor: coche ? C.orga : '#fff', alignItems: 'center', justifyContent: 'center' }}>
              {coche ? (
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="m4 12 6 6L20 6" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              ) : null}
            </View>
            <Text style={{ flex: 1, fontFamily: 'Montserrat', fontSize: 13.5, lineHeight: lh(13.5, 20, 'Montserrat'), color: T.couleur.texte }}>
              Je garantis avoir le droit de diffuser ces photos. L'organisateur reste responsable de leur publication.
            </Text>
          </TouchableOpacity>

          {erreur ? (
            <Text accessibilityRole="alert" style={{ fontFamily: 'Montserrat', fontSize: 13, color: T.couleur.erreur, marginBottom: 12 }}>{erreur}</Text>
          ) : null}

          <TouchableOpacity
            onPress={onAccepter}
            disabled={!coche || envoi}
            activeOpacity={0.85}
            style={{ height: 52, borderRadius: 14, backgroundColor: C.orga, alignItems: 'center', justifyContent: 'center', opacity: !coche || envoi ? 0.35 : 1 }}
          >
            {envoi ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>C'est parti</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => Linking.openURL('https://will-app.com/cgu').catch(() => {})} hitSlop={10} style={{ alignSelf: 'center', marginTop: 16 }}>
            <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 13, color: C.orga }}>Lire les conditions complètes</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
