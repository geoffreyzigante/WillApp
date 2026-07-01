# Plan de merge feat/capture-v2 → main + rebase feat/pilote-autonomie

LOT 2 du plan pilote. Rédigé 2026-07-01. **Ce fichier est un guide pour toi (Geoffrey) ; je ne merge pas moi-même.**

## Contexte

- `main` HEAD : `ecaca97` (2026-06-25).
- `feat/capture-v2` HEAD : `6b70362` (2026-06-29), **25 commits d'écart avec main**.
- `feat/pilote-autonomie` HEAD : basée sur `main ecaca97`, 6 commits.

Une fois `feat/capture-v2` mergée dans main, il faudra **rebase** `feat/pilote-autonomie` sur le nouveau main.

## Diff résumé de feat/capture-v2 (25 commits)

**Refonte principale** : tri qualité local (native + JS) + mode guet + zone de capture stricte.

### Fichiers touchés

| Fichier | Type | Impact |
|---|---|---|
| `App.js` | modif | +333 lignes (imports queue.js, `quality` config PhotographerScreen, wiring scorer/reducer, telemetry) |
| `CONCEPTION_TRI_QUALITE_LOCAL.md` | ajout | 553 lignes doc conception |
| `app.json` | modif | plugins natifs + purpose strings iOS |
| `eas.json` | modif | profile build tuning |
| `package.json` | modif | +1 dep (probable react-native-vision-camera update ou nouvelle) |
| `plugins/PhotoQualityScorer.m` | ajout | 21 lignes wrapper ObjC |
| `plugins/PhotoQualityScorer.swift` | ajout | 351 lignes Swift natif |
| `plugins/with-photo-quality-scorer.js` | ajout | 79 lignes plugin expo config |
| `scripts/_loader_js_extension.mjs` | ajout | tooling test |
| `scripts/test_quality_failsafes.mjs` | ajout | tests failsafes reducer |
| `src/components/modals/LoginModal.js` | modif | +18 -0 (retire compteur tentatives + rate limit UI client) |
| `src/constants/queue.js` | modif | +ajout `DISK_CRITICAL_PERCENT`, `QUALITY_REDUCER_TICK_MS`, **retire `MAX_QUEUE_SIZE`** |
| `src/services/qualityReducer.js` | ajout | 348 lignes JS |
| `src/services/qualityScorer.js` | ajout | 61 lignes wrapper natif |
| `src/services/qualityTelemetry.js` | ajout | 126 lignes stats runtime |

**Total** : 2086 insertions, 75 deletions.

### Commits ordonnés

1. `84fda1c feat(capture): drop FIFO eviction, add 95% disk shutter guard`
2. `98efc51 docs(capture): conception tri qualite local (validee)`
3. `dc01c1a feat(capture): sous-etape A - module natif PhotoQualityScorer`
4. `5aaf2eb feat(capture): sous-etape B - wiring scorer dans processQueue`
5. `7421bba feat(capture): sous-etape C - postScoreReducer (flags, pas de drop)`
6. `d759aa5 feat(capture): sous-etape F - poids runtime + telemetrie distribution`
7. `64e7118 test(capture): failsafes du reducer qualite local`
8. `fe2ed2c feat(capture): sous-etape D - drainQueue applique upload_skipped + cleanup safe`
9. `e0d5406 fix(capture): retire redeclaration RCTPromise* deja dans PhotoMetadataBurner`
10. `0de0697 feat(login): retire compteur tentatives et rate limit UI client`
11. `895cae7 feat(capture): mode peloton - seuil =2 visages dans burst garde TOUT`
12. `1e62345 feat(capture): dropEnabled true par defaut + ignore quality serveur`
13. `e5e3dc5 fix(capture): centrage + seuil peloton >=3 (faux positifs MediaPipe)`
14. `664274a fix(capture): peloton desactive + drop force en dur (event J en cours)`
15. `68f0c50 fix(capture): garde tout si >=2 visages OU burst >=7 photos`
16. `80b096d fix(capture): cutoff dur centrage en mode multi (>0.3 du centre = skip)`
17. `dfb47cf fix(capture): garde photo si >=2 visages (un autre potentiel centre)`
18. `8e6b1f1 fix(capture): skip systematique photos sans visage dans la zone (pre-filter)`
19. `14fa551 fix(capture): skip strict si biggest face hors zone (option A pragmatique)`
20. `fd74e22 fix(capture): seuil zone strict 36 percent (vs 60 percent) - matche zone capture`
21. `bb86acc feat(capture): scorer expose facesInZone, JS utilise au lieu de biggest`
22. `26d8398 perf(camera): stabilisation cinematic-extended -> standard (Etape A guet)`
23. `2e594c6 perf(camera): early-return frame processor si pas armed/detection (Etape A guet)`
24. `bf97cb2 chore(ios): purpose strings (camera/selfie, localisation) + distribution store`
25. `6b70362 feat(ios): supportsTablet false (iPhone-only pour App Store review)`

## Conflits attendus vs feat/pilote-autonomie

### 1. `src/constants/queue.js` — conflit sûr

- `feat/capture-v2` : **retire** `MAX_QUEUE_SIZE` (probablement remplacé par une valeur dérivée du FIFO drop).
- `feat/pilote-autonomie` : n'y touche pas mais utilise indirectement `QUEUE_WARN_THRESHOLD` via CriticalAlert (LOT 1.2).

**Résolution** : accepter la version capture-v2 pour queue.js. Vérifier que `QUEUE_WARN_THRESHOLD` existe encore (utilisé par LOT 1.2). Si non → rewire vers la nouvelle constante ou hardcoder 500 dans CriticalAlert.

### 2. `App.js` imports en tête — conflit sûr

- `feat/capture-v2` ajoute des imports (`DISK_CRITICAL_PERCENT`, `QUALITY_REDUCER_TICK_MS`, `scorePhotoSafely`, `reduceBursts`, etc).
- `feat/pilote-autonomie` ajoute `CriticalAlert`, `photographerRuntime`, `startHeartbeat`, `enqueueAlert`, `thermalEmitter`.

**Résolution** : merge manuel — garder les deux blocs d'imports. Pas de conflit sémantique.

### 3. `App.js` PhotographerScreen — **conflit fort probable**

- `feat/capture-v2` ajoute `quality: { weights: ..., dropEnabled: true }` dans l'état config (lignes ~440-460 sur capture-v2).
- `feat/pilote-autonomie` ajoute `[thermalStateStr, offlineSince, freeDiskGB, dismissedKind]` dans la même zone (lignes ~560-570 sur pilote).
- Modif du useEffect de mount (auto-arm) sur pilote vs modif du wiring frame processor sur capture-v2.
- Les 2 branches modifient la ligne de import `Battery.BatteryState` + les hooks batterie.

**Résolution** : merge à la main, garder les deux ensembles de states. Le useEffect de mount de pilote (auto-arm) doit rester en dernier après startSession, pour ne pas être court-circuité par les modifs frame processor de capture-v2.

### 4. `plugins/PhotoQualityScorer.m` — risque `RCTPromise*` redeclaration

- Commit capture-v2 `e0d5406` corrige déjà une redéclaration avec `PhotoMetadataBurner.swift` (mémoire `reference_will_native_modules_pattern`).
- `feat/pilote-autonomie` ne touche aucun code natif → **pas de conflit direct**, mais le fresh build EAS restera obligatoire.

### 5. `src/components/modals/LoginModal.js` — pas de conflit

- `feat/capture-v2` retire compteur tentatives (commit `0de0697`).
- `feat/pilote-autonomie` ne touche pas ce fichier.

## Risques techniques capture-v2 (non testés en OTA)

- **PhotoQualityScorer natif** : nouveau module iOS Swift + wrapper ObjC. Si mal wire dans `Info.plist` ou `Podfile` autogen, **crash au boot de l'app fresh** (mémoire `feedback_will_ota_hides_native_crash`).
- **Mode guet (early-return frame processor)** : la worklet peut geler la caméra si la synchro condition/state est cassée. Difficile à reproduire en simulator.
- **`ios/supportsTablet: false`** : impacte App Store validation, pas la stabilité.
- **`package.json` +1 dep** : à vérifier via `git diff main..feat/capture-v2 -- package.json` — si c'est `@sentry/react-native` ou similaire, refuser (mémoire `reference_will_sentry_pitfall`).

## Plan de test à froid AVANT build EAS distribution

```bash
# 1. Vérifier la propreté locale.
cd ~/WillApp
git status                       # doit être clean (le CONCEPTION_MODE_GUET.md untracked peut rester)

# 2. Merger capture-v2 dans main.
git checkout main
git merge feat/capture-v2        # va probablement s'auto-merger (pas de conflit contre main)
# En cas de conflit : git merge --abort et rejoue à la main.

# 3. Push main (pas encore build EAS).
git push origin main

# 4. Test à froid : build natif fresh SANS OTA.
npx expo prebuild --clean        # regenerate ios/android natif
cd ios && pod install && cd ..
npx expo run:ios --device        # build + install sur iPhone connecté USB

# 5. Sur l'iPhone : tester tout le flow photographe (login, capture, upload,
#    kill app, relaunch). AUCUN crash toléré.

# 6. Si un crash au boot : bisect sur capture-v2.
git checkout main
git bisect start
git bisect bad feat/capture-v2
git bisect good ecaca97          # main pre-capture-v2
# Pour chaque commit intermédiaire proposé : refaire prebuild + run:ios.
```

## Rebase feat/pilote-autonomie APRÈS merge capture-v2 dans main

Une fois main mis à jour :

```bash
cd ~/WillApp
git checkout feat/pilote-autonomie
git fetch origin
git rebase origin/main
# Résoudre les conflits attendus (§conflits ci-dessus).
# Points de test après rebase :
# - Auto-arm au mount (LOT 1.1)
# - CriticalAlert overlays fonctionnent (LOT 1.2)
# - Boot post-crash reprend le mode (LOT 1.5)
# - Heartbeat 10 min envoyé + Discord reçoit un message (LOT 1.6)

git push --force-with-lease origin feat/pilote-autonomie
```

## Puis merger feat/pilote-autonomie dans main

Après validation du rebase + retest à froid :

```bash
git checkout main
git merge feat/pilote-autonomie
git push origin main
```

## Build EAS distribution + OTA push

Une fois main contient les 2 mergees (capture-v2 + pilote-autonomie) :

```bash
cd ~/WillApp
eas build --platform ios --profile preview
# Attendre 15-25 min. Récupérer .ipa, installer sur iPhone test manuellement
# ou via TestFlight interne. AUCUN crash toléré.

# Après validation visuelle iPhone test :
eas update --channel preview --branch main --message "pilote-autonomie + capture-v2"
```

## Ce qui ne devrait PAS être fait dans ce merge

- ❌ NE PAS activer `@sentry/react-native` (mémoire `reference_will_sentry_pitfall`).
- ❌ NE PAS toucher aux plugins natifs Guided Access — c'est purement iOS.
- ❌ NE PAS forcer capture-v2 en OTA sans build fresh préalable (mémoire `feedback_will_ota_hides_native_crash`).

## Commandes finales — checklist

- [ ] `git checkout main && git merge feat/capture-v2` (OU conflit → résoudre)
- [ ] `git push origin main`
- [ ] `npx expo prebuild --clean && cd ios && pod install`
- [ ] `npx expo run:ios --device` (fresh build test)
- [ ] Aucun crash : passer à l'étape suivante. Sinon bisect.
- [ ] `git checkout feat/pilote-autonomie && git rebase origin/main`
- [ ] Résoudre les conflits (queue.js, App.js imports, PhotographerScreen states)
- [ ] `git push --force-with-lease origin feat/pilote-autonomie`
- [ ] `git checkout main && git merge feat/pilote-autonomie && git push`
- [ ] `eas build --platform ios --profile preview`
- [ ] Test manuel iPhone test
- [ ] `eas update --channel preview --branch main`
- [ ] Vérifier OTA appliquée sur iPhone bénévole
