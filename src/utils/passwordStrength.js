// Evaluation simple de la force d'un mot de passe :
// 0-1 = Faible (rouge)
// 2 = Moyen (warning)
// 3-4 = Fort (success)
// 5 = Tres fort (vert fonce)
//
// Criteres : longueur (6+, 10+), mix maj/min, chiffre, special.

import { C } from '../constants/colors';

export function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: '', color: C.textSoft };
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 1) return { score: 1, label: 'Faible', color: C.error };
  if (score === 2) return { score: 2, label: 'Moyen', color: C.warning };
  if (score <= 4) return { score: 3, label: 'Fort', color: C.success };
  return { score: 4, label: 'Très fort', color: '#059669' };
}
