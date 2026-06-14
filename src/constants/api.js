// Endpoints reseau de l'app.
// API_URL : worker principal (PUT R2 + /runner/* + /organizer/*).
// R2_PUBLIC : URL publique R2 pour les assets servis directement (cf
// memoire "WILL vente jalon R2" : a fermer avant 1er event payant public).
export const API_URL = 'https://will-api.geoffreyzigante.workers.dev';
export const R2_PUBLIC = 'https://pub-f9a5894e66a44f8cbb34582302930449.r2.dev';

// Prix unitaire panier (paid events). Le worker valide cote backend lors
// du checkout Stripe ; cette valeur est juste utilisee cote UI pour
// afficher le total temps reel.
export const PRICE_PER_PHOTO_EUR = 1;
