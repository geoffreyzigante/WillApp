// Tests du declenchement au pas de distance.
//
// Meme esprit que test_quality_failsafes.mjs : on teste des INVARIANTS
// metier, pas des details d implementation. Rejouables image par image,
// puisque le module est pur et que tout le temps vient du `ts` fourni.
//
// Lancer :  npm run test:step

import { createStepTrigger } from '../src/services/stepTrigger.js';

let ko = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { console.log(`  ✗ ${label}`); ko++; }
}

// Simule une traversee : le visage entre par la droite (x = 1) et sort a
// gauche (x = 0), a `vitesse` largeurs d image par seconde, echantillonne a
// `fps` images par seconde. Retourne le nombre de tirs et leurs positions.
function traversee(trig, { vitesse, fps = 10, t0 = 100, aire = 0.03 }) {
  const dt = 1 / fps;
  const tirs = [];
  let t = t0;
  for (let x = 1.0; x >= 0; x -= vitesse * dt) {
    const w = Math.sqrt(aire), h = Math.sqrt(aire);
    const actions = trig.ingest([t, 1, x, 0.5, w, h]);
    for (const a of actions) tirs.push(Number(a.x.toFixed(3)));
    t += dt;
  }
  return tirs;
}

console.log('\n[TEST 1] Le compte de 3 ne depend pas de la vitesse');
{
  // 4 m de distance -> cadre ~4,2 m. Les vitesses sont converties en
  // largeurs d image par seconde : marche 1,4/4,2 = 0,33 ; course 3,3/4,2
  // = 0,79 ; velo a 10 m (cadre 10 m) 8,3/10 = 0,83.
  for (const [nom, v] of [['marche', 0.33], ['course', 0.79], ['velo a 10 m', 0.83]]) {
    const trig = createStepTrigger();
    const tirs = traversee(trig, { vitesse: v });
    assert(tirs.length === 3, `${nom} (${v} largeur/s) -> 3 photos [got ${tirs.length}: ${tirs.join(', ')}]`);
  }
}

console.log('\n[TEST 2] Toutes les photos sont dans les 50 % centraux');
{
  for (const v of [0.2, 0.5, 0.79, 1.2]) {
    const trig = createStepTrigger();
    const tirs = traversee(trig, { vitesse: v });
    const hors = tirs.filter(x => x < 0.25 || x > 0.75);
    assert(hors.length === 0, `v=${v} -> aucune photo hors bande [positions ${tirs.join(', ')}]`);
  }
}

console.log('\n[TEST 3] Un peloton coute moins cher qu un coureur isole');
{
  const solo = createStepTrigger();
  const tirsSolo = traversee(solo, { vitesse: 0.79 });

  // 5 visages groupes, meme vitesse, decales de 0,06 largeur.
  const trig = createStepTrigger();
  const dt = 0.1, v = 0.79;
  let t = 100, tirs = 0;
  for (let x = 1.15; x >= -0.3; x -= v * dt) {
    const flat = [t, 5];
    for (let i = 0; i < 5; i++) flat.push(x - i * 0.06, 0.5, 0.17, 0.17);
    tirs += trig.ingest(flat).length;
    t += dt;
  }
  assert(tirsSolo.length === 3, `solo -> 3 photos (got ${tirsSolo.length})`);
  assert(tirs <= 6, `peloton de 5 -> au plus 6 photos pour 5 coureurs (got ${tirs})`);
  assert(tirs / 5 < tirsSolo.length, `peloton moins cher par tete (${(tirs / 5).toFixed(1)} vs 3,0)`);
}

console.log('\n[TEST 4] Le credit partage ne vole personne : hors bande, pas credite');
{
  const trig = createStepTrigger();
  // A est dans la bande, B est colle au bord droit (hors bande).
  // Deux images : un visage apparu dans la bande attend une confirmation
  // avant de pouvoir declencher (cf. minObsPourApparition).
  trig.ingest([100.0, 2, 0.70, 0.5, 0.17, 0.17, 0.95, 0.5, 0.17, 0.17]);
  trig.ingest([100.1, 2, 0.70, 0.5, 0.17, 0.17, 0.95, 0.5, 0.17, 0.17]);
  const st = trig.debugState();
  const dansBande = st.tracks.find(tr => Math.abs(tr.x - 0.70) < 0.01);
  const horsBande = st.tracks.find(tr => Math.abs(tr.x - 0.95) < 0.01);
  assert(dansBande && dansBande.consumed.length === 1, 'le visage dans la bande consomme un repere');
  assert(horsBande && horsBande.consumed.length === 0, 'le visage hors bande garde son budget intact');
}

console.log('\n[TEST 5] Un visage immobile ne mitraille pas');
{
  const trig = createStepTrigger();
  let t = 100, tirs = 0;
  // Une affiche au centre du cadre pendant 10 secondes.
  for (let i = 0; i < 100; i++) {
    tirs += trig.ingest([t, 1, 0.5, 0.5, 0.17, 0.17]).length;
    t += 0.1;
  }
  assert(tirs === 1, `scene immobile -> 1 seule photo en 10 s (got ${tirs})`);
}

console.log('\n[TEST 6] Le plancher du capteur est respecte');
{
  const trig = createStepTrigger({ cooldownMs: 180 });
  // Coureur rapide echantillonne a 30 fps : les tirs se bousculeraient si
  // rien ne les espacait.
  const tirs = [];
  let t = 100;
  for (let x = 1.0; x >= 0; x -= 0.8 / 30) {
    const actions = trig.ingest([t, 1, x, 0.5, 0.17, 0.17]);
    for (const a of actions) tirs.push(t);
    t += 1 / 30;
  }
  assert(tirs.length >= 2, `au moins 2 tirs pour que le test ait un sens (got ${tirs.length})`);
  let okEcart = true;
  for (let i = 1; i < tirs.length; i++) {
    if ((tirs[i] - tirs[i - 1]) * 1000 < 179) okEcart = false;
  }
  assert(okEcart, `jamais deux photos a moins de 180 ms (${tirs.length} tirs)`);
}

console.log('\n[TEST 7] Un visage perdu puis retrouve repart avec un budget neuf');
{
  const trig = createStepTrigger();
  trig.ingest([100.0, 1, 0.70, 0.5, 0.17, 0.17]);
  trig.ingest([100.1, 1, 0.70, 0.5, 0.17, 0.17]);   // photo 1
  // Disparition de 2 s, franchement au-dela de coastMs (1600 ms) : la piste
  // est morte, celui qui revient est quelqu un d autre.
  trig.ingest([102.2, 1, 0.70, 0.5, 0.17, 0.17]);
  const actions = trig.ingest([102.3, 1, 0.70, 0.5, 0.17, 0.17]);
  assert(actions.length === 1, 'le visage retrouve declenche a nouveau');
}

console.log('\n[TEST 7bis] Un clignotement DANS coastMs ne cree pas un second coureur');
{
  // C est la raison d etre de coastMs, et ce que le passage a 1600 ms achete :
  // a 6-8 m la detection clignote, un trou d une seconde est un trou de
  // DETECTION, pas un depart. Si la piste mourait la, le meme coureur
  // repartirait avec trois photos neuves a chaque clignotement.
  const trig = createStepTrigger();
  trig.ingest([200.0, 1, 0.70, 0.5, 0.17, 0.17]);
  trig.ingest([200.1, 1, 0.70, 0.5, 0.17, 0.17]);   // photo 1 (repere 0.667)
  // Trou d 1 s, sous coastMs. Retour a une position COHERENTE avec la
  // trajectoire — un vrai coureur a continue d avancer pendant le trou.
  trig.ingest([201.1, 1, 0.69, 0.5, 0.17, 0.17]);
  const actions = trig.ingest([201.2, 1, 0.69, 0.5, 0.17, 0.17]);
  assert(actions.length === 0, `clignotement -> aucun tir en double (got ${actions.length})`);
}

console.log('\n[TEST 8] Un visage LOINTAIN qui naît dans la bande tire des la 1re image');
{
  // Le cas qui coutait le premier repere sur le terrain. Un coureur detecte
  // pour la premiere fois deja dans la bande, avec un petit visage : sa
  // deuxieme detection arrivera trop tard pour que le premier repere soit
  // encore devant lui.
  const trig = createStepTrigger();
  const actions = trig.ingest([100.0, 1, 0.66, 0.5, 0.018, 0.024]); // aire 0.00043
  assert(actions.length === 1, `tir des la premiere detection (got ${actions.length})`);
  assert(actions[0]?.reason === 'apparu-loin', `raison apparu-loin (got ${actions[0]?.reason})`);
  assert(actions[0]?.repere === 2, `repere le plus proche de 0.66 = index 2 (got ${actions[0]?.repere})`);
}

console.log('\n[TEST 8bis] Un visage PROCHE garde la double confirmation');
{
  // La prudence reste justifiee de pres : la deuxieme detection arrive a
  // l image suivante, et un faux positif y est bien plus probable (visage
  // sur un dossard, spectateur au bord).
  const trig = createStepTrigger();
  const a1 = trig.ingest([200.0, 1, 0.66, 0.5, 0.17, 0.17]); // aire 0.0289
  assert(a1.length === 0, `pas de tir a la premiere image (got ${a1.length})`);
  const a2 = trig.ingest([200.1, 1, 0.66, 0.5, 0.17, 0.17]);
  assert(a2.length === 1, `tir a la deuxieme (got ${a2.length})`);
}

console.log('\n[TEST 8ter] Naître HORS bande ne consomme rien');
{
  // Hors bande il n y a pas de repere a consommer : le coureur entrera par
  // franchissement, chemin nominal. Sinon on lui volerait un tir au bord.
  const trig = createStepTrigger();
  const actions = trig.ingest([300.0, 1, 0.92, 0.5, 0.018, 0.024]);
  assert(actions.length === 0, `aucun tir hors bande (got ${actions.length})`);
}

console.log('\n[TEST 4bis] Coureurs de front : 3 photos pour tout le monde');
{
  // Le seul cas ou le credit partage joue a PLEIN est le groupe assez etroit
  // pour que tous soient dans la bande a chacun des trois tirs. Cela demande
  // un etalement inferieur a ~0,08 de largeur — soit des coureurs cote a
  // cote, ce qui est exactement le cas d une ligne de front sur route.
  const trig = createStepTrigger();
  const dt = 0.1, v = 0.5;
  let t = 100, tirs = 0;
  for (let x = 1.3; x >= -0.4; x -= v * dt) {
    const flat = [t, 4];
    for (let i = 0; i < 4; i++) flat.push(x - i * 0.02, 0.5, 0.17, 0.17);
    tirs += trig.ingest(flat).length;
    t += dt;
  }
  assert(tirs <= 3, `4 coureurs de front -> au plus 3 photos (got ${tirs})`);
}

console.log('\n[TEST 4ter] Un flux etale coute plus de photos — et c est voulu');
{
  // 8 coureurs etales sur 0,56 de largeur : plus large que la bande, donc
  // les derniers y entrent quand les premiers en sont sortis. Leur imposer
  // le plafond de 3 priverait ceux de derriere de toute photo. Le bon
  // invariant n est pas "3 par groupe" mais "peu de photos PAR COUREUR".
  const trig = createStepTrigger();
  const dt = 0.1, v = 0.5;
  let t = 100, tirs = 0;
  for (let x = 1.4; x >= -0.6; x -= v * dt) {
    const flat = [t, 8];
    for (let i = 0; i < 8; i++) flat.push(x - i * 0.07, 0.5, 0.17, 0.17);
    tirs += trig.ingest(flat).length;
    t += dt;
  }
  assert(tirs / 8 < 1.5, `flux de 8 -> moins de 1,5 photo par coureur (got ${(tirs / 8).toFixed(2)})`);
  assert(tirs / 8 < 3, 'toujours moins cher par tete qu un coureur isole');
}

console.log('\n[TEST 9] Flux continu de 50 coureurs : le volume reste borne');
{
  // Le cas reel annonce : pelotons de 20 a 50, sans un instant de creux. Le
  // worklet ne remonte que 8 visages, donc le sous-ensemble suivi change sans
  // arret et les budgets se renouvellent. Sans limiteur, le declencheur tire
  // au rythme du cooldown pendant toute la duree du flux.
  const trig = createStepTrigger();
  const dt = 0.1;
  let t = 100, tirs = 0;
  // 50 coureurs qui defilent en 50 s, 8 visages visibles a tout instant.
  for (let k = 0; k < 500; k++) {
    const flat = [t, 8];
    for (let i = 0; i < 8; i++) {
      // Position qui defile en boucle : simule le flux continu.
      const x = ((1.2 - (k * 0.05 + i * 0.15)) % 1.6 + 1.6) % 1.6 - 0.3;
      flat.push(x, 0.5, 0.17, 0.17);
    }
    tirs += trig.ingest(flat).length;
    t += dt;
  }
  const parSeconde = tirs / 50;
  assert(parSeconde <= 3.1, `flux continu -> au plus 3 photos par seconde (got ${parSeconde.toFixed(2)})`);
  assert(tirs <= 160, `50 s de flux continu -> volume borne (got ${tirs})`);
  assert(tirs > 50, `mais le flux est bien servi, pas etouffe (got ${tirs})`);
}

console.log('\n[TEST 8] Entree invalide : aucun tir, aucune exception');
{
  const trig = createStepTrigger();
  assert(trig.ingest(null).length === 0, 'flat null');
  assert(trig.ingest([]).length === 0, 'flat vide');
  assert(trig.ingest([0, 0]).length === 0, 'ts nul');
  assert(trig.ingest([100, 1, NaN, 0.5, 0.1, 0.1]).length === 0, 'coordonnee NaN ignoree');
}

console.log(ko === 0 ? '\n✓ Tous les invariants sont tenus.\n' : `\n✗ ${ko} assertion(s) KO.\n`);
process.exit(ko === 0 ? 0 : 1);
