// Robustesse d un mot de passe — bareme unique, partage avec le web
// (will-home-nav.js niveauMdp et will-launch-event-modal.js niveauDe).
// Toute modification ici doit y etre repercutee.
//
//   1 = Trop court  (moins de 8 caracteres) — rouge
//   2 = Correct     (8+, une seule famille de caracteres) — orange
//   3 = Solide      (8+ et au moins deux familles) — vert
//
// Familles : minuscules, majuscules, chiffres, caracteres speciaux.

export function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: '', color: '#A89CB8' };
  if (pwd.length < 8) return { score: 1, label: 'Trop court', color: '#E0666F' };
  const varietes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(pwd)).length;
  if (pwd.length >= 12 && varietes >= 3) return { score: 3, label: 'Solide', color: '#3BA55D' };
  if (varietes >= 2) return { score: 3, label: 'Solide', color: '#3BA55D' };
  return { score: 2, label: 'Correct', color: '#E8A33D' };
}
