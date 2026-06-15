// Helpers de style dynamique (fonctions qui retournent des objets style
// React Native conditionnellement au state). Centralise pour ne pas dupliquer
// les meme combinaisons cote screens.

import { C } from '../constants/colors';

// Pills toggle Type d epreuve / Nom personnalise dans les formulaires
// distance (wizard step 2 + sub-modal edition).
export const modeChipStyleApp = (active) => ({
  paddingHorizontal: 10, paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: active ? '#7B2FFF' : 'transparent',
  borderWidth: 1,
  borderColor: active ? '#7B2FFF' : '#d8d4e0',
});

export const modeChipTextStyleApp = (active) => ({
  fontSize: 11, fontWeight: '700',
  color: active ? '#fff' : '#666',
});

// Couleur pastille selfie derivee de l etat d upload. Hex alignes sur les
// occurrences existantes du code (cf UI-09 backlog pour tokeniser plus tard).
export function selfieDotColor(state) {
  if (state === 'failed') return C.error;
  if (state === 'ok') return C.success;
  return C.warning; // 'uploading' ou 'idle' avec selfieUri local non confirme
}
