# WillApp

App mobile Expo (React Native) pour Will : galerie coureurs, mode photographe,
espace organisateur. Utilise vision-camera + ML Kit pour la détection visage,
expo-image-manipulator + media-library pour la pellicule iOS.

## Installation

```bash
npm install
```

## Lancement (dev)

```bash
npx expo start
```

## Build

EAS Build géré via `eas.json` :

```bash
eas build --platform ios --profile preview     # interne (TestFlight ad hoc)
eas build --platform ios --profile production  # store
```

## Variables d'environnement

L'app n'embarque **aucun secret** : auth via `/auth/login` côté worker, qui
renvoie un `session.token` utilisé pour les appels suivants. Les URLs
backend sont en haut de `App.js` :

- `API_URL` → Cloudflare Worker
- `R2_PUBLIC` → bucket public R2

## Modes

- **Coureur** (par défaut) — galerie perso via selfie, galerie publique d'event, téléchargement photo HQ.
- **Photographe** — détection visage + capture HQ rafale, upload offline-first (queue persistante dans `Paths.document/will_pending/`).
- **Organisateur** — soumission d'event, gestion photographes, paiement via Stripe (hors app).

## Permissions iOS requises

- Caméra (mode photographe)
- Photos (lecture pour selfie + écriture pour téléchargement pellicule)
- Localisation (optionnelle, pour photo geo-tagging)
