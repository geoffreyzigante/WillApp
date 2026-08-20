// Auto-calibration de la latence de capture.
//
// ─── LE PROBLEME ─────────────────────────────────────────────────────────
// Le tracker tire EN AVANCE d une latence supposee, pour que le coureur soit
// au bon endroit quand l obturateur s ouvre vraiment. Si cette latence est
// fausse, le cadrage l est aussi — et rien ne le signale.
//
// Jusqu ici elle etait devinee : `rt / 3`, ou rt est l aller-retour mesure de
// takePhoto(). Le tiers n a jamais ete mesure, il a ete choisi. J avais deja
// produit un « 345 ms » coherent et faux par ce genre de raisonnement.
//
// ─── LA MESURE ───────────────────────────────────────────────────────────
// On a tout ce qu il faut, des deux cotes :
//
//   au tir     le tracker sait ou il PREDIT le visage a l instant de la photo
//              (xPredicted) et a quelle vitesse il va (vx, largeurs/s) ;
//   apres      le scorer local lit la position REELLE du visage dans la photo
//              produite (biggestFaceCenter).
//
// L ecart entre les deux ne peut venir que d une erreur de latence :
//
//       erreur_secondes = (x_reel - x_predit) / vx
//
// Positif = la photo est arrivee APRES le moment vise, donc la latence reelle
// est plus grande que celle supposee. On corrige dans ce sens.
//
// ─── POURQUOI PAS UNE CONSTANTE ─────────────────────────────────────────
// La latence depend de l appareil (un iPhone 12 et un 15 Pro n ont pas le
// meme obturateur), de la lumiere (temps de pose), de la chaleur et de la
// charge. Une valeur figee dans /config serait juste une autre supposition,
// et elle serait fausse pour tout le parc Android le jour ou il arrive.

// Vitesse minimale exploitable, en largeurs d image par seconde. Sous ce
// seuil, diviser par vx amplifie le bruit de detection au point de rendre la
// mesure absurde : un visage quasi immobile donne un ecart de position qui ne
// dit RIEN sur le temps.
export const VX_MIN = 0.15;

// Au-dela, l echantillon est jete. Une erreur d une demi-seconde ne peut pas
// venir de l obturateur : c est un mauvais appariement de visage, un autre
// coureur mesure a la place du bon, ou un axe inverse entre le detecteur et
// la photo. Ce plafond est la seule protection contre une inversion d axe
// silencieuse — sans lui, la calibration divergerait sans rien dire.
export const ERREUR_MAX_MS = 400;

// Bornes de la latence servie au tracker. Identiques a celles qui encadraient
// le `rt / 3` d avant, pour qu une regression eventuelle reste dans le meme
// domaine qu aujourd hui.
export const LATENCE_MIN_MS = 30;
export const LATENCE_MAX_MS = 250;

// Nombre d echantillons avant d oser corriger. En dessous, on garde la valeur
// de depart : trois passages suffisent a eliminer un coup de malchance, et
// c est atteint dans la premiere minute d une course.
export const ECHANTILLONS_MIN = 5;

// Deplacement maximal par mise a jour. La latence ne saute pas de 30 a 250 ms
// d un coup dans la vraie vie ; un tel saut viendrait d une serie de mauvais
// echantillons. L amortissement laisse le temps a la mediane de se remplir.
export const PAS_MAX_MS = 25;

/**
 * Erreur de latence deduite d une photo, en millisecondes.
 *
 * Pure. Retourne null si l echantillon n est pas exploitable — l appelant
 * doit alors simplement l ignorer, jamais le remplacer par zero (ce qui
 * tirerait la mediane vers « pas d erreur » et figerait la calibration).
 *
 * @param {number} xPredit  position predite au moment de la photo, [0,1]
 * @param {number} xReel    position mesuree dans la photo, [0,1]
 * @param {number} vx       vitesse au moment du tir, largeurs/s
 * @returns {number|null}   erreur en ms, positive si la photo est en retard
 */
export function erreurLatenceMs(xPredit, xReel, vx) {
  const p = Number(xPredit);
  const r = Number(xReel);
  const v = Number(vx);
  if (!Number.isFinite(p) || !Number.isFinite(r) || !Number.isFinite(v)) return null;
  if (p < 0 || p > 1 || r < 0 || r > 1) return null;
  if (Math.abs(v) < VX_MIN) return null;

  const ms = ((r - p) / v) * 1000;
  if (!Number.isFinite(ms)) return null;
  if (Math.abs(ms) > ERREUR_MAX_MS) return null;
  return ms;
}

/**
 * Nouvelle latence a servir au tracker.
 *
 * Pure. `null` signifie « ne change rien » : pas assez d echantillons, ou
 * correction negligeable. L appelant garde alors la valeur courante.
 *
 * @param {number} courante      latence actuellement utilisee (ms)
 * @param {number|null} erreur   mediane des erreurs observees (ms)
 * @param {number} n             nombre d echantillons derriere cette mediane
 * @param {object} [opts]
 * @returns {number|null}
 */
export function prochaineLatence(courante, erreur, n, opts = {}) {
  const min = opts.minMs ?? LATENCE_MIN_MS;
  const max = opts.maxMs ?? LATENCE_MAX_MS;
  const seuilN = opts.echantillonsMin ?? ECHANTILLONS_MIN;
  const pas = opts.pasMaxMs ?? PAS_MAX_MS;

  if (!Number.isFinite(n) || n < seuilN) return null;
  if (erreur === null || !Number.isFinite(erreur)) return null;

  const base = Number.isFinite(courante) ? courante : (min + max) / 2;

  // Amortissement : on avance vers la cible, on n y saute pas.
  const delta = Math.max(-pas, Math.min(pas, erreur));
  const brute = base + delta;
  const bornee = Math.max(min, Math.min(max, brute));

  // Sous la milliseconde, recreer le tracker ne vaut pas le changement : la
  // recreation jette l etat des tracks en cours.
  if (Math.abs(bornee - base) < 1) return null;
  return Math.round(bornee);
}

/**
 * Accumulateur d echantillons, mediane glissante.
 *
 * Mediane et non moyenne : un seul mauvais appariement de visage suffirait a
 * decaler une moyenne de plusieurs dizaines de millisecondes, alors qu il ne
 * deplace une mediane que d un rang.
 *
 * ─── POURQUOI ON VIDE APRES CHAQUE CORRECTION ──────────────────────────
 * Un echantillon ne mesure pas la latence : il mesure l ERREUR de la latence
 * en vigueur au moment ou la photo a ete prise. Des qu on corrige, tous les
 * echantillons deja en memoire parlent d un reglage qui n existe plus.
 *
 * Les garder produit un emballement classique : la mediane, en retard, pousse
 * la correction au-dela de la cible ; les nouveaux echantillons deviennent
 * negatifs mais restent minoritaires ; la latence continue de monter, puis
 * repart en sens inverse avec le meme exces. La premiere version de ce module
 * partait ainsi de 50 ms, visait 170, et finissait collee au plancher de 30 —
 * en s eloignant a chaque tour. Le test de bout en bout l a attrape.
 *
 * D ou `proposerLatence()`, qui vide la fenetre quand il rend une valeur :
 * chaque correction repart d une mesure propre.
 */
export function creerCalibrateur(taille = 11) {
  const n = Math.max(3, Math.floor(taille));
  const buf = [];

  const mediane = () => {
    if (buf.length === 0) return null;
    const t = buf.slice().sort((a, b) => a - b);
    const m = t.length >> 1;
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
  };

  return {
    /** @returns {boolean} true si l echantillon a ete retenu */
    ajouter(xPredit, xReel, vx) {
      const e = erreurLatenceMs(xPredit, xReel, vx);
      if (e === null) return false;
      buf.push(e);
      if (buf.length > n) buf.shift();
      return true;
    },
    taille() { return buf.length; },
    mediane,

    /**
     * Latence a servir maintenant, ou null si rien ne bouge.
     * Vide la fenetre des qu une correction est rendue.
     */
    proposerLatence(courante, opts) {
      const suivante = prochaineLatence(courante, mediane(), buf.length, opts);
      if (suivante !== null) buf.length = 0;
      return suivante;
    },

    reinitialiser() { buf.length = 0; },
  };
}
