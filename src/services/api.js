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

// Audit B14 -- Wrapper fetch qui :
// 1) Detecte les erreurs reseau (fetch throw : TypeError "Network request
//    failed" sur RN) et les normalise en Error("Connexion impossible.
//    Verifie ton reseau.").
// 2) Detecte les 401 (session expiree cote serveur) et appelle onAuthFailure
//    (caller fournit l Alert + logout adapte a la session).
//
// Retourne la Response standard si OK. Le caller gere r.ok / r.json comme
// avant -- pas de refacto des call-sites au-dela de l URL/headers.
//
// Pour les call-sites SANS session (ex /auth/submit-event anonyme), appeler
// apiFetch directement sans onAuthFailure : normalisation reseau seule.
export async function apiFetch(path, options = {}, { onAuthFailure } = {}) {
  let r;
  try {
    r = await fetch(`${API_URL}${path}`, options);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Connexion impossible. Vérifie ton réseau.');
  }
  if (r.status === 401 && onAuthFailure) {
    onAuthFailure();
    throw new Error('Session expirée');
  }
  return r;
}

// Audit B15 -- Upload selfie sur R2, factorise pour permettre l usage depuis
// SelfieModal.save (1ere tentative declenchee par onSaved cote App) et depuis
// le retry manuel. Throw explicite si HTTP non-OK pour que le caller bascule
// le state d upload en 'failed'.
// Audit B14a followup -- apiFetch direct (sans onAuthFailure) au lieu de
// runnerApiFetch. Cas edge identifie : PUT /selfie/{userId} juste apres
// signup avec un token frais peut renvoyer 401 le temps de la propagation
// cote serveur. Si on declenche handle*AuthFailure sur ce 401, l utilisateur
// est deloggue au milieu de l onboarding selfie -> boucle login/save/logout.
// Le 401 propage comme erreur normale, runSelfieUpload catch et bascule en
// 'failed' (etat visuel B15) sans logout.
export async function uploadSelfieToR2(uri, userId, runnerToken) {
  const blob = await (await fetch(uri)).blob();
  const r = await apiFetch(`/selfie/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      Authorization: `Bearer ${runnerToken}`,
    },
    body: blob,
  });
  if (!r.ok) {
    // Le worker rejette si bbox.Height < 0.7 (visage trop petit). On
    // parse le body JSON pour proposer un message clair coté UI.
    let payload = null;
    try { payload = await r.json(); } catch (e) {}
    if (payload?.error === 'face_too_small') {
      const err = new Error('face_too_small');
      err.code = 'face_too_small';
      err.userMessage = payload.message || "Visage trop petit. Approche-toi de la caméra pour remplir l'ovale.";
      throw err;
    }
    throw new Error('HTTP ' + r.status);
  }
}

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
