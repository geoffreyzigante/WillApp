// Tests du journal embarque.
//
// L invariant central n est pas "le journal enregistre bien" mais "le journal
// ne peut pas faire tomber l app". Un diagnostic qui casse ce qu il observe
// est pire qu absence de diagnostic.
//
// Lancer :  npm run test:journal

import {
  installerJournal, desinstallerJournal, ajouterLigne,
  lignesJournal, journalVersTexte, viderJournal, statsJournal,
} from '../src/services/journal.js';

let ko = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { console.log(`  ✗ ${label}`); ko++; }
}

// Console factice : on n enveloppe jamais la vraie pendant les tests, sinon
// les assertions ci-dessus se retrouveraient dans le tampon mesure.
function faussConsole() {
  const recu = [];
  return {
    recu,
    log: (...a) => recu.push(['log', a]),
    warn: (...a) => recu.push(['warn', a]),
    error: (...a) => recu.push(['error', a]),
  };
}

console.log('\n[TEST 1] La console d origine continue de recevoir');
{
  viderJournal();
  const c = faussConsole();
  installerJournal(c);
  c.log('bonjour', 42);
  desinstallerJournal(c);
  assert(c.recu.length === 1, `la console d origine a recu la ligne (got ${c.recu.length})`);
  assert(lignesJournal()[0].texte === 'bonjour 42', `ligne formatee (got "${lignesJournal()[0]?.texte}")`);
}

console.log('\n[TEST 2] Installation idempotente : pas de doublon apres un rechargement OTA');
{
  viderJournal();
  const c = faussConsole();
  assert(installerJournal(c) === true, 'premiere installation acceptee');
  assert(installerJournal(c) === false, 'seconde installation refusee');
  c.log('une fois');
  desinstallerJournal(c);
  assert(lignesJournal().length === 1, `une seule entree (got ${lignesJournal().length})`);
}

console.log('\n[TEST 3] Aucun argument ne peut faire lever');
{
  viderJournal();
  const cyclique = { nom: 'boucle' };
  cyclique.moi = cyclique;
  const piege = { get explose() { throw new Error('getter hostile'); } };
  const cas = [
    ['texte'], [42], [true], [null], [undefined],
    [cyclique], [piege], [new Error('vrai echec')],
    [Symbol('s')], [() => {}], [[1, [2, [3]]]],
    [], [undefined, null, 0],
  ];
  let leve = false;
  for (const args of cas) {
    try { ajouterLigne('log', args); } catch { leve = true; }
  }
  assert(!leve, `aucun des ${cas.length} cas hostiles n a leve`);
  assert(lignesJournal().length === cas.length, `toutes les lignes enregistrees (got ${lignesJournal().length})`);
}

console.log('\n[TEST 4] Le tampon est borne, en nombre comme en longueur');
{
  viderJournal();
  for (let i = 0; i < 2000; i++) ajouterLigne('log', [`ligne ${i}`]);
  const n = lignesJournal().length;
  assert(n <= 800, `au plus 800 lignes gardees (got ${n})`);
  assert(lignesJournal()[0].texte === 'ligne 1999', 'la plus recente est en tete');

  viderJournal();
  ajouterLigne('log', ['x'.repeat(5000)]);
  const l = lignesJournal()[0].texte;
  assert(l.length < 700, `ligne tres longue tronquee (got ${l.length})`);
  assert(l.includes('(+'), 'la troncature est signalee');
}

console.log('\n[TEST 5] Filtre et niveaux');
{
  viderJournal();
  ajouterLigne('log', ['[pas] tir repere=0']);
  ajouterLigne('warn', ['[pas] erreur, frame ignoree']);
  ajouterLigne('log', ['[drain] 3 envoyees']);
  ajouterLigne('error', ['[capture] LOST']);
  assert(lignesJournal({ filtre: 'pas' }).length === 2, 'filtre texte');
  assert(lignesJournal({ filtre: 'PAS' }).length === 2, 'filtre insensible a la casse');
  assert(lignesJournal({ niveaux: ['warn', 'error'] }).length === 2, 'filtre par niveau');
  const s = statsJournal();
  assert(s.total === 4 && s.warn === 1 && s.error === 1, `stats justes (got ${JSON.stringify(s)})`);
}

console.log('\n[TEST 6] Export texte horodate, dans l ordre chronologique');
{
  viderJournal();
  ajouterLigne('log', ['premiere']);
  ajouterLigne('warn', ['seconde']);
  const txt = journalVersTexte();
  const lignes = txt.split('\n');
  assert(lignes.length === 2, `deux lignes (got ${lignes.length})`);
  assert(lignes[0].includes('premiere'), 'ordre chronologique a l export');
  assert(/^\d{2}:\d{2}:\d{2}\.\d{3} /.test(lignes[0]), 'horodatage en tete');
  assert(lignes[1].includes('!'), 'le niveau warn est marque');
}

console.log(ko === 0 ? '\n✓ Le journal ne peut pas casser ce qu il observe.\n' : `\n✗ ${ko} assertion(s) KO.\n`);
process.exit(ko === 0 ? 0 : 1);
