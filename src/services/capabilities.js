// Capacites natives — source de verite unique.
//
// POURQUOI CE FICHIER
// -------------------
// Le code metier ne doit JAMAIS demander "suis-je sur iOS ?" mais "cette
// capacite est-elle disponible ?". La difference n'est pas cosmetique :
//
//   Platform.OS === 'ios'        -> faux des qu'un module manque sur iOS
//                                   (Expo Go, build dev sans natif) et
//                                   faux a reecrire entierement pour Android.
//   caps.backgroundUpload        -> vrai partout, y compris le jour ou
//                                   Android implemente le module via
//                                   WorkManager. Zero ligne a changer.
//
// Le portage Android consiste alors a fournir les modules natifs manquants,
// pas a auditer les `Platform.OS` disperses dans l'app. Cf.
// plugins/CONTRAT_NATIF.md pour la specification de chaque module.
//
// PRINCIPE D'ARCHITECTURE (deja tenu par le code existant)
// --------------------------------------------------------
// Le natif MESURE et EXECUTE. Le JS DECIDE.
//   - HumanDetectorPlugin renvoie des bbox brutes, sans seuil.
//   - ExposureReaderPlugin applique un cap que JS lui dicte.
//   - lineTrigger.js / framingGuide.js : purs, testes, communs aux deux OS.
// Toute logique de decision qui descendrait dans le natif devrait etre
// ecrite deux fois et testee zero fois. C'est la regle a ne pas casser.
//
// CE FICHIER N'A AUCUN EFFET DE BORD SUR LE COMPORTEMENT ACTUEL.
// Il ne fait que lire NativeModules et re-exposer les detections deja
// faites par les wrappers existants.

import { Platform, NativeModules } from 'react-native';
import { hasBackgroundUploader } from './backgroundUploader';
import { hasThermalMonitor } from './thermalMonitor';

// ─── Modules exposes via NativeModules (detection immediate) ───────────────

// Grave le dossard + l'EXIF dans le fichier final. Sans lui, la photo part
// telle quelle : degradation acceptable, pas un blocage.
const hasMetadataBurner = !!NativeModules.PhotoMetadataBurner?.burnMetadata;

// Scoring qualite local. VOUE A DISPARAITRE : le quality_score utilise par
// le serveur est calcule cote worker (processPhotoAsync via Rekognition),
// et le declenchement par lignes saute deja ce module. A ne PAS porter sur
// Android.
const hasQualityScorer = !!NativeModules.PhotoQualityScorer?.scoreRaw;

// ─── Frame processors VisionCamera ────────────────────────────────────────
//
// Ceux-la ne peuvent pas etre detectes ici : `initFrameProcessorPlugin` a
// lieu au chargement d'App.js et un second appel serait au mieux inutile,
// au pire un doublon d'enregistrement. App.js publie donc le resultat de SA
// detection via reportFrameProcessor(), et ce module se contente de le
// memoriser. Tant que rien n'est publie, on suppose disponible (valeur de
// depart historique : l'app plantait explicitement si le plugin manquait).

const frameProcessors = {
  detectHumans: true,
  readExposure: true,
};

export function reportFrameProcessor(name, available) {
  if (Object.prototype.hasOwnProperty.call(frameProcessors, name)) {
    frameProcessors[name] = !!available;
  }
}

// ─── Surface publique ─────────────────────────────────────────────────────

export const caps = {
  // Detection de visages dans le flux camera. SANS ELLE, PAS DE PRODUIT :
  // c'est la seule capacite reellement bloquante.
  get faceDetection() { return frameProcessors.detectHumans; },

  // Lecture ISO / vitesse / luminosite live. Absente -> le voyant lumiere
  // et le cap shutter adaptatif sont inertes, la capture fonctionne.
  get exposureRead() { return frameProcessors.readExposure; },

  // Upload qui survit a l'app minimisee. Absent -> fallback fetch (deja
  // implemente dans drainQueue), l'upload s'arrete si l'app passe en fond.
  backgroundUpload: hasBackgroundUploader,

  // Etat thermique -> concurrence d'upload. Absent -> concurrence fixe.
  thermalState: hasThermalMonitor,

  // Dossard + EXIF graves dans le fichier. Absent -> photo brute.
  metadataBurn: hasMetadataBurner,

  // Scoring local. Deprecie, cf. ci-dessus.
  qualityScore: hasQualityScorer,

  // ─── Capacite PRODUIT, et non technique ────────────────────────────────
  //
  // Le mode photographe n est propose que si la plateforme sait faire les
  // deux mesures dont la capture depend : reconnaitre les visages dans le
  // flux, et lire l exposition. La premiere declenche, la seconde regle le
  // cap d obturateur et le voyant lumiere — sans elle un benevole shoote
  // sans savoir que la scene est trop sombre.
  //
  // Sur Android aujourd hui : detectHumans existe (ML Kit), readExposure
  // non. Le mode reste donc masque, et il s activera de lui-meme le jour ou
  // le portage sera fait. Aucune ligne a changer ce jour-la, et surtout
  // aucun `Platform.OS === 'ios'` dispersé dans l interface.
  get photographerMode() {
    return frameProcessors.detectHumans && frameProcessors.readExposure;
  },
};

// Utile au diagnostic terrain : une seule ligne de log dit exactement ce
// que le binaire embarque. A appeler au montage de la vue photographe.
export function describeCapabilities() {
  const on = [];
  const off = [];
  for (const k of ['faceDetection', 'exposureRead', 'backgroundUpload',
    'thermalState', 'metadataBurn', 'qualityScore']) {
    (caps[k] ? on : off).push(k);
  }
  return `[caps] ${Platform.OS} | ok: ${on.join(',') || '-'} | absent: ${off.join(',') || '-'}`;
}
