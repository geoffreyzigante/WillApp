// Porte d entree du lancement d event, cote app.
//
// Avant, appuyer sur « Espace organisateur » ouvrait un formulaire de
// connexion — a quelqu un qui etait deja connecte. Et l espace lui-meme n a
// pas de sens tant qu il est vide : on n ouvre pas un espace, on lance un
// event, et l espace vient avec.
//
// Cette page dit donc seulement ce que Will apporte a un organisateur, puis
// passe la main au formulaire. Le compte organisateur — role ajoute a une
// session coureur, ou inscription complete pour un visiteur — n est cree
// qu a la validation de l event.
//
// Plein ecran plutot que feuille : trois promesses, une illustration et un
// seul geste, c est une page d entree, pas un tiroir.

import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ActivityIndicator,
  useWindowDimensions, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../../constants/colors';
import { Icon } from '../Icon';

const PROMESSES = [
  'Remplis les informations\net publie ton event',
  'Utilise Will et/ou invite\ntes propres photographes',
  'Suis les photos,\nleurs téléchargements\net leurs ventes',
];

export function OuvrirEspaceOrgaModal({ visible, onClose, onOuvrir, busy = false, erreur = '' }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const padHaut = (insets.top || StatusBar.currentHeight || 20) + 44;
  // L illustration prend la place qui reste, jamais plus : la page doit
  // tenir d un seul regard, sans scroll.
  const [placeRestante, setPlaceRestante] = useState(0);
  const tailleIllu = Math.max(
    120,
    Math.min(width * 0.72, placeRestante * (375.98 / 366.86)),
  );

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {/* Meme entete que le formulaire et que les ecrans d auth : c est la
            meme porte, elle doit se reconnaitre. */}
        <LinearGradient
          colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingHorizontal: 22, paddingTop: padHaut, paddingBottom: 26 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={10}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: 'Montserrat', color: '#fff', fontSize: 16, lineHeight: 18 }}>✕</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center', marginRight: 30, marginBottom: 12 }}>
              <Icon.Fusee size={38} color={C.pinkPill} />
            </View>
          </View>
          <Text style={{ fontFamily: 'AVEstiana', fontSize: 40, lineHeight: 34, color: '#fff', textAlign: 'center' }}>
            Lancer{'\n'}mon event
          </Text>
          <Text style={{
            fontFamily: 'Montserrat-SemiBold', fontSize: 15, lineHeight: 21,
            color: 'rgba(255,255,255,0.92)', textAlign: 'center', marginTop: 4, paddingHorizontal: 12,
          }}>
            Rends tes photos accessibles{'\n'}à tous les participants
          </Text>
        </LinearGradient>

        <View style={{ flex: 1, paddingTop: 28, paddingBottom: insets.bottom }}>
          <View style={{ marginTop: 8, paddingHorizontal: 34 }}>
            {PROMESSES.map((ligne, i) => (
              <View key={ligne} style={{ alignItems: 'center', marginBottom: 20 }}>
                <View style={{
                  width: 24, height: 24, borderRadius: 12, backgroundColor: C.primaryLight,
                  alignItems: 'center', justifyContent: 'center', marginBottom: 10,
                }}>
                  <Text style={{ fontFamily: 'Montserrat-Bold', fontSize: 12, color: C.primary }}>{i + 1}</Text>
                </View>
                <Text style={{
                  fontFamily: 'Montserrat-Medium', fontSize: 15, lineHeight: 22,
                  color: C.text, textAlign: 'center',
                }}>
                  {ligne}
                </Text>
              </View>
            ))}
          </View>

          {erreur ? (
            <Text style={{ fontFamily: 'Montserrat', color: '#ff6b6b', fontSize: 13, textAlign: 'center', marginTop: 16, paddingHorizontal: 34 }}>
              {erreur}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={() => onOuvrir()}
            disabled={busy}
            activeOpacity={0.9}
            style={{
              alignSelf: 'center', marginTop: 26,
              minWidth: 172, height: 54, borderRadius: 12,
              backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: 30, opacity: busy ? 0.6 : 1,
            }}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontFamily: 'AVEstiana', fontSize: 27, lineHeight: 32 }}>Go!</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 15, color: C.textSoft }}>Plus tard</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}
