// Modal selfie : capture + consentement biometrique RGPD art. 9.
//
// Flow :
//   1. Si consentement biometrique pas encore donne -> screen consentement
//      avec checkbox obligatoire + lien vers privacy + lecture lien externe.
//   2. Apres consentement -> preview du selfie + boutons "Prendre une photo"
//      (ouvre SelfieCameraModal) ou "Choisir" (ImagePicker).
//   3. Save : ecriture locale AsyncStorage + onSaved cote App qui PUT R2.
//
// Audit B14a followup : await onSaved cote save() pour attendre la confirmation
// R2 avant de fermer la modal. Sinon le pendingFollow relance toggleFollow
// alors que le PUT R2 n est pas encore propage serveur, worker repond
// selfie_required, et la SelfieModal se rouvre.

import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icon';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { Secure, BIOMETRIC_CONSENT_KEY } from '../../services/secureStore';
import {
  TexteConsentBiometrique, LABEL_CASE_CONSENT, URL_CONFIDENTIALITE,
  LIEN_CONFIDENTIALITE_LABEL, PHRASE_SELFIE_AVANT_COURSE,
} from '../TexteConsentBiometrique';
import { SelfieCameraModal } from './SelfieCameraModal';

export function SelfieModal({ visible, onClose, onSaved, userId, signupMode = false, onSkip }) {
  const [uri, setUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Consentement biometrique RGPD art. 9 : on demande explicitement la 1ere fois
  // et on persiste la date d acceptation (revocable via suppression du selfie).
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(null); // null = en cours de chargement

  const previewScale = useRef(new Animated.Value(1)).current;
  const onPreviewPressIn = () => {
    Animated.spring(previewScale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const onPreviewPressOut = () => {
    Animated.spring(previewScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  useEffect(() => {
    if (!visible) return;
    // Reset uri local a l ouverture : le component reste monte entre les
    // ouvertures (Modal cache != unmount). Sans ce reset, apres une suppression
    // de selfie suivie de la reouverture du modal, le state uri local garde
    // l ancienne photo et la preview montre l ancien selfie.
    setUri(null);
    Secure.getItem(BIOMETRIC_CONSENT_KEY).then(v => {
      setConsentGiven(!!v);
      setConsentChecked(false);
    });
  }, [visible]);

  const acceptConsent = async () => {
    if (!consentChecked) return;
    await Secure.setItem(BIOMETRIC_CONSENT_KEY, new Date().toISOString());
    setConsentGiven(true);
  };

  const take = () => {
    setCameraOpen(true);
  };

  const save = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      await AsyncStorage.setItem('@will_selfie', uri);
      await onSaved?.(uri);
      onClose();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop frosted glass (alignement UX modaux auth photographe/orga). */}
      {/* Le flou n existe pas sur Android (expo-blur y retombe sur un simple
          voile) : le fond force a 'transparent' ne laissait alors AUCUNE
          separation entre la feuille et la page. On garde le flou sur iOS et
          le voile maison rgba(0,0,0,0.4) de modalBackdrop sur Android. */}
      {Platform.OS === 'ios' ? (
        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
      ) : null}
      <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, Platform.OS === 'ios' ? { backgroundColor: 'transparent' } : null]} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { paddingBottom: 32 }]} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>

          {consentGiven === false ? (
            <>
              <Text style={[s.modalTitle, selfie.titre]}>Reconnaissance faciale</Text>
              <TexteConsentBiometrique style={[s.modalSub, selfie.texte, { textAlign: 'left' }]} />
              <TouchableOpacity
                onPress={() => Linking.openURL(URL_CONFIDENTIALITE).catch(() => {})}
                style={{ marginBottom: 16, alignSelf: 'flex-start' }}
                hitSlop={10}
              >
                <Text style={{ color: C.primary, fontSize: 13, fontFamily: 'Montserrat-SemiBold', textDecorationLine: 'underline' }}>
                  {LIEN_CONFIDENTIALITE_LABEL}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConsentChecked(c => !c)}
                style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 }}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                  borderColor: consentChecked ? C.primary : '#bbb',
                  backgroundColor: consentChecked ? C.primary : 'transparent',
                  marginRight: 10, marginTop: 2, alignItems: 'center', justifyContent: 'center',
                }}>
                  {consentChecked ? (
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path d="m5 12 5 5L20 7" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  ) : null}
                </View>
                <Text style={{ fontFamily: 'Montserrat', flex: 1, color: C.text, fontSize: 14, lineHeight: 19 }}>
                  {LABEL_CASE_CONSENT}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[selfie.cta, !consentChecked && { opacity: 0.4 }]}
                onPress={acceptConsent}
                disabled={!consentChecked}
                activeOpacity={0.85}
              >
                <Text style={selfie.ctaTexte}>Continuer</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {signupMode && (
                <Text style={{ color: C.textSoft, fontSize: 12, fontFamily: 'Montserrat-SemiBold', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
                  Étape 2 sur 2
                </Text>
              )}
              <Text style={[s.modalTitle, selfie.titre]}>{signupMode ? 'Prends ton selfie' : 'Mon selfie'}</Text>
              <Text style={[s.modalSub, selfie.texte]}>
                {signupMode
                  ? "Will reconnaîtra ton visage sur les photos des events Will. Image chiffrée, serveurs européens. Consentement valable 12 mois renouvelables."
                  : "Ton selfie est utilisé pour la reconnaissance faciale sur tous les events Will. Chiffré, serveurs européens. Consentement valable 12 mois renouvelables."}
              </Text>

              <View style={s.selfiePreviewWrap}>
                <Animated.View style={{ transform: [{ scale: previewScale }] }}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={take}
                    onPressIn={onPreviewPressIn}
                    onPressOut={onPreviewPressOut}
                  >
                    {uri ? (
                      <ExpoImage source={{ uri }} style={selfie.apercu} contentFit="cover" />
                    ) : (
                      <View style={[selfie.apercu, { backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                        <Icon.User size={80} color={C.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              </View>

              {/* Prise de vue en direct uniquement : autoriser une photo de
                  la galerie reviendrait a laisser n importe qui enregistrer
                  le visage d un autre. C est la seule barriere qui rattache
                  le compte a la personne. */}
              {/* Audit coureur 13 -- le rattrapage des selfies deposes apres
                  coup ne sera pas implemente (cout reconnaissance faciale).
                  On le dit ici, une fois, sans dramatiser. */}
              <Text style={[selfie.texte, { marginTop: 10, marginBottom: 12, fontSize: 12.5, lineHeight: 17 }]}>
                {PHRASE_SELFIE_AVANT_COURSE}
              </Text>

              <TouchableOpacity style={selfie.pastille} onPress={take} activeOpacity={0.8}>
                <Text style={selfie.pastilleTexte}>Prendre une photo</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[selfie.cta, !uri && { opacity: 0.4 }]} onPress={save} disabled={!uri || busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={selfie.ctaTexte}>Enregistrer mon selfie</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={selfie.fermer} onPress={signupMode ? (onSkip || onClose) : onClose}>
                <Text style={selfie.fermerTexte}>{signupMode ? 'Faire mon selfie plus tard' : 'Fermer'}</Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>

      <SelfieCameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(capturedUri) => {
          setUri(capturedUri);
          setCameraOpen(false);
        }}
      />
    </Modal>
  );
}

// Meme vocabulaire que le reste de l app : titre AVEstiana violet, texte
// gris lisible (il etait en violet pale, presque efface), actions en
// pastilles plates et CTA violet plein h50 — comme la connexion.
const selfie = StyleSheet.create({
  titre: { fontFamily: 'Montserrat', color: C.primary, fontSize: 26, marginBottom: 8 },
  texte: { fontFamily: 'Montserrat',
    color: 'rgba(26,10,62,0.55)',
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: 18,
  },
  apercu: { width: 190, height: 190, borderRadius: 24 },
  pastille: {
    height: 46,
    borderRadius: 14,
    backgroundColor: '#F3EFFE',
    alignItems: 'center', justifyContent: 'center',
  },
  pastilleTexte: { color: C.primary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 },
  cta: {
    height: 50,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 14,
  },
  ctaTexte: { color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 15 },
  fermer: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  fermerTexte: { color: 'rgba(26,10,62,0.45)', fontFamily: 'Montserrat-SemiBold', fontSize: 14 },
});
