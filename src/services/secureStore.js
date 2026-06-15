// SecureStore wrapper + migration (Audit M-S08, 2026-04).
//
// Les sessions runner/organizer/photographer + consentement biometrique sont
// stockes chiffres via expo-secure-store. Migration one-shot au demarrage de
// l app : pour chaque cle sensible, si elle existe encore dans AsyncStorage
// (build legacy avant la migration), on la copie vers SecureStore puis on
// l efface. Idempotent (skip si AsyncStorage vide ou SecureStore deja peuple).
//
// SecureStore n accepte que [A-Za-z0-9._-] : on normalise les cles "@will_*"
// en "will_*" via toSecureKey().

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export const BIOMETRIC_CONSENT_KEY = '@will_biometric_consent_v1';

export const SECURE_KEYS = [
  '@will_runner',
  '@will_organizer',
  '@will_photographer_session',
  BIOMETRIC_CONSENT_KEY,
];

export const toSecureKey = (k) => k.replace(/^@/, 'will_');

export const Secure = {
  getItem: (k) => SecureStore.getItemAsync(toSecureKey(k)),
  setItem: (k, v) => SecureStore.setItemAsync(toSecureKey(k), v),
  removeItem: (k) => SecureStore.deleteItemAsync(toSecureKey(k)),
};

export async function migrateSensitiveKeysToSecureStore() {
  for (const k of SECURE_KEYS) {
    try {
      const v = await AsyncStorage.getItem(k);
      if (v === null) continue;
      const existing = await SecureStore.getItemAsync(toSecureKey(k));
      if (existing === null) await SecureStore.setItemAsync(toSecureKey(k), v);
      await AsyncStorage.removeItem(k);
    } catch (e) {
      console.warn('[migrate-secure]', k, e?.message || e);
    }
  }
}
