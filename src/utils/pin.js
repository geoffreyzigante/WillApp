// Helpers PIN photographe (4 chiffres). Centralise la generation aleatoire
// et la validation pour eviter les divergences entre wizard / edition / login.

export const PIN_REGEX = /^\d{4}$/;
export const isValidPin = (v) => PIN_REGEX.test(String(v || ''));
export const generateRandomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
