// Copie legere pour la reconnaissance — "upload en deux temps".
//
// ─── LE PROBLEME ─────────────────────────────────────────────────────────
// Une photo pese 1.94 Mo (mesure terrain, cf constants/queue.js). Tant
// qu elle n est pas montee, le coureur n existe pas : pas de match
// Rekognition, pas de galerie, rien. Sur un reseau d event (4G saturee par
// 2000 personnes au meme endroit) la file met des heures a se vider, et le
// coureur qui regarde son telephone au bout de 10 minutes ne voit rien.
//
// ─── LA SOLUTION ─────────────────────────────────────────────────────────
// On decouple deux choses qui n ont aucune raison d aller a la meme vitesse :
//
//   1. ETRE RECONNU   -> demande une image ANALYSABLE. ~300 Ko suffisent.
//   2. AVOIR SA PHOTO -> demande l ORIGINAL. 1.94 Mo, peut attendre.
//
// Le telephone envoie donc d abord une copie legere (ce fichier), puis
// l original plus tard, sur la meme cle R2. Le serveur analyse la premiere
// arrivee et REPORTE le resultat sur la seconde (cf worker : fusion des
// customMetadata au PUT tier=full). Un coureur est donc reconnu ~6x plus
// tot, et si le benevole n a jamais de reseau correct de la journee, tout le
// monde a quand meme sa photo — en qualite reduite plutot que pas du tout.
//
// ─── LA CONTRAINTE QUI TUE ───────────────────────────────────────────────
// La copie legere DOIT rester a 2400 px sur le grand cote. Ce n est pas un
// reglage de confort : mesure terrain Chateau Gaillard 2026-06-28, a 1280 px
// DetectFaces voyait encore les visages mais SearchFacesByImage ne matchait
// PLUS JAMAIS. Le visage d un coureur fait ~4% de la hauteur d image, soit
// ~96 px a 2400 et ~38 px a 1280 — sous le seuil utile d AWS. Et la panne
// est SILENCIEUSE : aucune erreur, juste zero match.
//
// D ou la regle de ce module : on achete la legerete sur la QUALITE JPEG,
// jamais sur la RESOLUTION.
//
// ─── LA REGLE EXACTE : COPIER LE SERVEUR, PAS L INVENTER ────────────────
// Le worker fabrique deja son image d analyse ainsi :
//
//     compressForAnalysis -> IMAGES.transform({ width: 2400, fit: 'scale-down' })
//
// `fit: scale-down` sur la LARGEUR : une image de largeur <= 2400 passe
// intacte, une image plus large est reduite a 2400 de large, la hauteur
// suivant le ratio. C est cette geometrie-la qui est validee sur le terrain.
//
// Ce module reproduit donc la MEME regle — sur la largeur, pas sur le grand
// cote. La nuance n est pas cosmetique : la capture nominale est en PORTRAIT
// 2400x3200. Une regle "grand cote <= 2400" la reduirait a 1800x2400, soit
// 25% de resolution en moins que ce que le serveur analyse aujourd hui —
// une degradation invisible, exactement le mode de panne qu on essaie
// d eviter. (Erreur commise et rattrapee par le test "capture nominale".)

// Largeur maximale de la copie legere. Doit rester EGALE au `width` de
// compressForAnalysis cote worker. Si l un des deux bouge, l autre aussi.
export const LIGHT_MAX_WIDTH = 2400;

// Qualite JPEG de la copie legere. 0.45 sur du 2400x3200 donne ~300 Ko
// (contre 1.94 Mo pour l original HEIC), soit un facteur ~6.
// Reglable a chaud via /config upload.lightQuality — a mesurer sur de vraies
// photos d event AVANT de descendre, la degradation du match ne se voit pas
// dans les logs.
export const LIGHT_QUALITY_DEFAULT = 0.45;

// En dessous de ce gain, la copie legere ne vaut pas le decodage + le
// double aller-retour reseau : on envoie directement l original.
// 2.0 = il faut au minimum diviser le poids par deux.
export const LIGHT_MIN_GAIN = 2.0;

/**
 * Decide comment fabriquer la copie legere a partir des dimensions source.
 *
 * Pure : aucune I/O, testable hors React Native.
 *
 * @param {number} width   largeur source en pixels
 * @param {number} height  hauteur source en pixels
 * @param {object} [opts]
 * @param {number} [opts.maxWidth] largeur max (defaut LIGHT_MAX_WIDTH)
 * @param {number} [opts.quality]  qualite JPEG 0..1
 * @returns {{resize: null | {width: number}, quality: number,
 *            outWidth: number, outHeight: number, reason: string}}
 */
export function lightPlanFor(width, height, opts = {}) {
  const maxW = Number.isFinite(opts.maxWidth) && opts.maxWidth > 0
    ? Math.round(opts.maxWidth)
    : LIGHT_MAX_WIDTH;
  const quality = clamp01(
    Number.isFinite(opts.quality) ? opts.quality : LIGHT_QUALITY_DEFAULT
  );

  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);

  // Dimensions inconnues / absurdes : on ne redimensionne pas. Recompresser
  // sans toucher a la resolution reste sur ; deviner une taille ne l est pas.
  if (w <= 0 || h <= 0) {
    return { resize: null, quality, outWidth: 0, outHeight: 0, reason: 'dims-inconnues' };
  }

  // scale-down : une source deja assez etroite passe INTACTE. Jamais
  // d agrandissement — ca n ajouterait aucune information et ferait grossir
  // le fichier. C est le cas nominal aujourd hui (capture 2400x3200).
  if (w <= maxW) {
    return { resize: null, quality, outWidth: w, outHeight: h, reason: 'deja-sous-la-limite' };
  }

  // Source plus large : on ramene la largeur a la limite, la hauteur suit le
  // ratio (on ne contraint qu une dimension — contrat expo-image-manipulator).
  const outHeight = Math.max(1, Math.round(h * (maxW / w)));
  return {
    resize: { width: maxW },
    quality,
    outWidth: maxW,
    outHeight,
    reason: 'reduit-a-la-limite',
  };
}

/**
 * La copie legere vaut-elle le coup ?
 *
 * Pure. Sert de garde-fou apres generation : si le JPEG produit n est pas
 * nettement plus leger que l original, on jette la copie et on envoie
 * l original directement. Evite le cas absurde ou on ferait deux uploads
 * pour economiser 10%.
 *
 * @param {number} originalBytes
 * @param {number} lightBytes
 * @param {number} [minGain]
 */
export function lightIsWorthIt(originalBytes, lightBytes, minGain = LIGHT_MIN_GAIN) {
  const o = Number(originalBytes);
  const l = Number(lightBytes);
  if (!Number.isFinite(o) || !Number.isFinite(l) || o <= 0 || l <= 0) return false;
  return o / l >= minGain;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return LIGHT_QUALITY_DEFAULT;
  return Math.max(0.05, Math.min(1, v));
}

/**
 * Fabrique la copie legere sur disque.
 *
 * IMPUR — decode l image, ecrit un fichier. L appel a
 * expo-image-manipulator est fait en require() paresseux pour que ce module
 * reste importable hors React Native (les helpers purs ci-dessus sont
 * testes sous node).
 *
 * Le fichier produit atterrit dans le CACHE (contrat saveAsync), pas dans
 * will_pending/. C est voulu : la copie legere vit quelques secondes — elle
 * est fabriquee au moment du drain, envoyee, puis supprimee. La laisser
 * dans le cache signifie qu iOS la recupere tout seul si l app est tuee en
 * plein drain, au lieu qu elle fuie dans le repertoire compte par le
 * garde-fou de stockage.
 *
 * @param {string} srcUri   file:// de l original (processed/{id}.heic)
 * @param {object} [opts]   { minLongEdge, quality }
 * @returns {Promise<{ok: true, uri: string, width: number, height: number}
 *                  | {ok: false, reason: string, error?: string}>}
 *
 * Ne throw jamais : l appelant doit pouvoir se rabattre sur l envoi direct
 * de l original sans try/catch. Une copie legere ratee n est PAS une photo
 * perdue.
 */
export async function makeLightCopy(srcUri, opts = {}) {
  let ImageManipulator;
  let SaveFormat;
  try {
    const mod = require('expo-image-manipulator');
    ImageManipulator = mod.ImageManipulator;
    SaveFormat = mod.SaveFormat;
  } catch (e) {
    return { ok: false, reason: 'module-absent', error: String(e?.message || e) };
  }
  if (!ImageManipulator?.manipulate) {
    return { ok: false, reason: 'api-absente' };
  }

  try {
    // Passe 1 : decodage, uniquement pour connaitre les dimensions. On
    // reutilise la reference native produite pour la passe 2 -> l image
    // n est decodee qu UNE fois.
    const probe = await ImageManipulator.manipulate(srcUri).renderAsync();
    const plan = lightPlanFor(probe.width, probe.height, opts);

    const ctx = ImageManipulator.manipulate(probe);
    if (plan.resize) ctx.resize(plan.resize);
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: plan.quality,
    });

    return {
      ok: true,
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      plan: plan.reason,
    };
  } catch (e) {
    return { ok: false, reason: 'echec-manipulation', error: String(e?.message || e) };
  }
}
