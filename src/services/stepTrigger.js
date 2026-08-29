// Declenchement au PAS DE DISTANCE.
//
// Une seule regle : trois reperes fixes, repartis dans les 50 % centraux du
// cadre. Un visage franchit un repere, une photo part.
//
// Pourquoi une distance et pas un intervalle de temps : une cadence fixe
// donne 5 photos a un marcheur et 1 a un cycliste. Des reperes exprimes en
// fraction de cadre donnent 3 photos aux deux, sans rien connaitre de leur
// vitesse. C est la seule grandeur qui reste vraie de la marche au velo.
//
// Pourquoi la bande centrale : une photo ou le coureur est colle au bord
// n interesse personne. En faisant du cadrage une CONDITION DE TIR plutot
// qu un critere de tri, on ne prend jamais la mauvaise photo — au lieu de la
// prendre puis de la jeter. Tout le filtre de cadrage aval devient inutile.
//
// Pourquoi des reperes FIXES et pas une distance relative au dernier tir :
// une regle relative accumule l erreur d echantillonnage. A 10 images par
// seconde et 0,79 largeur/s, le premier tir tombe deja 0,07 trop tard, le
// deuxieme 0,14, et le troisieme sort de la bande — trois photos deviennent
// deux, exactement a la vitesse de course. Des reperes absolus n ont pas de
// phase a accumuler : le compte est le meme a toutes les vitesses.
//
// Module PUR, sur le modele de lineTrigger.js : aucun import, aucune horloge
// interne, tout le temps vient du `ts` fourni par le natif. C est ce qui le
// rend rejouable et testable image par image.
//
// Il ne capture pas : il DECIDE. `ingest()` retourne une liste d actions
// { type:'fire', reason, trackId, creditedIds, x } que l appelant execute.
//
// Conventions, identiques a lineTrigger :
//   - coordonnees normalisees [0,1], origine en haut a gauche ;
//   - `ts` en SECONDES, base monotone arbitraire ;
//   - format d entree plat [ts, n, cx,cy,w,h, ...].

export const STEP_TRIGGER_DEFAULTS = {
  // Fraction CENTRALE de la largeur ou le tir est autorise. 0.5 = x dans
  // [0.25, 0.75]. Mettre 1 revient a autoriser tout le cadre.
  band: 0.50,
  // Nombre de reperes, donc de photos, par passage. Les reperes sont
  // repartis regulierement DANS la bande, sans toucher ses bords.
  photosParPassage: 3,
  // Plancher sequentiel du capteur. Une capture pleine resolution demande
  // 150 a 200 ms ; tirer plus vite ne produirait que des echecs. C est aussi
  // ce qui borne le debit sur un peloton dense.
  cooldownMs: 180,
  // Aire minimale pour etre credite. Sous ce seuil le visage est trop petit
  // pour que Rekognition le rattache : le crediter lui consommerait un
  // repere sur une photo ou il n est pas exploitable.
  //
  // Abaisse de 0.005 a 0.001 le 2026-08-29. Les aires mesurees au terrain
  // valent 0.0012 a 0.0070 : l ancien seuil, herite de lineTrigger, excluait
  // donc la majorite des visages a la distance de tir reelle. En peloton,
  // personne n aurait ete credite et chacun aurait declenche ses propres
  // photos. 0.001 correspond a un visage de ~95 px de large sur la photo
  // livree, largement au-dessus de ce que Rekognition sait rattacher.
  //
  // Abaisse a 0.0003 le 2026-08-30 pour couvrir les 6 m : a cette distance
  // l aire tombe vers 0.0007, et le seuil precedent excluait donc les
  // coureurs les plus eloignes du partage.
  creditMinArea: 0.0003,
  // Appariement d une image a l autre, en largeurs de visage.
  gateFactor: 1.5,
  gateFloor: 0.10,
  // Survie d un track sans detection. Au-dela il est oublie, et le visage
  // qui reapparait repart avec un budget neuf.
  //
  // Porte de 400 a 800 ms le 2026-08-30. Constat terrain : a 6 m la detection
  // devient intermittente — un visage n est vu qu une image sur deux ou trois
  // — et 400 ms tuaient le track entre deux apparitions. Le coureur repartait
  // alors avec un budget neuf a chaque trou, et ne franchissait jamais trois
  // reperes d affilee. C est ce qui faisait decrocher le mode a distance.
  coastMs: 800,
  // Lissage de vitesse, utilise seulement pour predire la position lors de
  // l appariement — jamais pour decider d un tir.
  velAlpha: 0.4,
  // Cap defensif, miroir du worklet.
  maxFaces: 8,
  // ── Limiteur global ─────────────────────────────────────────────────────
  // Plafond glissant, toutes personnes confondues. Sans lui, un flux continu
  // sature : le worklet ne remonte que les `maxFaces` plus grands visages, et
  // sur un peloton de vingt a cinquante coureurs a distance comparable, le
  // sous-ensemble retenu bouge d une image a l autre. Des tracks naissent et
  // meurent en permanence, chacun avec ses trois reperes intacts, et le
  // declencheur tire au rythme du cooldown — une photo toutes les 180 ms tant
  // que le flux dure, soit 5,5 par seconde pilotees par le capteur et non par
  // les coureurs.
  //
  // 30 par 10 s = 3 par seconde. Sur un flux d un coureur par seconde, cela
  // fait exactement 3 photos par coureur ; au-dela, la degradation est douce
  // et bornee au lieu d etre une saturation.
  //
  // Le meme garde-fou existe dans lineTrigger.js (maxPer10s: 24). Il aurait
  // du etre repris ici des le depart.
  maxPer10s: 30,
  // Nombre d observations minimum avant qu un visage apparu DEJA dans la
  // bande puisse declencher. A une seule observation on ne sait pas encore
  // s il s agit d un vrai coureur ou d un visage qui entre et sort du
  // classement des plus grands. Les tirs par franchissement ne sont pas
  // concernes : ils exigent deja une position precedente, donc deux images.
  minObsPourApparition: 2,
  // Aire en dessous de laquelle on n exige plus la confirmation ci-dessus.
  // Un visage lointain clignote : lui demander deux observations consecutives
  // revient a ne jamais le declencher. Le risque de faux positif reste borne
  // par le limiteur global et par la bande centrale.
  aireApparitionDirecte: 0.0015,
};

export function createStepTrigger(options = {}) {
  const cfg = { ...STEP_TRIGGER_DEFAULTS, ...(options || {}) };

  const bande = Math.max(0.05, Math.min(1, cfg.band));
  const bornes = { min: 0.5 - bande / 2, max: 0.5 + bande / 2 };
  const nb = Math.max(1, cfg.photosParPassage | 0);

  // Reperes au centre de chaque tranche de bande : pour 3 dans [0.25, 0.75],
  // cela donne 0.333, 0.500, 0.667. Aucun ne touche le bord, donc aucun tir
  // ne peut atterrir hors de la bande a cause d un arrondi.
  const reperes = [];
  for (let i = 0; i < nb; i++) {
    reperes.push(bornes.min + (bande * (i + 0.5)) / nb);
  }

  let tracks = [];
  let nextId = 1;
  let lastFireTs = -Infinity;
  // Horodatages des tirs recents, pour le limiteur glissant. Elague a chaque
  // consultation : contrairement a lineTrigger, aucun chemin ne contourne le
  // limiteur, donc le tableau ne peut pas croitre sans borne.
  let fireTimes = [];

  const dansLaBande = (x) => x >= bornes.min && x <= bornes.max;

  function predictX(tr, t) {
    return tr.x + (tr.vx || 0) * ((t - tr.lastTs) / 1000);
  }

  function gateFor(tr) {
    return Math.max(cfg.gateFactor * (tr.w || 0), cfg.gateFloor);
  }

  // Indices des reperes franchis entre prevX et x, non encore consommes.
  // Les deux sens sont traites : un parcours peut etre filme dans un sens
  // comme dans l autre, et rien dans le module ne suppose une direction.
  function franchis(tr, prevX, x) {
    const out = [];
    for (let i = 0; i < reperes.length; i++) {
      if (tr.consumed.has(i)) continue;
      const a = prevX - reperes[i];
      const b = x - reperes[i];
      if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) out.push(i);
    }
    return out;
  }

  function repereLePlusProche(x) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < reperes.length; i++) {
      const d = Math.abs(x - reperes[i]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function ingest(flat) {
    if (!flat || flat.length < 2) return [];
    const ts = flat[0];
    if (!isFinite(ts) || ts <= 0) return [];
    const t = ts * 1000;
    const n = Math.max(0, Math.min(cfg.maxFaces, flat[1] | 0));

    const dets = [];
    for (let i = 0; i < n; i++) {
      const o = 2 + i * 4;
      const x = flat[o], y = flat[o + 1], w = flat[o + 2], h = flat[o + 3];
      if (!isFinite(x) || !isFinite(y)) continue;
      dets.push({ x, y, w: isFinite(w) ? w : 0, h: isFinite(h) ? h : 0 });
    }

    // ── 0. Oubli des tracks perdus, AVANT tout appariement ─────────────────
    // Ordre critique : elaguer apres l appariement ne sert a rien, puisqu un
    // track mort depuis longtemps se fait quand meme apparier a un visage qui
    // reapparait au meme endroit — il ressusciterait avec son budget epuise.
    tracks = tracks.filter(tr => t - tr.lastTs <= cfg.coastMs);

    // ── 1. Appariement glouton sur position predite ────────────────────────
    const pairs = [];
    for (let di = 0; di < dets.length; di++) {
      for (let ti = 0; ti < tracks.length; ti++) {
        const d = Math.abs(dets[di].x - predictX(tracks[ti], t));
        if (d <= gateFor(tracks[ti])) pairs.push({ di, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const prisD = new Set(), prisT = new Set();
    const candidats = [];

    for (const p of pairs) {
      if (prisD.has(p.di) || prisT.has(p.ti)) continue;
      prisD.add(p.di); prisT.add(p.ti);
      const tr = tracks[p.ti];
      const det = dets[p.di];
      const prevX = tr.x;
      const dt = (t - tr.lastTs) / 1000;
      if (dt > 0) {
        const inst = (det.x - prevX) / dt;
        tr.vx = tr.vx + cfg.velAlpha * (inst - tr.vx);
      }
      tr.x = det.x; tr.y = det.y; tr.w = det.w; tr.h = det.h;
      tr.lastTs = t;
      tr.obs += 1;

      const cr = franchis(tr, prevX, det.x);
      if (cr.length) {
        candidats.push({ tr, indices: cr, reason: 'repere-franchi' });
      } else if (
        (tr.obs === cfg.minObsPourApparition
          || (tr.obs === 1 && (det.w || 0) * (det.h || 0) < cfg.aireApparitionDirecte))
        && tr.consumed.size === 0
        && dansLaBande(det.x)
      ) {
        // Visage repere tard — contre-jour, sortie de virage — deja dans la
        // bande a sa premiere detection. Sans ce cas il ne declencherait que
        // s il lui reste un repere devant lui, et jamais s il est apparu
        // apres le dernier.
        candidats.push({ tr, indices: [repereLePlusProche(det.x)], reason: 'apparu-dans-bande' });
      }
    }

    // ── 2. Detections non appariees : nouveaux tracks ──────────────────────
    // Un visage detecte pour la premiere fois DEJA dans la bande n a franchi
    // aucun repere — il est apparu au milieu. Sans ce cas, un coureur reperé
    // tard (contre-jour, sortie de virage) ne declencherait jamais.
    for (let di = 0; di < dets.length; di++) {
      if (prisD.has(di)) continue;
      const det = dets[di];
      const tr = {
        id: nextId++,
        x: det.x, y: det.y, w: det.w, h: det.h,
        vx: 0, lastTs: t, obs: 1,
        consumed: new Set(),
      };
      tracks.push(tr);
      // Volontairement PAS candidat des la premiere image : voir
      // minObsPourApparition. Il le deviendra a la suivante s il est toujours
      // la, ou declenchera normalement par franchissement.
      void dansLaBande;
    }

    // ── 3. Decision ───────────────────────────────────────────────────────
    // Un seul tir par image, quel que soit le nombre de visages : UNE photo
    // sert tous ceux qu elle contient. C est ce qui empeche un peloton de
    // couter vingt fois un coureur isole.
    if (candidats.length === 0) return [];
    if (t - lastFireTs < cfg.cooldownMs) return [];

    // Limiteur glissant sur 10 s.
    while (fireTimes.length && t - fireTimes[0] > 10000) fireTimes.shift();
    if (fireTimes.length >= cfg.maxPer10s) return [];

    // Le declencheur nomme est celui dont le visage est le plus grand : c est
    // le plus proche, donc celui pour qui la photo sera la plus exploitable.
    let choisi = candidats[0];
    for (const c of candidats) {
      if ((c.tr.w || 0) * (c.tr.h || 0) > (choisi.tr.w || 0) * (choisi.tr.h || 0)) choisi = c;
    }

    // Credit partage. Tous les visages presents DANS LA BANDE et assez grands
    // consomment le meme repere que le declencheur. Ceux qui sont hors bande
    // ne sont pas credites : sur cette photo ils sont au bord, la leur
    // compter serait leur voler un tir.
    //
    // Comme il n existe que `nb` reperes, un groupe qui traverse ensemble ne
    // peut pas produire plus de `nb` photos, quel que soit son effectif.
    const idx = choisi.indices[0];
    const credites = [];
    for (const tr of tracks) {
      if (!dansLaBande(tr.x)) continue;
      const aire = (tr.w || 0) * (tr.h || 0);
      if (aire < cfg.creditMinArea && tr !== choisi.tr) continue;
      for (const i of (tr === choisi.tr ? choisi.indices : [idx])) tr.consumed.add(i);
      credites.push(tr.id);
    }

    lastFireTs = t;
    fireTimes.push(t);
    return [{
      type: 'fire',
      reason: choisi.reason,
      trackId: choisi.tr.id,
      creditedIds: credites,
      repere: idx,
      x: choisi.tr.x,
    }];
  }

  function reset() {
    tracks = [];
    lastFireTs = -Infinity;
    fireTimes = [];
  }

  function debugState() {
    return {
      reperes: reperes.slice(),
      bornes,
      tracks: tracks.map(tr => ({ id: tr.id, x: tr.x, obs: tr.obs, consumed: [...tr.consumed] })),
      tirsDansLaFenetre: fireTimes.length,
    };
  }

  return { ingest, reset, debugState };
}
