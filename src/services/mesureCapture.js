// Phase 0 du portage Android de la capture photographe (25 nov 2026) :
// mesurer avant de coder. Actif UNIQUEMENT dans le build de test « mesure »
// (eas.json, EXPO_PUBLIC_MESURE_CAPTURE=1) ; les builds store ne le voient
// jamais, la constante y vaut false et le frame processor ne change pas.
//
// Ce que ca fait, rien de plus :
//   - ouvre le mode photographe sur un Android sans readExposure, pour
//     pouvoir le mesurer (cf. caps.photographerMode) ;
//   - journalise toutes les 2 s la cadence camera, la cadence d analyse et
//     la duree de detectHumans. Le delai de tir est deja journalise par
//     « [capture] takePhoto resolved ».
// Les lignes « [mesure] » remontent avec le journal embarque, lisible dans
// le dashboard (Journaux). Elles servent a fixer les seuils de l auto-test.
export const MESURE_CAPTURE = process.env.EXPO_PUBLIC_MESURE_CAPTURE === '1';
