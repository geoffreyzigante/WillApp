// expo-haptics : require optional pour rester OTA-safe.
// - Sur le build actuel (sans module natif expo-haptics linke) : les appels
//   selectionAsync echouent silencieusement via le catch cote caller (pas
//   de crash).
// - Apres rebuild EAS (qui inclura le natif suite a la commande
//   `npx expo install expo-haptics`), les appels fonctionnent automatiquement
//   et declenchent UISelectionFeedbackGenerator (= tap court galerie iPhone).
//
// Usage cote caller :
//   try { Haptics?.selectionAsync?.(); } catch {}

let Haptics;
try { Haptics = require('expo-haptics'); } catch {}

export { Haptics };
