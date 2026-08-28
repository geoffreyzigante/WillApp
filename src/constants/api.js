// Endpoints reseau de l'app.
// API_URL : worker principal (PUT R2 + /runner/* + /organizer/* + /cover/
// + /runner/selfie/image + /admin/photo/...).
//
// Phase 2b fermeture R2 (2026-06-24) : R2_PUBLIC retire. Tout l acces
// au bucket passe desormais par le worker (auth runner pour selfie,
// public pour covers, p.url/thumb_url systematiquement renvoyes pour
// les photos d event).
export const API_URL = 'https://will-api.geoffreyzigante.workers.dev';

// Prix unitaire panier (paid events). Le worker valide cote backend lors
// du checkout Stripe ; cette valeur est juste utilisee cote UI pour
// afficher le total temps reel.
export const PRICE_PER_PHOTO_EUR = 1;

// Vente de photos : fonctionnalite a venir, pas encore ouverte.
//
// Tant qu elle est fermee, l entree "Mon panier" du menu est retiree — pas
// grisee. Une entree annoncee mais inactive est refusee par l App Store
// (regle 2.1, fonctionnalites placeholder). Le jour de l ouverture, il
// suffit de passer ce drapeau a true.
export const VENTE_PHOTOS_OUVERTE = false;
