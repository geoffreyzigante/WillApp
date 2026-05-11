# WillApp

App mobile Expo (React Native) pour Will : galerie coureurs, mode photographe,
espace organisateur. Détection visage temps réel via **Vision Camera + MLKit**
et capture HQ en rafale.

## Installation

```bash
npm install
```

## Lancement (dev)

```bash
npx expo start
```

Pour les fonctionnalités natives (Vision Camera, MLKit face detector), un
**development client** est nécessaire (`expo-dev-client`) — Expo Go ne suffit
pas.

## Build & déploiement OTA

EAS Build / EAS Update gérés via `eas.json` (3 profils : `development`,
`preview`, `production`).

```bash
# Build natif iOS (interne / TestFlight ad hoc)
eas build --profile preview --platform ios

# Build production (App Store)
eas build --profile production --platform ios

# OTA update (JS only, sans rebuild natif)
eas update --branch preview --message "fix: ..."
eas update --branch production --message "feat: ..."
```

Le canal d'update est défini par le `channel` du profil (`preview`,
`production`) et `runtimeVersion.policy = "appVersion"` — les OTA ne sont
distribuées qu'aux builds dont la version applicative correspond.

## Variables d'environnement

L'app n'embarque **aucun secret**. Auth via `POST /auth/login` (et
`/runner/login`, `/organizer/login`) côté worker, qui renvoie un
`session.token` (JWT) utilisé en `Authorization: Bearer …` pour les appels
suivants. Le token est persisté via `expo-secure-store` (Keychain iOS).

URLs backend en haut de `App.js` :

- `API_URL` → Cloudflare Worker (`https://will-api.geoffreyzigante.workers.dev`)
- `R2_PUBLIC` → bucket public R2

## Dépendances natives critiques

| Package | Rôle |
| --- | --- |
| `react-native-vision-camera` | Capture HQ + frame processor (mode photographe) |
| `react-native-vision-camera-face-detector` | Détection de visages MLKit en temps réel |
| `react-native-worklets-core` | Worklets requis par Vision Camera frame processors |
| `expo-camera` | Capture selfie de référence (mode coureur) |
| `expo-secure-store` | Stockage du JWT de session (Keychain) |
| `expo-media-library` | Sauvegarde des photos téléchargées dans la pellicule iOS |
| `expo-file-system` | Queue persistante offline-first des uploads (`Paths.document/will_pending/`) |
| `expo-updates` | OTA EAS Update |
| `expo-image` | Affichage performant des galeries |

Toute mise à jour d'un de ces packages **requiert un rebuild EAS** (pas
seulement un OTA).

## Modes

- **Coureur** (par défaut) — selfie de référence (`expo-camera`), galerie
  personnelle matchée par Rekognition, galerie publique d'event, téléchargement
  HQ.
- **Photographe** — détection visage temps réel (`vision-camera` +
  `face-detector`), capture HQ rafale, upload offline-first (queue persistante
  dans `Paths.document/will_pending/`).
- **Organisateur** — soumission d'event, gestion photographes, paiement Stripe
  déclenché depuis l'app via `Linking.openURL` (Safari ouvre le Stripe
  Checkout, retour automatique vers l'app après confirmation côté admin).

## Permissions iOS requises

Déclarées dans `app.json` (`infoPlist`) et via les plugins :

- **Caméra** (`NSCameraUsageDescription`) — modes photographe et selfie
- **Photos** (`NSPhotoLibraryUsageDescription` + `…AddUsageDescription`) —
  lecture pour selfie et écriture pour téléchargement pellicule

> La géolocalisation est **désactivée** : pas de plugin `expo-location` ni de
> clé `NSLocationWhenInUseUsageDescription`. Aucune donnée GPS n'est collectée.

## Permissions Android requises

- `android.permission.CAMERA`
- `android.permission.RECORD_AUDIO` (requis par Vision Camera même en mode
  photo)

## Build properties

`expo-build-properties` impose `iosDeploymentTarget = 16.0` (requis par
Vision Camera 4.x). New architecture activée (`newArchEnabled: true`).
