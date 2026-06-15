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
  Modal, View, Text, TouchableOpacity, Animated, ActivityIndicator,
  Alert, Linking, StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../Icon';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { Secure, BIOMETRIC_CONSENT_KEY } from '../../services/secureStore';
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

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission refusée');
    const r = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!r.canceled && r.assets?.[0]?.uri) setUri(r.assets[0].uri);
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
      <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
      <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, { backgroundColor: 'transparent' }]} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { paddingBottom: 32 }]} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>

          {consentGiven === false ? (
            <>
              <Text style={s.modalTitle}>Reconnaissance faciale</Text>
              <Text style={[s.modalSub, { textAlign: 'left', lineHeight: 20 }]}>
                Pour t'envoyer automatiquement tes photos d'event, Will utilise ton selfie comme référence biométrique. L'image et l'empreinte faciale générée par AWS Rekognition sont chiffrées, stockées sur des serveurs européens (eu-west-1 Francfort).{'\n\n'}
                Ton consentement est valable <Text style={{ fontWeight: '700' }}>12 mois renouvelables</Text>. Tu recevras un rappel à J-30 et J-7 avant l'échéance. Sans renouvellement, ton selfie est automatiquement supprimé.{'\n\n'}
                Tu peux retirer ton consentement à tout moment depuis ton profil.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://will-app.com/privacy').catch(() => {})}
                style={{ marginBottom: 16, alignSelf: 'flex-start' }}
                hitSlop={10}
              >
                <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>
                  Lire la Politique de confidentialité
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
                <Text style={{ flex: 1, color: C.text, fontSize: 14, lineHeight: 19 }}>
                  J'accepte le traitement biométrique de mon image (RGPD art. 9) pour la reconnaissance faciale sur les events Will, pendant 12 mois renouvelables.
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrimary, !consentChecked && { opacity: 0.4 }]}
                onPress={acceptConsent}
                disabled={!consentChecked}
              >
                <Text style={s.btnPrimaryText}>Continuer</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {signupMode && (
                <Text style={{ color: C.textSoft, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
                  Étape 2 sur 2
                </Text>
              )}
              <Text style={s.modalTitle}>{signupMode ? 'Prends ton selfie' : 'Mon selfie'}</Text>
              <Text style={s.modalSub}>
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
                      <ExpoImage source={{ uri }} style={s.selfiePreview} contentFit="cover" />
                    ) : (
                      <View style={[s.selfiePreview, { backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                        <Icon.User size={80} color={C.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={take}>
                  <Text style={s.btnSecondaryText}>Prendre une photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={pick}>
                  <Text style={s.btnSecondaryText}>Choisir</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[s.btnPrimary, !uri && { opacity: 0.4 }]} onPress={save} disabled={!uri || busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Enregistrer mon selfie</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={s.modalCancel} onPress={signupMode ? (onSkip || onClose) : onClose}>
                <Text style={s.modalCancelText}>{signupMode ? 'Faire mon selfie plus tard' : 'Fermer'}</Text>
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
