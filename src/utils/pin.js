// Helpers PIN photographe. Centralise generation et validation pour eviter
// les divergences entre wizard / edition / login.
//
// DEUX LONGUEURS COEXISTENT (decision du 12/11/2026, audit B1) :
//   - 4 chiffres : les events crees avant la bascule, qui gardent leur PIN ;
//   - 6 chiffres : les nouveaux, une fois la bascule faite cote serveur.
//
// D ou deux questions distinctes, a ne pas confondre :
//   - isKnownPin(pin)            « est-ce un PIN existant ? »  -> 4 OU 6.
//     Pour AFFICHER, copier, partager le PIN d un event.
//   - isValidPin(pin, longueur)  « puis-je POSER ce PIN ? »    -> la longueur
//     en vigueur, lue dans GET /config (cf usePinLength.js). Pour creer ou
//     modifier.
//
// Module PUR : aucun import, testable hors React Native.

export const PIN_LENGTH_DEFAUT = 4;
export const normaliserLongueurPin = (n) => (Number(n) === 6 ? 6 : 4);

// Conserve pour compatibilite d import ; ne decrit plus que l ancien format.
export const PIN_REGEX = /^\d{4}$/;

export const isKnownPin = (v) => /^(\d{4}|\d{6})$/.test(String(v || ''));

export const isValidPin = (v, longueur = PIN_LENGTH_DEFAUT) =>
  new RegExp(`^\\d{${normaliserLongueurPin(longueur)}}$`).test(String(v || ''));

// Le PIN propose par le formulaire. Le hasard du systeme quand il existe :
// Math.random est previsible, et ce PIN ouvre toutes les photos d un event.
export const generateRandomPin = (longueur = PIN_LENGTH_DEFAUT) => {
  const n = normaliserLongueurPin(longueur);
  const max = 10 ** n;
  let tirage;
  try {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    tirage = buf[0] % max;
  } catch {
    tirage = Math.floor(Math.random() * max);
  }
  return String(tirage).padStart(n, '0');
};
