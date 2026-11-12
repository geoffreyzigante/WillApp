// PIN photographe : deux longueurs coexistent (4 pour les events d avant le
// 12/11/2026, 6 ensuite). Ce test verrouille la difference entre « ce PIN
// existe » et « je peux poser ce PIN ».   npm run test:pin
import {
  isKnownPin, isValidPin, generateRandomPin, normaliserLongueurPin, PIN_LENGTH_DEFAUT,
} from '../src/utils/pin.js';

let ko = 0;
const assert = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ko += 1; };

console.log('\n[TEST 1] Un PIN existant : 4 ou 6 chiffres, rien d autre');
assert(isKnownPin('0042') && isKnownPin('004200'), '4 et 6 chiffres reconnus');
assert(!isKnownPin('12345') && !isKnownPin('1234567') && !isKnownPin('12a4') && !isKnownPin(''), '5, 7, lettres, vide refuses');
assert(!isKnownPin(null) && !isKnownPin(undefined), 'null et undefined ne levent pas');

console.log('\n[TEST 2] Un PIN qu on pose : la longueur en vigueur, pas une autre');
assert(PIN_LENGTH_DEFAUT === 4, 'sans reponse du serveur on reste a 4');
assert(isValidPin('1234') && !isValidPin('123456'), 'par defaut : 4 oui, 6 non');
assert(isValidPin('123456', 6) && !isValidPin('1234', 6), 'longueur 6 : 6 oui, 4 non');
assert(isValidPin('1234', 'n importe quoi') && isValidPin('1234', 5), 'longueur inconnue -> traitee comme 4');
assert(normaliserLongueurPin('6') === 6 && normaliserLongueurPin(6) === 6 && normaliserLongueurPin(undefined) === 4, 'normalisation : "6" -> 6, absent -> 4');

console.log('\n[TEST 3] Tirage');
const t6 = Array.from({ length: 500 }, () => generateRandomPin(6));
const t4 = Array.from({ length: 500 }, () => generateRandomPin());
assert(t6.every(p => isValidPin(p, 6)) && t4.every(p => isValidPin(p, 4)), 'un PIN tire est toujours posable a sa longueur');
assert(new Set(t6).size > 490, `pas de repetition suspecte (${new Set(t6).size} distincts sur 500)`);

console.log(ko === 0 ? '\n✓ PIN : tous les cas passent.\n' : `\n✗ ${ko} assertion(s) KO.\n`);
process.exit(ko === 0 ? 0 : 1);
