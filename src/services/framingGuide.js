// Guide de cadrage bénévole — noyau géométrique.
// Cf. CONCEPTION_DECLENCHEMENT_LIGNES.md §1.8 (repère de distance sur chemin
// vide) et §1.6 (contrainte physique : présence en zone -> photos atteignables).
//
// Principe : le sol est supposé plan et l'appareil posé à une hauteur h connue.
// Le tangage θ vient de la gravité (accéléromètre). Sous ces hypothèses, chaque
// ligne de l'image située sous l'horizon correspond à une distance au sol
// calculable — sans sujet dans le cadre, sans capteur de profondeur.
//
// Conventions :
//   - RADIANS et MÈTRES partout
//   - pitch : angle de l'axe optique SOUS l'horizontale. > 0 = penché vers le
//             sol, 0 = axe horizontal, < 0 = relevé vers le ciel
//   - y     : ordonnée normalisée dans l'image, 0 = haut, 1 = bas
//   - projection rectilinéaire (tan), valable pour le 1x wide-angle. NE PAS
//     réutiliser tel quel si l'app repasse sur l'ultra-wide, dont la distorsion
//     invalide le modèle.

// ─────────────────────────────────────────────────────────────────────────────
// CHAMP DE VISION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Déduit les deux demi-champs à partir de `format.fieldOfView` (VisionCamera).
 *
 * AVFoundation expose `videoFieldOfView` = champ HORIZONTAL du capteur dans son
 * orientation native paysage (l'axe 4032 sur un 4032x3024). L'axe court (3024)
 * s'en déduit par le ratio.
 *
 * ⚠️ À VÉRIFIER SUR DEVICE — l'app est verrouillée en portrait (`app.json`),
 * donc l'image affichée ET les frames analysées peuvent être tournées : le
 * champ « large » devient alors le champ VERTICAL. Précédent direct dans ce
 * dépôt : le choix `axis: 'midX'` vs `'midY'` de HumanDetectorPlugin a dû être
 * tranché empiriquement pour cette raison exacte.
 *
 * L'enjeu n'est pas cosmétique : le sens du ratio change la largeur de zone
 * d'un facteur 1,35, donc le nombre de photos atteignables (§1.6).
 *
 * @param {number} fieldOfViewDeg  `format.fieldOfView`, en degrés
 * @param {'landscape'|'portrait'} imageOrientation  orientation de l'image
 *        telle qu'ANALYSÉE (pas celle de l'écran)
 * @param {number} aspectShortOverLong  3/4 pour un capteur 4:3
 */
export function fovFromFormat(fieldOfViewDeg, imageOrientation = 'portrait', aspectShortOverLong = 3 / 4) {
  const halfLong = (fieldOfViewDeg * Math.PI / 180) / 2;
  const halfShort = Math.atan(Math.tan(halfLong) * aspectShortOverLong);
  return imageOrientation === 'portrait'
    ? { halfFovH: halfShort, halfFovV: halfLong }   // portrait : l'axe long est vertical
    : { halfFovH: halfLong, halfFovV: halfShort };  // paysage  : l'axe long est horizontal
}

/** Demi-champ de l'axe court déduit de l'axe long (helper bas niveau). */
export function narrowHalfFov(wideHalfFovRad, aspectShortOverLong = 3 / 4) {
  return Math.atan(Math.tan(wideHalfFovRad) * aspectShortOverLong);
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTITUDE — dérivée de la gravité seule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tangage et roulis de l'axe optique arrière, à partir du vecteur gravité
 * exprimé dans le repère appareil iOS (X droite, Y haut, Z sortant de l'écran).
 *
 * L'axe de la caméra arrière est -Z. En notant ĝ la gravité normalisée :
 *      pitch = asin(-ĝz)      roll = atan2(ĝx, -ĝy)
 *
 * Repères de contrôle :
 *   posé à plat écran vers le haut -> ĝ=(0,0,-1) -> pitch=+90° (vise le sol)
 *   droit en portrait              -> ĝ=(0,-1,0) -> pitch=0°  (vise l'horizon)
 *
 * Le tangage est indépendant du roulis : c'est exactement ce qu'on veut.
 */
export function attitudeFromGravity({ x, y, z }) {
  const n = Math.hypot(x, y, z) || 1;
  const gx = x / n, gy = y / n, gz = z / n;
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, -gz))),
    roll: Math.atan2(gx, -gy),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION DU PLAN DU SOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distance au sol correspondant à une ordonnée image.
 * Infinity si la ligne vise au-dessus de l'horizon (pas d'intersection).
 */
export function groundDistanceAtY(yNorm, { height, pitch, halfFovV }) {
  const ndc = 2 * yNorm - 1;                          // -1 haut, +1 bas
  const gamma = Math.atan(ndc * Math.tan(halfFovV));  // angle / axe optique
  const beta = gamma + pitch;                         // angle sous l'horizontale
  if (beta <= 1e-6) return Infinity;
  return height / Math.tan(beta);
}

/**
 * Ordonnée image où tracer le repère d'une distance cible.
 * null si le point tombe hors cadre — c'est un retour utile : le bénévole doit
 * incliner l'appareil.
 */
export function yForGroundDistance(distance, { height, pitch, halfFovV }) {
  if (!(distance > 0)) return null;
  const beta = Math.atan(height / distance);
  const ndc = Math.tan(beta - pitch) / Math.tan(halfFovV);
  if (ndc < -1 || ndc > 1) return null;
  return (ndc + 1) / 2;
}

/**
 * Position dans l'image du point au sol situé droit devant, à `distance`.
 * C'est LE repère montré au bénévole : il place ce point au milieu du chemin,
 * et le cadrage est réglé. Aucune notion de distance à comprendre de son côté.
 *
 * Version vectorielle complète : contrairement à `yForGroundDistance`, elle
 * gère le ROULIS — le point se décale latéralement quand l'appareil penche,
 * exactement comme le ferait le vrai point au sol. Un simple trait horizontal
 * aurait exigé un roulis nul ; un point n'a pas cette contrainte.
 *
 * Repère caméra : X droite, Y bas, Z axe optique. La gravité s'y écrit
 *   ĝ = (cos θ·sin φ, cos θ·cos φ, sin θ)      θ = tangage, φ = roulis
 * L'horizontale avant f est la composante de l'axe optique orthogonale à ĝ.
 * Le point cherché vaut alors  p = d·f + h·ĝ.
 *
 * @returns {{x:number, y:number}|null} coordonnées normalisées [0..1],
 *          null si le point tombe hors cadre ou derrière l'appareil.
 */
export function groundPointInImage(distance, { height, pitch, roll = 0, halfFovH, halfFovV }) {
  if (!(distance > 0)) return null;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const g = { x: cp * Math.sin(roll), y: cp * Math.cos(roll), z: sp };

  // f = normalize(axe optique - (axe·ĝ)ĝ), avec axe = (0,0,1) donc axe·ĝ = g.z
  if (Math.abs(cp) < 1e-6) return null;            // appareil à la verticale
  const f = { x: -g.z * g.x / cp, y: -g.z * g.y / cp, z: (1 - g.z * g.z) / cp };

  const p = {
    x: distance * f.x + height * g.x,
    y: distance * f.y + height * g.y,
    z: distance * f.z + height * g.z,
  };
  if (p.z <= 1e-6) return null;                    // derrière l'appareil

  const ndcX = (p.x / p.z) / Math.tan(halfFovH);
  const ndcY = (p.y / p.z) / Math.tan(halfFovV);
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null;
  return { x: (ndcX + 1) / 2, y: (ndcY + 1) / 2 };
}

/** Largeur d'image (mètres) couverte à une distance donnée. */
export function frameWidthAt(distance, halfFovH) {
  return 2 * distance * Math.tan(halfFovH);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRÔLE A POSTERIORI PAR LA TAILLE DU VISAGE (§1.8)
// La géométrie règle, le visage vérifie.
// ─────────────────────────────────────────────────────────────────────────────

export function expectedFaceWidthFraction(distance, halfFovH, faceWidthM = 0.15) {
  return faceWidthM / frameWidthAt(distance, halfFovH);
}

export function distanceFromFaceWidth(fraction, halfFovH, faceWidthM = 0.15) {
  if (!(fraction > 0)) return Infinity;
  return faceWidthM / (2 * fraction * Math.tan(halfFovH));
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRAINTE PHYSIQUE (§1.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Durée de présence dans la zone de capture et photos atteignables.
 * Le capteur étant séquentiel (~150-200 ms/photo), 3 photos exigent >= 450 ms.
 */
export function dwell(distance, {
  halfFovH,
  zoneWidthFraction = 0.30,
  speed,
  captureIntervalMs = 150,
  budget = 3,
}) {
  const zoneWidthM = zoneWidthFraction * frameWidthAt(distance, halfFovH);
  const dwellMs = (zoneWidthM / speed) * 1000;
  const achievablePhotos = Math.max(1, Math.min(budget, Math.floor(dwellMs / captureIntervalMs)));
  return { zoneWidthM, dwellMs, achievablePhotos, meetsBudget: achievablePhotos >= budget };
}

/** Distance minimale pour atteindre le budget à une vitesse donnée. */
export function minDistanceForBudget({
  halfFovH,
  zoneWidthFraction = 0.30,
  speed,
  captureIntervalMs = 150,
  budget = 3,
}) {
  return (budget * captureIntervalMs / 1000) * speed
       / (2 * zoneWidthFraction * Math.tan(halfFovH));
}

// ─────────────────────────────────────────────────────────────────────────────
// VERDICT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `tolerance` = écart relatif accepté (0.25 = ±25 %). Cohérent avec la
 * précision réelle : l'erreur dominante est la hauteur saisie, et d ∝ h.
 * `maxRoll` : au-delà, l'hypothèse « horizon horizontal dans l'image » tombe.
 */
export function framingVerdict(measuredDistance, targetDistance, {
  tolerance = 0.25,
  roll = 0,
  maxRoll = 12 * Math.PI / 180,
} = {}) {
  if (Math.abs(roll) > maxRoll) {
    return { status: 'tilted', delta: null, message: 'Redresse le téléphone' };
  }
  if (!Number.isFinite(measuredDistance)) {
    return { status: 'no-ground', delta: null, message: 'Incline le téléphone vers le sol' };
  }
  const delta = measuredDistance - targetDistance;
  const ratio = measuredDistance / targetDistance;
  if (ratio < 1 - tolerance) {
    return { status: 'too-close', delta, message: `Recule d'environ ${Math.abs(delta).toFixed(1)} m` };
  }
  if (ratio > 1 + tolerance) {
    return { status: 'too-far', delta, message: `Avance d'environ ${Math.abs(delta).toFixed(1)} m` };
  }
  return { status: 'ok', delta, message: 'Cadrage bon' };
}

// ─────────────────────────────────────────────────────────────────────────────
// CIBLES (§1.8)
// ─────────────────────────────────────────────────────────────────────────────

/** Arbitre entre nombre de photos (plus loin = mieux) et taille du visage
 *  pour la reconnaissance (plus près = mieux).
 *
 *  ⚠️ Ces valeurs sont des cibles THÉORIQUES issues du §1.6. Le terrain
 *  (2026-07-29) rapporte des passages à ~2 m — bien en deçà. Le bénévole doit
 *  donc pouvoir choisir la distance réelle : un repère placé à 3,5 m sur un
 *  chemin qui passe à 2 m n'aide personne. La cible sert de valeur de départ,
 *  pas de contrainte. */
export const TARGET_DISTANCE_M = {
  marche: 2.5,
  route: 3.5,
  trail: 4.5,
  cross: 4.5,
  triathlon: 4.0,
  velo: 6.0,
  default: 3.0,
};

/** Choix offerts au bénévole. Couvre la plage de pose réelle constatée (2-6 m)
 *  sans donner l'illusion d'un réglage continu. */
export const DISTANCE_CHOICES_M = [2, 2.5, 3, 3.5, 4, 5];

/** Présets plutôt que saisie libre : d ∝ h, c'est la principale source
 *  d'erreur du dispositif. */
export const MOUNT_HEIGHT_M = {
  sol: 0.15,
  barriere: 1.0,
  trepied: 1.4,
};

/** En dessous, le repère se tasse vers l'horizon et devient imprécis. */
export const MIN_USEFUL_HEIGHT_M = 0.8;
