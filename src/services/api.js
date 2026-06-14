// Endpoints worker -- regroupement des fetch() typiquement non-authenticated
// ou avec injection runnerApiFetch (Bearer auto).
//
// Le pattern { status, error } sur les retours non-OK permet au caller de
// distinguer rate-limit (429) de PIN incorrect (401) et d'afficher le
// message adapte.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { API_URL } from '../constants/api';

export const api = {
  async getEvents() {
    const r = await fetch(`${API_URL}/public-events`);
    return r.ok ? r.json() : [];
  },
  async login(code, password, role, photographer_name) {
    const r = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, role, photographer_name }),
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },

  // RGPD biometrie -- suivre un event = geste de consentement explicite.
  // 400 'selfie_required' si pas de selfie depose -> l'UI ouvre SelfieModal
  // puis relance. Audit B14 : signature (eventCode, runnerApiFetch), le
  // fetcher injecte le Bearer.
  async follow(eventCode, runnerApiFetch) {
    const r = await runnerApiFetch(`/runner/follow/${encodeURIComponent(eventCode)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true }),
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },
  async unfollow(eventCode, runnerApiFetch) {
    const r = await runnerApiFetch(`/runner/follow/${encodeURIComponent(eventCode)}`, {
      method: 'DELETE',
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },
  // Wipe biometrique chirurgical : supprime selfie + empreintes sans toucher au compte.
  async deleteFaceData(runnerApiFetch) {
    const r = await runnerApiFetch(`/runner/face-data`, {
      method: 'DELETE',
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },
  // E2 -- enregistre le token Expo push cote worker.
  async registerPushToken(runnerToken, expoToken, platform) {
    try {
      const r = await fetch(`${API_URL}/runner/push-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runnerToken}` },
        body: JSON.stringify({ token: expoToken, platform }),
      });
      return r.ok;
    } catch { return false; }
  },
  async deletePushToken(runnerToken) {
    try {
      await fetch(`${API_URL}/runner/push-token`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${runnerToken}` },
      });
    } catch {}
  },
};

// E2 -- wrapper unique pour (a) silent re-register au boot si deja autorise,
// (b) ask + register apres premier follow. Idempotent : iOS ne re-affiche
// pas le prompt une fois denied (Notifications.requestPermissionsAsync
// retourne la decision existante).
export async function ensurePushRegistered(runnerToken, { ask = false } = {}) {
  if (!Device.isDevice) return; // simulator -> rien a faire
  if (!runnerToken) return;
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    if (!ask) return; // boot silencieux : on n'embete pas le user
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
    if (status !== 'granted') return;
  }
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId
    || Constants?.easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] projectId introuvable dans expo.extra.eas');
    return;
  }
  try {
    const tokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoToken = tokenObj?.data;
    if (!expoToken) return;
    await api.registerPushToken(runnerToken, expoToken, Platform.OS);
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync', e?.message || e);
  }
}
