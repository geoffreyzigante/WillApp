// Declenchement par franchissement de lignes.
// Cf. CONCEPTION_LIGNES_NOTE.md (conception validee 2026-07-30, addendum §5).
//
// Module PUR : aucun import, aucune dependance React Native, aucune horloge
// interne. Tout le temps vient du `ts` fourni par le plugin natif. C'est ce qui
// le rend rejouable et testable image par image.
//
// Il ne capture pas : il DECIDE. `ingest()` retourne une liste d'actions
// { type:'fire', delayMs, reason, trackId, creditedIds, lines } que l'appelant
// execute (ou se contente de logger, en mode ombre).
//
// Conventions :
//   - coordonnees normalisees [0,1], origine en haut a gauche (le plugin a
//     deja bascule cy) ;
//   - `ts` en SECONDES, base monotone arbitraire : seules les differences ont
//     un sens. Converti en ms en interne ;
//   - vitesses en largeurs d'image par seconde.

export const LINE_TRIGGER_DEFAULTS = {
  zone: 0.30,                  // camera.captureZoneWidthPercent / 100
  lineOffsets: [-0.45, 0, 0.45], // fraction de la DEMI-zone
  latencyMs: 50,               // avance de tir (obturation + dispatch)
  horizonMs: 250,              // fenetre de programmation
  cooldownMs: 150,             // plancher sequentiel du capteur
  gateFactor: 1.5,             // tolerance d'appariement, en largeurs de visage
  gateFloor: 0.10,             // plancher absolu de tolerance
  gateBootstrapFactor: 3,      // elargissement tant que la vitesse est inconnue
  coastMs: 300,                // survie sans detection
  resurrectMs: 1500,           // F3 — heritage si le mort bougeait
  resurrectStaticMs: 10000,    // F3 — heritage si le mort etait quasi-immobile
  creditMinArea: 0.005,        // seuil de matchabilite Rekognition
  maxPer10s: 24,               // F4 — limiteur global
  staticV: 0.02,               // F5 — seuil de vitesse lissee (largeur/s)
  staticMs: 3000,              // F5 — duree avant bascule STATIQUE
  velAlpha: 0.4,               // EMA de vitesse (prediction / anticipation)
  maxFaces: 8,                 // cap defensif, miroir du worklet
  // ─── Garantie de cadrage ────────────────────────────────────────────────
  // Bande centrale, en fraction de la LARGEUR d image, dans laquelle le
  // visage doit se trouver AU MOMENT OU L OBTURATEUR S OUVRE — pas au moment
  // ou l on decide. 0.5 = les 50 % centraux, soit x dans [0.25, 0.75].
  //
  // Pourquoi c est necessaire alors que les lignes sont deja dans la zone :
  // il existe DEUX voies de tir, et une seule compensait la latence.
  //   - Anticipation (§5) : tire `delai - latence` en avance, la photo
  //     atterrit PILE sur la ligne. Cadrage correct par construction.
  //   - Franchissement detecte (§4) : tire avec delayMs = 0. Le
  //     franchissement est deja passe quand on le voit, et l obturateur
  //     ajoute encore son delai. Le sujet est donc AILLEURS sur la photo,
  //     d autant plus loin qu il va vite. C est cette voie qui produisait
  //     les coureurs collés au bord du cadre.
  //
  // La garde ci-dessous ne corrige pas le tir — on ne peut pas tirer dans le
  // passe — elle le REFUSE quand la photo serait mal cadree. Le coureur
  // gardera les autres lignes, et a defaut le filet F1.
  //
  // 0 desactive la garantie.
  framingBand: 0.5,
};

const EPS = 1e-9;

export function computeLines(zone, offsets) {
  const half = zone / 2;
  return offsets.map((k) => 0.5 + k * half);
}

export function createLineTrigger(userConfig = {}) {
  const cfg = { ...LINE_TRIGGER_DEFAULTS, ...userConfig };
  let lines = computeLines(cfg.zone, cfg.lineOffsets);

  let tracks = [];      // vivants
  let graveyard = [];   // morts recents, pour F3
  let nextId = 1;
  let lastFireT = -Infinity;
  let fireTimes = [];   // horodatages des tirs, pour le limiteur F4

  const halfZone = () => cfg.zone / 2;
  const inZone = (x) => Math.abs(x - 0.5) <= halfZone() + EPS;

  function newTrack(det, t) {
    return {
      id: nextId++,
      x: det.x, y: det.y, w: det.w, h: det.h,
      vx: 0,
      obs: 1,
      firstTs: t,
      lastTs: t,
      lines: new Set(),
      photos: 0,
      hist: [{ t, x: det.x }],   // fenetre glissante pour F5
      isStatic: false,
      matchedThisFrame: true,
    };
  }

  // F5 — « vitesse lissee » mesuree comme l'AMPLITUDE du deplacement sur la
  // fenetre, divisee par sa duree. Choix d'implementation delibere : une EMA
  // brute de la vitesse instantanee ne descend pas sous le bruit de bbox
  // (un jitter de ±0.01 a 10 fps produit ~0.08 largeur/s instantane, dont une
  // EMA a 0.4 laisse encore ~0.04 — au-dessus du seuil de 0.02, la garde ne
  // basculerait jamais). L'amplitude sur 3 s, elle, borne le bruit a sa propre
  // amplitude (~0.02 largeur/s) tout en laissant un coureur reel deux ordres de
  // grandeur au-dessus. C'est l'intention de l'addendum §5 — « moyenner le
  // bruit » — servie par l'estimateur qui le fait reellement.
  // `hist` est deja elague a [t - staticMs - 200, t] : on le parcourt en
  // entier. Le filtrer une seconde fois a exactement staticMs plafonnerait la
  // profondeur a staticMs, et la condition « au moins staticMs d'historique »
  // ne serait jamais satisfaite — la marge de 200 ms existe pour ca.
  function staticMeasure(tr, t) {
    if (tr.hist.length < 2) return null;
    let lo = Infinity, hi = -Infinity;
    const oldest = tr.hist[0].t;
    for (let i = 0; i < tr.hist.length; i++) {
      const x = tr.hist[i].x;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    const span = t - oldest;
    if (span < cfg.staticMs) return null;   // pas assez d'historique
    return (hi - lo) / (span / 1000);
  }

  function pruneHist(tr, t) {
    const from = t - cfg.staticMs - 200;
    while (tr.hist.length > 1 && tr.hist[0].t < from) tr.hist.shift();
  }

  // La fenetre d'appariement du §Q2 suppose que « la prediction absorbe le
  // gros » du deplacement. Sur la PREMIERE association d'un track, la vitesse
  // est encore inconnue : la prediction n'absorbe rien et un sujet rapide
  // (velo, ~0.25 largeur/frame a 10 fps) s'echappe d'une fenetre de 0.12.
  // On l'elargit donc tant qu'aucune vitesse n'est etablie. L'appariement
  // reste au PLUS PROCHE : une fenetre large n'invente pas de mauvais couple,
  // elle evite seulement d'en refuser un bon.
  function gateFor(tr) {
    const base = Math.max(cfg.gateFactor * (tr.w || 0), cfg.gateFloor);
    return tr.obs < 2 ? base * cfg.gateBootstrapFactor : base;
  }

  function predictX(tr, t) {
    return tr.x + tr.vx * ((t - tr.lastTs) / 1000);
  }

  // Le visage sera-t-il dans la bande centrale quand l obturateur s ouvrira ?
  //
  // On extrapole depuis la DERNIERE observation jusqu a l instant reel de la
  // prise : instant de tir + latence d obturateur. C est ce que voit la
  // photo, pas ce que voit le tracker. Un sujet rapide peut parcourir 15 %
  // de la largeur d image entre la decision et l image.
  //
  // Vitesse inconnue (premiere frame) -> vx vaut 0, la prediction se reduit a
  // la position courante : on ne refuse jamais par ignorance.
  function willBeFramed(tr, tFire) {
    const band = cfg.framingBand;
    if (!(band > 0) || band >= 1) return true;      // garantie desactivee
    const x = predictX(tr, tFire + cfg.latencyMs);
    return Math.abs(x - 0.5) <= band / 2 + EPS;
  }

  function area(tr) { return (tr.w || 0) * (tr.h || 0); }

  function limiterAllows(t) {
    const from = t - 10000;
    while (fireTimes.length && fireTimes[0] < from) fireTimes.shift();
    return fireTimes.length < cfg.maxPer10s;
  }

  // Consomme, pour un track credite par une photo, sa ligne non consommee la
  // plus proche : la photo l'a servi, elle doit lui coûter une ligne.
  function consumeNearest(tr, x) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < lines.length; i++) {
      if (tr.lines.has(i)) continue;
      const d = Math.abs(x - lines[i]);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) tr.lines.add(best);
    return best;
  }

  // Une photo crédite TOUS les visages correctement places dedans, pas
  // seulement celui qui a declenche. C'est ce qui empeche 5 coureurs x 3 lignes
  // de produire 15 declenchements.
  function applyCredit(tFire, primary, primaryLines) {
    const credited = [];
    for (const tr of tracks) {
      const px = predictX(tr, tFire);
      if (!inZone(px)) continue;
      if (area(tr) < cfg.creditMinArea) continue;
      if (tr === primary) {
        for (const li of primaryLines) tr.lines.add(li);
      } else {
        consumeNearest(tr, px);
      }
      tr.photos += 1;
      credited.push(tr.id);
    }
    if (!credited.length) {           // primaire hors zone / trop petit (F1)
      for (const li of primaryLines) primary.lines.add(li);
      primary.photos += 1;
      credited.push(primary.id);
    }
    return credited;
  }

  function emitFire(actions, t, delayMs, primary, linesToConsume, reason, bypass) {
    const tFire = t + delayMs;
    if (!bypass) {
      if (tFire - lastFireT < cfg.cooldownMs) return false;
      if (!limiterAllows(t)) return false;
      // Cadrage. Volontairement APRES cooldown et limiteur, et volontairement
      // sous `bypass` : le filet F1 (sortie de zone a zero photo) passe
      // outre. Une photo mal cadree vaut mieux que pas de photo du tout —
      // c est la promesse de base du produit, et elle prime sur celle-ci.
      //
      // On ne consomme PAS la ligne en cas de refus : si le sujet revient
      // dans la bande, elle reste disponible.
      if (!willBeFramed(primary, tFire)) return false;
    }
    const credited = applyCredit(tFire, primary, linesToConsume);
    lastFireT = tFire;
    fireTimes.push(tFire);
    actions.push({
      type: 'fire',
      delayMs: Math.max(0, delayMs),
      reason,
      trackId: primary.id,
      creditedIds: credited,
      lines: linesToConsume.slice(),
      // ─── Matiere premiere de l auto-calibration ────────────────────────
      // Ou le tracker CROIT que le visage sera quand l obturateur s ouvrira,
      // et a quelle vitesse il va. Le scorer local lira plus tard sa position
      // REELLE dans la photo produite : l ecart entre les deux, divise par la
      // vitesse, donne l erreur de latence en secondes.
      // Cf. src/services/latencyCalibrator.js.
      xPredicted: predictX(primary, tFire + cfg.latencyMs),
      vx: primary.vx || 0,
    });
    return true;
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

    const actions = [];

    // ── 1. Appariement glouton sur position PREDITE ────────────────────────
    for (const tr of tracks) tr.matchedThisFrame = false;
    const pairs = [];
    for (let di = 0; di < dets.length; di++) {
      for (let ti = 0; ti < tracks.length; ti++) {
        const tr = tracks[ti];
        const d = Math.abs(dets[di].x - predictX(tr, t));
        if (d <= gateFor(tr)) pairs.push({ di, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const takenD = new Set(), takenT = new Set();
    const matches = new Map();               // ti -> di
    for (const p of pairs) {
      if (takenD.has(p.di) || takenT.has(p.ti)) continue;
      takenD.add(p.di); takenT.add(p.ti);
      matches.set(p.ti, p.di);
    }

    // ── 2. Mise a jour des tracks apparies ─────────────────────────────────
    const crossings = new Map();             // track -> [indices de lignes]
    for (const [ti, di] of matches) {
      const tr = tracks[ti];
      const det = dets[di];
      const dt = (t - tr.lastTs) / 1000;
      const prevX = tr.x;
      if (dt > 0) {
        const inst = (det.x - prevX) / dt;
        tr.vx = tr.vx + cfg.velAlpha * (inst - tr.vx);
      }
      tr.x = det.x; tr.y = det.y; tr.w = det.w; tr.h = det.h;
      tr.lastTs = t;
      tr.obs += 1;
      tr.matchedThisFrame = true;
      tr.hist.push({ t, x: det.x });
      pruneHist(tr, t);

      // F5 : bascule STATIQUE / reactivation. Les lignes deja consommees le
      // restent : se remettre a bouger ne redonne pas de budget.
      const sm = staticMeasure(tr, t);
      if (sm !== null) tr.isStatic = sm < cfg.staticV;

      // Franchissements sur positions BRUTES (aucun lissage) : le lissage
      // retarderait le tir, et un faux franchissement du au bruit est
      // inoffensif puisqu'une ligne ne se consomme qu'une fois.
      const crossed = [];
      for (let i = 0; i < lines.length; i++) {
        if (tr.lines.has(i)) continue;
        const a = prevX - lines[i], b = det.x - lines[i];
        if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) crossed.push(i);
      }
      if (crossed.length) crossings.set(tr, crossed);
    }

    // ── 3. Detections non appariees : resurrection (F3) ou nouveau track ───
    for (let di = 0; di < dets.length; di++) {
      if (takenD.has(di)) continue;
      const det = dets[di];
      let revived = null, bd = Infinity;
      for (const g of graveyard) {
        const window = g.wasStatic ? cfg.resurrectStaticMs : cfg.resurrectMs;
        if (t - g.diedTs > window) continue;
        // Position PREDITE du mort, pas sa derniere position vue : pendant un
        // clignotement le coureur a continue d'avancer. Comparer a la position
        // figee ferait echouer l'heritage des qu'il bouge vite — exactement le
        // cas que F3 doit couvrir (donnee terrain n°1).
        const gx = g.x + (g.vx || 0) * ((t - g.diedTs) / 1000);
        const d = Math.abs(det.x - gx);
        if (d <= Math.max(cfg.gateFactor * (g.w || 0), cfg.gateFloor) && d < bd) {
          bd = d; revived = g;
        }
      }
      const tr = newTrack(det, t);
      if (revived) {
        // Herite des lignes consommees ET du compteur : un clignotement de la
        // detection ne doit pas redonner un budget de 3 (donnee terrain n°1).
        tr.lines = new Set(revived.lines);
        tr.photos = revived.photos;
        tr.isStatic = revived.wasStatic;
        tr.vx = revived.vx || 0;
        tr.obs = 2;
        tr.hist = revived.hist ? revived.hist.slice() : tr.hist;
        tr.hist.push({ t, x: det.x });
        pruneHist(tr, t);
        graveyard = graveyard.filter((g) => g !== revived);
      }
      tracks.push(tr);
    }

    // ── 4. Tirs sur franchissement (F2 : une seule photo par track/frame) ──
    for (const [tr, crossed] of crossings) {
      if (tr.isStatic) { for (const i of crossed) tr.lines.add(i); continue; }
      const reason = crossed.length > 1 ? 'multi-line' : 'line';
      emitFire(actions, t, 0, tr, crossed, reason, false);
    }

    // ── 5. Anticipation : programmer le franchissement a venir ─────────────
    for (const tr of tracks) {
      if (!tr.matchedThisFrame || tr.isStatic) continue;
      if (crossings.has(tr)) continue;
      if (Math.abs(tr.vx) < EPS) continue;
      let bestDelay = Infinity, bestLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (tr.lines.has(i)) continue;
        const dtSec = (lines[i] - tr.x) / tr.vx;
        if (dtSec <= 0) continue;                  // ligne derriere lui
        const ms = dtSec * 1000;
        if (ms > cfg.horizonMs) continue;
        if (ms < bestDelay) { bestDelay = ms; bestLine = i; }
      }
      if (bestLine >= 0) {
        emitFire(actions, t, Math.max(0, bestDelay - cfg.latencyMs), tr, [bestLine], 'line', false);
      }
    }

    // ── 6. F1 — sortie de zone a zero photo. Regle la plus importante. ─────
    // Un track STATIQUE en est exclu : un badaud immobile n'est pas un
    // coureur rate.
    for (const tr of tracks) {
      if (tr.photos > 0 || tr.isStatic) continue;
      if (!inZone(tr.x)) continue;
      const ahead = predictX(tr, t + 150);
      if (!inZone(ahead)) {
        emitFire(actions, t, 0, tr, [], 'exit-zero', true);
      }
    }

    // ── 7. Mort des tracks non revus au-dela du coasting ───────────────────
    const survivors = [];
    for (const tr of tracks) {
      if (t - tr.lastTs <= cfg.coastMs) { survivors.push(tr); continue; }
      // Derniere chance avant de mourir. Bornee dans le temps : tirer
      // longtemps apres la disparition photographierait une autre scene.
      if (tr.photos === 0 && !tr.isStatic && t - tr.lastTs <= cfg.coastMs * 2) {
        emitFire(actions, t, 0, tr, [], 'exit-zero', true);
      }
      graveyard.push({
        x: tr.x, w: tr.w, vx: tr.vx, diedTs: tr.lastTs,
        lines: new Set(tr.lines), photos: tr.photos,
        wasStatic: tr.isStatic, hist: tr.hist.slice(),
      });
    }
    tracks = survivors;

    const gvFrom = t - Math.max(cfg.resurrectMs, cfg.resurrectStaticMs);
    graveyard = graveyard.filter((g) => g.diedTs >= gvFrom);

    return actions;
  }

  function reset() {
    tracks = []; graveyard = []; nextId = 1;
    lastFireT = -Infinity; fireTimes = [];
  }

  function setZone(zone) {
    cfg.zone = zone;
    lines = computeLines(cfg.zone, cfg.lineOffsets);
  }

  function snapshot() {
    return tracks.map((tr) => ({
      id: tr.id, x: tr.x, vx: tr.vx, photos: tr.photos,
      lines: [...tr.lines], isStatic: tr.isStatic,
    }));
  }

  return { ingest, reset, setZone, snapshot, getLines: () => lines.slice() };
}
