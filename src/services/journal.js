// Journal embarque.
//
// Sur iOS, un utilisateur n a aucun moyen de lire la sortie console d une
// app : les Donnees d analyse des Reglages ne contiennent que les rapports de
// plantage. Il faut un Mac, un cable et Console.app — inutilisable au bord
// d un parcours, precisement la ou les problemes se produisent.
//
// Ce module garde les dernieres lignes en memoire pour que l app puisse se
// les montrer a elle-meme, et les exporter.
//
// Deux exigences de conception :
//
//   1. Ne JAMAIS faire tomber l app. Un journal qui plante est pire
//      qu absence de journal : il casse ce qu il devait diagnostiquer. Tout
//      est garde, et le formatage des arguments ne peut pas lever.
//   2. Ne pas recurser. On enveloppe console.log ; si l enveloppe logue a son
//      tour, on part en boucle infinie. Rien ici n appelle console.
//
// Module PUR au sens ou il n importe rien : la cible est injectee, ce qui le
// rend testable hors React Native.

// Plafond du tampon. 800 lignes couvrent largement un passage de course, et
// bornent la memoire : a 200 octets par ligne, ~160 Ko.
const MAX_LIGNES = 800;
// Une ligne tronquee reste lisible ; une ligne de 40 000 caracteres — un
// objet serialise par erreur — fait ramer l ecran et mange le tampon.
const MAX_LONGUEUR = 600;

let tampon = [];
let installe = false;
let originaux = null;
let compteur = 0;

function formater(arg) {
  if (typeof arg === 'string') return arg;
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    const s = JSON.stringify(arg);
    return s === undefined ? String(arg) : s;
  } catch {
    // Cycle, getter qui leve, objet natif : on ne laisse rien remonter.
    try { return String(arg); } catch { return '[illisible]'; }
  }
}

export function ajouterLigne(niveau, args) {
  let texte;
  try {
    texte = (args || []).map(formater).join(' ');
  } catch {
    texte = '[ligne illisible]';
  }
  if (texte.length > MAX_LONGUEUR) {
    texte = `${texte.slice(0, MAX_LONGUEUR)}… (+${texte.length - MAX_LONGUEUR})`;
  }
  compteur += 1;
  tampon.push({ n: compteur, t: Date.now(), niveau, texte });
  if (tampon.length > MAX_LIGNES) tampon.splice(0, tampon.length - MAX_LINES_GARDE());
  return texte;
}

// Elagage par blocs plutot qu une ligne a la fois : splice sur un gros
// tableau coute cher, et il tourne ici a chaque ligne loguee.
function MAX_LINES_GARDE() {
  return Math.floor(MAX_LIGNES * 0.9);
}

// Enveloppe console.log / warn / error. Idempotent : deux appels ne posent
// qu une enveloppe, sinon un rechargement OTA doublerait chaque ligne.
export function installerJournal(cible) {
  const c = cible || (typeof console !== 'undefined' ? console : null);
  if (!c || installe) return false;
  originaux = { log: c.log, warn: c.warn, error: c.error };
  const enveloppe = (niveau, original) => (...args) => {
    try { ajouterLigne(niveau, args); } catch { /* jamais bloquant */ }
    try { original.apply(c, args); } catch { /* console indisponible */ }
  };
  c.log = enveloppe('log', originaux.log);
  c.warn = enveloppe('warn', originaux.warn);
  c.error = enveloppe('error', originaux.error);
  installe = true;
  return true;
}

export function desinstallerJournal(cible) {
  const c = cible || (typeof console !== 'undefined' ? console : null);
  if (!c || !installe || !originaux) return false;
  c.log = originaux.log;
  c.warn = originaux.warn;
  c.error = originaux.error;
  installe = false;
  originaux = null;
  return true;
}

// Lignes du plus recent au plus ancien — c est l ordre utile sur le terrain,
// on veut voir ce qui vient de se passer sans faire defiler.
export function lignesJournal(opts = {}) {
  const filtre = String(opts.filtre || '').trim().toLowerCase();
  const niveaux = opts.niveaux || null;
  let out = tampon;
  if (niveaux) out = out.filter(l => niveaux.includes(l.niveau));
  if (filtre) out = out.filter(l => l.texte.toLowerCase().includes(filtre));
  const copie = out.slice();
  copie.reverse();
  const limite = opts.limite || 0;
  return limite > 0 ? copie.slice(0, limite) : copie;
}

export function statsJournal() {
  let warn = 0, error = 0;
  for (const l of tampon) {
    if (l.niveau === 'warn') warn += 1;
    else if (l.niveau === 'error') error += 1;
  }
  return { total: tampon.length, warn, error, depuis: tampon.length ? tampon[0].t : null };
}

export function viderJournal() {
  tampon = [];
}

// Rendu texte pour l export. Horodatage local en heure:minute:seconde.mmm :
// c est ce qui permet de recouper une ligne avec un passage observe.
export function journalVersTexte(opts = {}) {
  const lignes = opts.filtre || opts.niveaux
    ? lignesJournal(opts).slice().reverse()
    : tampon;
  const out = [];
  for (const l of lignes) {
    const d = new Date(l.t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    const marque = l.niveau === 'log' ? ' ' : l.niveau === 'warn' ? '!' : 'X';
    out.push(`${hh}:${mm}:${ss}.${ms} ${marque} ${l.texte}`);
  }
  return out.join('\n');
}
