# État branches WillApp — pilote event 500+

Rédigé 2026-07-01, **mis à jour après merge intégré autonome soir 2026-07-01**.

## TL;DR

**Le merge est déjà fait.** La branche `feat/pilote-integrated` contient :
- Les 25 commits de `feat/capture-v2` (tri qualité local + mode guet + zone stricte).
- Les 6 commits de `feat/pilote-autonomie` (auto-arm, CriticalAlert, boot post-crash, heartbeat).
- 2 fixes audit code (event_code stamp + offlineTick).

**Tu n'as pas à merger toi-même**. Tu build EAS + tests + merge dans main quand OK.

## Branches disponibles

| Branche | Base | HEAD | Statut |
|---|---|---|---|
| `main` | — | `ecaca97` | prod actuelle OTA `preview` |
| `feat/capture-v2` | `main` | `6b70362` | non-mergée — historique refonte capture |
| `feat/pilote-autonomie` | `main` | `955c197` | non-mergée — historique lots 1 + docs |
| `feat/pilote-integrated` | `main` | `f183a67` | **branche cible pour build EAS** |

## Contenu de `feat/pilote-integrated`

31 commits ahead of main. Composés de :

**Capture-v2 (25 commits, auto-merge sans conflit)** — refonte qualité + guet :
- Module natif `PhotoQualityScorer` (Swift + ObjC wrapper).
- Reducer JS qualité post-score (`src/services/qualityReducer.js`).
- Mode guet worklet early-return frame processor.
- Zone stricte 36% + peloton fallback.
- `supportsTablet: false` + purpose strings iOS.

**Pilote-autonomie (6 commits, auto-merge sans conflit)** :
- Auto-armement capture au mount PhotographerScreen + toast.
- `CriticalAlert` overlay plein écran 7 kinds.
- Boot post-crash re-entry + `photographerRuntime.recoveredFromCrash`.
- Heartbeat 10 min + queue alertes offline.
- Docs `PILOTE_GUIDED_ACCESS.md` + `MERGE_CAPTURE_V2_PLAN.md` (ce fichier).

**Merge commit** `18ab64a Merge branch 'feat/pilote-autonomie' into feat/pilote-integrated`.

**Fixes audit code (2 commits)** :
- `f183a67 fix(pilote/mobile): audit bugs — offlineTick + event_code stamp alertes`.

## Tests exécutés post-merge intégré

- `npm run test:quality` : **7/7 failsafes OK**.
- `node --check` sur `App.js`, `src/services/heartbeat.js` : syntax OK.
- Imports capture-v2 (`DISK_CRITICAL_PERCENT`, `QUALITY_REDUCER_TICK_MS`, `scorePhotoSafely`, `reduceBursts`) présents.
- Imports pilote-autonomie (`CriticalAlert`, `startHeartbeat`, `photographerRuntime`, `thermalEmitter`) présents.

**Tests non-exécutés** (obligatoires demain) :
- Build EAS iPhone : **INDISPENSABLE**. Le module natif `PhotoQualityScorer` = OTA seul est insuffisant.
- Test manuel iPhone : `PILOTE_GUIDED_ACCESS.md` + `VALIDATION_PROTOCOLES.md`.

## Risques restants (à vérifier au build)

1. **PhotoQualityScorer natif** : nouveau module iOS. Si le podspec autogen a un souci, l'app crash au boot. Bisection commit/commit possible (cf mémoire `feedback_will_ota_hides_native_crash`).
2. **Mode guet** : early-return dans frame processor worklet. À tester en laissant caméra armée 15 min sans mouvement — pas de gel attendu.
3. **package.json** : vérifié 2026-07-01 — aucune nouvelle dépendance, seul ajout = script `test:quality`. Pas de risque Sentry.

## Commandes à jouer demain (résumé)

Détails complets dans `~/WILL/DEMAIN.md`. Résumé :

```bash
cd ~/WillApp
git checkout feat/pilote-integrated
git pull
# Vérifier que package.json n'ajoute pas Sentry :
git diff main..HEAD -- package.json

# Build natif fresh (pas OTA — le module natif l'exige).
npx expo prebuild --clean
cd ios && pod install && cd ..
npx expo run:ios --device       # sur iPhone connecté USB

# Test manuel selon PILOTE_GUIDED_ACCESS.md + VALIDATION_PROTOCOLES.md.

# Une fois OK, merger dans main.
git checkout main
git merge feat/pilote-integrated
git push origin main

# EAS build distribution (channel preview).
eas build --platform ios --profile preview
# Puis OTA update apres validation :
eas update --channel preview --branch main --message "pilote event 500+"
```

## Résumé pour toi

- ✅ Le merge est fait, sans conflit, tests OK.
- ✅ La branche `feat/pilote-integrated` est push sur GitHub.
- 🔨 Ton travail demain : build EAS fresh + test iPhone + merge dans main + OTA push.

Aucun conflit à gérer à la main. Pas de rebase à faire.
