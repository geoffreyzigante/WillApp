# CONCEPTION — TRI QUALITÉ LOCAL APPLE VISION

Branche : `feat/capture-v2`
Suite à : `~/WILL/CONCEPTION_CAPTURE_ZERO_PERTE.md` (étape 1 livrée le 2026-06-26 sur cette branche, commit `84fda1c`).
Document, pas de code. Ce qui suit doit être validé avant tout chantier mobile.

---

## 0. RAPPEL DE LA CIBLE (verbatim utilisateur)

1. 1-3 photos par passage, qualité « suffisante smartphone ».
2. Tri qualité local Apple Vision (net + visage) AVANT l'upload.
3. La capture rafale **n'est jamais ralentie** par le tri (exigence absolue).
4. File qui ne perd jamais de photo (acquis depuis l'étape 1).
5. AWS ne voit que les 1-3 retenues.
6. **On livre toujours au moins 1 photo** par passage, même si toutes sont mauvaises (la moins pire).

---

## 1. CE QUE APPLE VISION SAIT FAIRE ON-DEVICE — HONNÊTEMENT

### 1.1 Signaux fiables on-device

| Signal | API | Coût (12 Mpx) | Fiabilité photo de course |
|---|---|---|---|
| Visage présent (count) | `VNDetectFaceRectanglesRequest` | 3-5 ms (déjà utilisé en frame processor) | ✅ excellent |
| BBox visage (taille relative) | idem | inclus | ✅ excellent, **proxy direct de la distance au coureur** |
| Position du visage (centré ? cropé ?) | idem | inclus | ✅ utilisable |
| Yeux ouverts | `VNDetectFaceLandmarksRequest` (landmarks → distance paupières) | 15-30 ms | ⚠️ moyen — calcul manuel à partir des 6 landmarks oculaires, biais sur visages de profil |

### 1.2 Le signal Apple Vision « qualité de capture » — le piège

`VNDetectFaceCaptureQualityRequest` retourne un score 0..1 par visage. **C'est exactement le score que le worker a explicitement neutralisé** (`worker:407-414`, commentaire en clair) :

> Le score VNDetectFaceCaptureQuality (Apple Vision) a ete neutralise (minQuality=0) : le pipeline natif AVCapturePhotoOutput + Deep Fusion + cap shutter 1/500 garantit deja la nettete. Le score Apple, **calibre studio-grade, rejetait abusivement les coureurs a distance** (scores 0.3-0.5 sur des photos OK).

**Conséquence pour cette conception** : on n'utilise **pas** `VNDetectFaceCaptureQuality` comme couperet seul. On peut éventuellement l'utiliser comme **signal d'ordonnancement relatif au sein d'un burst** (« lequel est le moins mauvais »), mais jamais comme seuil absolu. À retenir comme angle mort #1.

### 1.3 Ce que Apple Vision NE fait PAS — et la décision produit associée

| Ce qu'on voudrait | API native ? | Décision |
|---|---|---|
| Score de netteté global (image entière) | **AUCUNE** : Vision n'expose ni « blurriness » ni « focus score » | **On NE l'implémente PAS.** Nos paramètres de capture (`photoQualityBalance="speed"`, cap shutter 1/500, AF continu, Smart HDR) acquièrent déjà la netteté. La sharpness AWS du serveur, dans la pratique d'un burst, varie très peu d'une photo à l'autre — son pouvoir discriminant intra-burst est marginal. On accepte de ne pas reproduire ce signal. |
| Détection « dos / silhouette sans tête » | partiel via `VNDetectHumanRectangles` mais bruité (rejeté en 2026-05) | on couvre via `yaw` (head turn) + règle « visage présent » |
| Brightness globale | pas natif Vision, mais natif **CoreImage** (`CIAreaAverage` sur Y) | **on l'implémente** (~5-10 ms), reproductibilité 1:1 du signal AWS Brightness |
| « Cette photo est intéressante » | aucune | hors scope produit |

**Angles morts assumés** :
- #1 : la sharpness n'est pas reproduite. Trade-off accepté (cf. §1.4).
- #2 : la brightness est CoreImage, pas Vision. C'est honnête, on le note dans le code.

### 1.4 Philosophie : miroir du tri serveur

Le score serveur (`worker:9168-9170`, `analyzeFaces`) :

```js
qualityScore = sharpness*0.4 + brightness*0.2 + faceConfidence*0.3 + (eyesOpen ? 10 : 0)
```

Le tri local **mirroir** la même hiérarchie, **moins sharpness** (non native, et marginale en intra-burst), **plus 2 bonus** que le serveur ne peut pas calculer faute des signaux Vision natifs :
- **face_area** (le serveur la stocke mais ne la note pas) : poids volontairement faible (0.10) et **tunable**.
- **yaw** (head turn) : signal natif Vision, exactement ce qu'il faut pour exclure les coureurs vus de dos, que le serveur ne sait pas écarter.

→ « Réplique honnête du serveur + 2 gains nets que le téléphone peut offrir gratuitement. »

---

## 2. OÙ LE TRI S'INSÈRE EXACTEMENT

### 2.1 Pipeline actuel (post-étape 1)

```
[VisionCamera frame processor — queue background]
        │ ~10 fps detectHumans
        ▼ runOnJS (Worklets)
onHumansDetectedJS  ───────────────────────────────  CHEMIN CHAUD CAPTURE
        │  (App.js:724)                              ─────────────────────
        ▼ si visage en zone + auto-armé
captureBurstLoop()  (App.js:1916, JS thread, async)
        │
        ├─ MAX_IN_FLIGHT = 3
        ▼
captureOne()  (App.js:2026)
        │
        ▼ await camera.takePhoto({ flash:'off', enableShutterSound:false })
        │  (AVFoundation thread, AVCapturePhotoOutput, speed mode)
        ▼ photo.path = file:///tmp/visioncamera-xxx.heic
enqueueBurstItems()  (App.js:1261)
        │
        ├─ move HEIC → will_pending/raw/{id}.heic
        ├─ writeSidecar JSON
        └─ commitQueue (AsyncStorage)

[Workers serial, en différé du chemin chaud capture]
        │
        ▼ processQueue (App.js, JS, serial)
PhotoMetadataBurner.burnMetadata()      ── plugins/PhotoMetadataBurner.swift
        │  serial DispatchQueue QoS .utility (Swift:50-53)
        │  mode actuel : byte-copy passthrough
        ▼ → will_pending/processed/{id}.heic
        ▼ drainQueue → BackgroundUploader → PUT R2
```

### 2.2 Pipeline cible

L'insertion se fait dans la zone « workers serial, en différé ». **Le chemin chaud capture n'est pas modifié.**

```
[CHEMIN CHAUD CAPTURE — INCHANGÉ]
captureBurstLoop → captureOne → takePhoto → enqueueBurstItems
        │  (move + sidecar + commitQueue, comme aujourd'hui)
        ▼
[WORKERS SERIAL EN DIFFÉRÉ]

processQueue (JS, serial)
        │
        ├──▶ étape A : PhotoQualityScorer.scoreRaw(srcPath)     ── NOUVEAU
        │    serial DispatchQueue QoS .utility, 1 photo à la fois
        │    Retourne { sharpness, faceCount, biggestFaceArea, faceCaptureQuality? }
        │    Écrit dans le sidecar : sidecar.score = {...}, sidecar.scored_at = now
        │
        ├──▶ étape B : PhotoMetadataBurner.burnMetadata(...)
        │    (existant, passthrough, inchangé)
        │
        ▼
postScoreReducer (NOUVEAU, JS, déclenché par tick)
        │  Pour chaque burstTs dont TOUS les items du burst sont :
        │    - scored OU
        │    - dont le délai d'attente max (BURST_REDUCE_DELAY_MS = 8 s)
        │      depuis le 1er shot du burst est dépassé
        │  →
        │    1. Classe les photos du burst par scoreComposite DESC
        │    2. Garde top N (PASSAGE_KEEP_TOP_N_MOBILE = 3)
        │    3. Pour les non-retenues : marque sidecar.upload_skipped = true,
        │       puis delete HEIC + sidecar (la photo n'a jamais quitté le tel)
        │  Si TOUTES les photos du burst ont scoreComposite < seuil "bon" :
        │    on garde quand même la MEILLEURE (la moins pire). Promesse #6.
        ▼
drainQueue (BackgroundUploader) — UNCHANGED protocol
        Upload uniquement les items kept.
```

### 2.3 Module natif — `PhotoQualityScorer.swift` (nouveau)

Symétrique à `PhotoMetadataBurner.swift` (même style, même pattern, même queue) :

```
plugins/PhotoQualityScorer.swift   (~250 LOC)
plugins/PhotoQualityScorer.m       (RCT bridge, ~30 LOC)
plugins/with-photo-quality-scorer.js (Expo config plugin, ~25 LOC)
```

Signature exposée RN :
```swift
@objc(scoreRaw:resolver:rejecter:)
func scoreRaw(_ srcPath: String,
              resolver: @escaping RCTPromiseResolveBlock,
              rejecter: @escaping RCTPromiseRejectBlock)
```

Résolut un dictionnaire `{ faceCount: Int, faceConfidence: Double, biggestFaceArea: Double, biggestFaceCenter: [Double], yaw: Double, pitch: Double, eyesOpen: Bool, eyesOpenApplicable: Bool, brightness: Double, faceCaptureQuality: Double?, elapsedMs: Int }`.

Note : le scorer renvoie les **signaux bruts** ; la formule `scoreComposite` est calculée côté JS pour rester runtime-tunable (cf. §F).

**Queue dédiée :**
```swift
private static let scorerQueue = DispatchQueue(
  label: "com.willapp.photoqualityscorer",
  qos: .utility
)
@objc func methodQueue() -> DispatchQueue { Self.scorerQueue }
```

→ même QoS `.utility` que `PhotoMetadataBurner`, **queue distincte** : si on tient à exécuter les deux en parallèle un jour, on peut. Sinon, comme aujourd'hui pour le burner, JS appelle séquentiellement.

---

## 3. PREUVE — LA CAPTURE NE PEUT JAMAIS ÊTRE RALENTIE PAR LE TRI

### 3.1 Le chemin chaud capture, avant / après — diff symbolique

**Avant (post-étape 1)** :
```
onHumansDetectedJS (JS thread)
  └─ captureBurstLoop
       └─ captureOne
            └─ await takePhoto        ← thread AVCapture
            └─ enqueueBurstItems      ← thread JS (move + sidecar + commitQueue)
```

**Après cette conception** :
```
onHumansDetectedJS (JS thread)
  └─ captureBurstLoop
       └─ captureOne
            └─ await takePhoto        ← thread AVCapture
            └─ enqueueBurstItems      ← thread JS (move + sidecar + commitQueue)
            ─────────────────────────────────  IDENTIQUE
```

**Aucune ligne ajoutée au chemin chaud.** Le scorer est appelé depuis `processQueue`, qui tourne en différé (déjà aujourd'hui, c'est lui qui appelle `PhotoMetadataBurner`). `captureOne` rend la main dès que le HEIC est dans `raw/{id}.heic` et que le sidecar est écrit. Le scoring est un consommateur asynchrone de cette file disque.

### 3.2 Trois isolations physiques

1. **Thread** : le scorer tourne sur `com.willapp.photoqualityscorer` (DispatchQueue serial). Cette queue est **disjointe** de :
   - la queue VisionCamera capture (AVFoundation)
   - la queue frame processor (background VisionCamera)
   - le main thread RN UI
   - la JS thread RN

2. **QoS** : `.utility`. Sous iOS, le scheduler garantit que `.userInitiated` (capture) > `.userInteractive` (UI) > `.utility` (tri). Si l'iPhone est saturé CPU, le tri est **préempté** au profit de la capture, jamais l'inverse.

3. **Backpressure-safe** : le scorer ne tient pas de référence à `cameraRef` ni à aucun objet capture. Il lit un fichier HEIC sur disque et écrit un sidecar JSON. Si la queue scorer accumule du retard (ex. peloton de 50 coureurs en 10 s = 200+ photos), elle traite en différé — la capture continue à produire des fichiers dans `raw/`.

### 3.3 Garantie de non-blocage en cas de panne du scorer

Si `PhotoQualityScorer.scoreRaw` throw, plante, ou met 10 s à répondre :
- `processQueue` catch l'exception → écrit `sidecar.score_failed = true` → la photo est **traitée comme « score inconnu »** et **toujours uploadée** (failsafe : un scoring KO ne doit pas faire perdre la photo).
- `captureBurstLoop` ne sait même pas que le scorer existe : il continue à enchaîner des `takePhoto`.

### 3.4 Garantie en cas de queue scorer saturée

- Le `raw/` directory peut grandir. Les garde-fous de l'étape 1 (5 Go pendingDir + 95 % disque iPhone) coupent l'auto-capture **avant** la corruption.
- Le scorer rattrape pendant les accalmies entre vagues de coureurs.

→ **Aucun chemin par lequel le tri peut retarder une rafale n'existe.**

---

## 4. SUR QUOI LE TRI JUGE « SUFFISANTE SMARTPHONE »

### 4.1 Les 5 signaux locaux retenus

Tous extraits en **un seul passage Vision** (`VNDetectFaceLandmarksRequest`, qui retourne déjà `boundingBox`, `confidence`, `yaw`, `pitch`, `roll`, et les `landmarks2D`) + un `VNDetectFaceCaptureQualityRequest` optionnel (pas dans le score baseline, garde uniquement comme signal observé) + un CoreImage average pour la brightness.

| # | Signal | Source | Échelle | Poids par défaut (tunable) |
|---|---|---|---:|---:|
| 1 | `faceConfidence` | `VNFaceObservation.confidence` du + grand visage | 0..1 | **0.40** |
| 2 | `brightness` | CoreImage `CIAreaAverage` sur canal Y | 0..1 (normalisé depuis 0..255) | **0.27** |
| 3 | `eyesOpen` | EAR sur `landmarks.leftEye / .rightEye`, **gated par `|yaw| ≤ 45°`** | bool | **0.13** |
| 4 | `biggestFaceArea` | `boundingBox.width × height` | 0..1, normalisé via `FACE_AREA_NORM = 0.05` | **0.10** |
| 5 | `yawScore` | dérivé de `VNFaceObservation.yaw` (radians) | 0..1 | **0.10** |

Total = 1.00. Tous les poids sont **paramètres** (cf. §F, runtime-configurables via `eventConfig.quality.weights`).

### 4.2 Formule

```text
scoreComposite =
    W_FACE_CONFIDENCE × clamp(faceConfidence, 0, 1)
  + W_BRIGHTNESS      × clamp(brightness, 0, 1)
  + W_EYES_OPEN       × (eyesOpenApplicable && eyesOpen ? 1 : 0)
  + W_FACE_AREA       × clamp(biggestFaceArea / FACE_AREA_NORM, 0, 1)
  + W_YAW             × yawScore(biggestFaceYaw)

avec :
  yawScore(y) = 1                          si |y| ≤ 30°  (face caméra)
              = (60° − |y|) / 30°          si 30° < |y| ≤ 60°
              = 0                          si |y| > 60°  (profil / dos)

  eyesOpenApplicable = |yaw| ≤ 45°         (EAR fiable seulement de face / léger 3/4)

  FACE_AREA_NORM = 0.05                    (5 % de l'aire image = score plein)

  Defaults :
    W_FACE_CONFIDENCE = 0.40
    W_BRIGHTNESS      = 0.27
    W_EYES_OPEN       = 0.13
    W_FACE_AREA       = 0.10   ←  le levier prioritaire au calibrage E
    W_YAW             = 0.10
```

**Cas 0 visage** : `faceConfidence = 0`, `biggestFaceArea = 0`, `yawScore = 0`, `eyesOpen = 0`. Seule la `brightness` contribue → score ≤ 0.27. La photo coule en bas du tri, **mais reste candidate au top-N** (cf. §5, jamais 0 photo livrée).

### 4.3 Cohérence avec le serveur

| Signal serveur | Poids serveur | Reproduit local ? | Poids local |
|---|---:|---|---:|
| Sharpness | 0.4 | ❌ pas reproduit | 0 |
| Brightness | 0.2 | ✅ CoreImage | 0.27 |
| face_confidence | 0.3 | ✅ Vision | 0.40 |
| eyes_open | bonus +10 | ✅ EAR (gated yaw ≤ 45°) | 0.13 |
| face_box_ratio | 0 (stocké non scoré) | ✅ Vision | 0.10 |
| (absent serveur) yaw / head turn | — | ✅ Vision natif | 0.10 |

Proportionnellement, brightness + face_confidence + eyes_open représentent ici **0.80** du score local — exactement le « budget restant » après suppression de la sharpness, redistribué selon les proportions du serveur (33,3 % / 50 % / 16,7 %), soit local 0.27 / 0.40 / 0.13 quand `W_FACE_AREA + W_YAW = 0.20`.

→ **C'est mathématiquement le miroir le plus proche du serveur compatible avec les signaux on-device.**

### 4.4 Coût mesuré (à valider sur device)

| Étape | Coût attendu |
|---|---:|
| Décodage HEIC → CGImage | 30-60 ms |
| Downsample 4032×3024 → 800×600 (`CILanczosScaleTransform`) | 15-25 ms |
| `VNDetectFaceLandmarksRequest` (inclut bbox + yaw + landmarks) | 30-50 ms |
| `CIAreaAverage` brightness sur Y | 5-10 ms |
| Calcul EAR + scoreComposite (Swift) | < 1 ms |
| **Total** | **~80-150 ms / photo** |

Throughput attendu : **7-12 photos/s** sur la queue scorer. Tient la cadence d'un iPhone (5-7 ph/s) avec marge.

### 4.5 Angles morts à reconnaître

| Angle mort | Mitigation |
|---|---|
| Sharpness non reproduite | trade-off assumé (cf. §1.4). Si terrain montre des photos floues passant le tri, on rebascule sur tri partiel local + affinage serveur — l'archi décorrélée le permet. |
| EAR biaisé sur profil | gated par `eyesOpenApplicable = |yaw| ≤ 45°`. Au-delà, on assigne `eyes_open = 0` (et le yaw filtre déjà) |
| Brightness CoreImage, pas Vision | honnête. Reproductibilité 1:1 du signal AWS, marginal |
| `.dng` ProRAW | scorer skip, photo passe à l'upload **sans score** → traitée comme « score_failed = true » → failsafe : uploadée sans tri |
| iPhone bas de gamme plus lent | si throughput scorer < cadence capture, queue grossit, rattrape à l'accalmie. Garde-fou disque protège. |
| HEIC corrompu / décode échoue | scorer reject, processQueue catch → `score_failed = true` → uploadée sans tri |

---

## 5. SEUIL « 1 À 3 PHOTOS PAR PASSAGE »

### 5.1 Définition de « passage » côté mobile

Une **rafale** (`captureBurstLoop` complète) = **un passage** côté mobile. Marqueur unique : `burstTs` (millisecondes du début de boucle, déjà attaché à chaque photo, App.js:1924).

> **Note honnête** : la définition serveur du passage (30 s, par couple photographer×runner, cf `worker:6838`) est plus riche mais **non disponible côté mobile** (pas de runner_id local). On reste sur la définition mobile « burst = passage ». Si un coureur déclenche 2 bursts (sort puis re-rentre en zone), il y aura 2 passages côté mobile → potentiellement 2-6 photos après tri local. Le worker fera son tri top-3 par-dessus, donc l'effet est borné côté final.

### 5.2 Algorithme de réduction (`postScoreReducer`)

Pseudo-code (Javascript, dans `processQueue.js` ou nouveau `qualityReducer.js`) :

```text
1. Index par burstTs : pour chaque sidecar scoré (sidecar.score présent),
   regrouper par sidecar.burstTs.
2. Un burst est "prêt à réduire" quand :
   - tous les items de ce burstTs sont scored OU score_failed, OU
   - le timeout BURST_REDUCE_DELAY_MS (8 s) depuis le premier shot est dépassé.
3. Sur un burst prêt :
   - Trier les items par scoreComposite DESC (NaN ou score_failed → score = -1).
   - Garder les TOP_N (3) premiers : sidecar.upload_kept = true.
   - Pour les restants : sidecar.upload_skipped = true + delete fichier HEIC + delete sidecar.
   - Si TOP_N == 0 (cas dégénéré, burst vide après dédoublonnage) : noop.
4. Promesse "au moins 1 photo livrée" :
   - Si tous les items du burst sont score_failed → on garde TOUS les items
     (failsafe : pas de tri possible, on n'élimine rien).
   - Sinon, par construction de l'étape 3, on garde toujours au moins 1 item
     (le meilleur), même si son scoreComposite est très bas. On ne supprime
     JAMAIS le top-1 du burst.
```

### 5.3 Constantes proposées

```text
PASSAGE_KEEP_TOP_N_MOBILE = 3        // tri local
BURST_REDUCE_DELAY_MS     = 8 000    // garde-fou : on attend pas plus de 8s
                                     // qu'un dernier shot d'un burst soit scoré
                                     // (un MAX_BURST_SHOTS=15 à 5 ph/s prend ~3s,
                                     // 8s c'est large + marge)
MIN_SCORE_ABSOLU          = 0.0      // PAS de seuil absolu en v1 — on garde top-N
                                     // toujours, même si scoreComposite=0.05
                                     // (cf promesse #6)
```

→ **Pas de couperet absolu**. On ranke à l'intérieur du burst. La « moins pire » d'un burst raté est uploadée, parce que c'est ça que le user a tranché.

### 5.4 Effet sur le volume (vs audit)

Rappel scénario B de `AUDIT_CAPTURE.md` (1500 coureurs × 3 passages, ~8 photos/passage = 36 000 photos brutes, 90 Go) :

| Étape | Photos uploadées | Volume R2 | Coût AWS (1 face) |
|---|---:|---:|---:|
| Aujourd'hui | 36 000 | 90 Go (puis purge top-3 → 33 Go) | ~108 $ |
| Avec tri local TOP_N=3 | **13 500** | **33,75 Go** (pas de double purge nécessaire) | **~40 $** |
| Avec tri local TOP_N=2 | 9 000 | 22,5 Go | ~27 $ |

Gain : **~62 % de bande passante d'upload, ~62 % de coût AWS, ~62 % de stockage R2 dès l'upload**.

---

## 6. RATTRAPAGE PENDANT L'AFFLUX

Confirmation explicite des règles du jeu :

| Situation | Comportement |
|---|---|
| Scorer en retard de 30 photos pendant un peloton | OK. Files (raw/ disque) grandit. Capture continue à pleine cadence. |
| Scorer rattrape pendant 10 s d'accalmie | OK. Le réducteur déclenche dès qu'un burst est complet. |
| Upload bloqué (4G saturée) + scorer en retard | OK. Aucun couplage : le scorer tourne off-line, l'upload se débloque indépendamment. |
| App tuée pendant que la scorer queue contient 50 photos | OK. Sidecars `scored=false` au cold start → re-scorés via processQueue normal (déjà offline-safe). |
| Burst de 15 photos dont 14 sont scorées + une perdue (HEIC corrompu) | À 8 s, timeout déclenche le réducteur sur les 14 photos. La 15e est ignorée (cleanée par la sweep d'orphelins prévue à l'étape 2 du doc parent). |
| Tri prend 500 ms par photo (vieux iPhone) | OK. Queue grandit pendant la course, rattrape la nuit. Aucune photo perdue. |

**La capture n'attend jamais le tri.** Le réducteur est éventuellement-consistant : il fait son travail dès qu'il peut, et c'est OK parce que la décision « top-N par burst » est purement locale au burst et indépendante du temps.

---

## 7. DÉCOUPAGE EN SOUS-ÉTAPES (du moins risqué au plus risqué)

Chaque sous-étape est livrable, testable, et **revertable** indépendamment.

### Sous-étape A — Module natif scorer (sans wiring)

**Risque** : 🟢 faible (code isolé, jamais appelé).
**Livre** :
- `plugins/PhotoQualityScorer.swift` + `.m` + Expo config plugin.
- Méthode RN `PhotoQualityScorer.scoreRaw(srcPath)` qui retourne `{ faceCount, faceConfidence, biggestFaceArea, biggestFaceCenter, yaw, pitch, eyesOpen, eyesOpenApplicable, brightness, faceCaptureQuality, elapsedMs }` — signaux **bruts**, pas de scoreComposite côté natif.
- Pas d'appel depuis JS.

**Test** : aucun appel JS encore. La compilation seule est l'acceptation.

**Régression possible** : aucune (jamais invoqué).

---

### Sous-étape B — Wiring scorer dans `processQueue`, écriture sidecar, **upload non modifié**

**Risque** : 🟡 modéré (ajout d'une étape dans le worker serial existant).
**Livre** :
- `processQueue` appelle `scoreRaw` avant `burnMetadata`.
- Écrit `sidecar.score = {...signaux bruts}` + `sidecar.scored_at = ts`.
- Sur exception / timeout 5 s : `sidecar.score_failed = true`, pipeline continue inchangé.
- **Toutes les photos continuent d'être uploadées.**

**Test** : capture normale, sidecars contiennent `score.faceCount`, `score.faceConfidence`, etc. cohérents. Aucune régression latence capture.

**Régression possible** : scorer qui plante systématiquement → processQueue ralenti. Mitigation : timeout + failsafe.

---

### Sous-étape C — `postScoreReducer` + `upload_kept` / `upload_skipped` flags, **upload encore non filtré**

**Risque** : 🟡 modéré (premier code qui décide qui dropper, mais flag seulement).
**Livre** :
- Nouveau `qualityReducer` (worker JS, tick 2 s).
- Calcule `scoreComposite` à partir des poids courants (cf §F) sur chaque sidecar `scored_at` rempli.
- Regroupe par `burstTs`, applique l'algo §5.2.
- Marque `sidecar.upload_kept = true` ou `sidecar.upload_skipped = true`.
- **Ne supprime rien.** `drainQueue` ignore les flags.

**Test** : capture un burst de 8 photos, vérifier qu'exactement 3 ont `upload_kept = true`, 5 ont `upload_skipped = true`, et que le top-3 visuel correspond. ASSERT « au moins 1 photo par burst kept ».

**Régression possible** : bug de regroupement → tout un burst skipped. Mitigation : invariant codé en dur (le top-1 du burst est TOUJOURS kept).

---

### Sous-étape F — Poids runtime-configurables + télémétrie distribution

**Risque** : 🟢 faible (config + logs).
**Livre** :
- `eventConfig.quality.weights = { faceConfidence, brightness, eyesOpen, faceArea, yaw }` chargeable depuis `/config` (worker) avec fallback aux defaults Swift/JS si absent.
- `eventConfig.quality.faceAreaNorm` (défaut 0.05).
- `eventConfig.quality.topN` (défaut 3).
- `eventConfig.quality.reduceDelayMs` (défaut 8000).
- Logs structurés `[quality]` : per-photo (raw signals + composite) et per-burst (kept/skipped + scores). Stockés en mémoire (session) + visibles en console / dans un éventuel écran debug.
- Nouvelle constante `SCORE_TIMEOUT_MS` (5 000) dans `queue.js`.

**Test** : changer `eventConfig.quality.weights.faceArea` en runtime → vérifier que le tri change sans rebuild. Vérifier que les logs distribution permettent de proposer les jeux E.

**Régression possible** : config malformée → fallback aux defaults silencieux (Zod-like guard). Mitigation : invariant Σ(poids) ∈ [0.9 ; 1.1] sinon ignore et fallback default.

---

### 🛑 STOP — VALIDATION AVANT SOUS-ÉTAPE D

À ce stade, **aucune photo n'a encore été dropée**. La branche `feat/capture-v2` est mergeable telle quelle : si on s'arrête là, l'app est strictement plus fiable qu'aujourd'hui (étape 1) + observable (B, C, F donnent les scores et le tri théorique, sans rien jeter).

**Avant D** :
1. Je présente le diff complet de D.
2. Je présente 2 tests reproductibles :
   - **Test failsafe « toutes basses »** : burst où toutes les photos scorent 0.05 → le réducteur garde **1** (la max, même = 0.05). 0 photos kept = échec.
   - **Test failsafe « scoring KO »** : burst où toutes les photos sont en `score_failed = true` → on garde **TOUTES** (failsafe). N photos kept = N (= taille burst). Aucun skip.

Validation utilisateur requise.

---

### Sous-étape D — `drainQueue` respecte `upload_skipped` + cleanup disque (NON CODÉE)

**Risque** : 🟠 plus élevé (premier changement de comportement utilisateur).
**Livre** (proposition à valider) :
- `drainQueue` skip les items `upload_skipped = true`.
- Après confirmation que tous les `upload_kept` du burst sont uploadés (`status='confirmed'`), supprime les `upload_skipped` du disque + sidecar.
- `upload_skipped` reste tracé en log (compteur `lostByQualityCount` distinct du `lostCount`).
- Feature flag `eventConfig.quality.dropEnabled` : si `false`, drainQueue ignore les flags et upload tout (kill switch sans build).

**Bénéfice seul** : c'est l'étape qui livre vraiment la cible. Réduction ~60 % du volume / coût AWS.

---

### Sous-étape E — Calibrage des poids (NON CODÉE)

**Risque** : 🟢 faible.
**Livre** : 2-3 jeux de pondérations proposés sur la base des logs de F, validation utilisateur, écriture dans `worker /config` ou dans le code mobile.

---

## 8. CE QUI CHANGE — VUE PAR FICHIER

### Côté mobile (`~/WillApp`)

| Sous-étape | Fichier(s) | Nature |
|---|---|---|
| A | `plugins/PhotoQualityScorer.swift` (NEW) | ~250 LOC, scorer natif |
| A | `plugins/PhotoQualityScorer.m` (NEW) | ~30 LOC, RCT bridge |
| A | `plugins/with-photo-quality-scorer.js` (NEW) | ~25 LOC, Expo config plugin |
| A | `app.json` | ajout plugin |
| B | `App.js` ou nouveau `src/services/qualityScorer.js` | wiring dans `processQueue` |
| B | `src/services/storage.js` (sidecar) | champ `score` + `scored_at` + `score_failed` |
| C | nouveau `src/services/qualityReducer.js` | tick réducteur + flags |
| C | `src/constants/queue.js` | `PASSAGE_KEEP_TOP_N_MOBILE`, `BURST_REDUCE_DELAY_MS` |
| D | `App.js` (ou `backgroundUploader.js`) | `drainQueue` skip `upload_skipped` |
| D | `App.js` UI | compteur « triées localement » |

### Côté worker

**Aucun changement.** Le worker continue à recevoir des photos avec son protocole actuel et à faire son tri top-3 par-dessus, ce qui devient quasi no-op (les photos arrivées sont déjà triées). C'est intentionnel : zéro couplage, on peut désactiver le tri mobile et le worker reprend la main.

### Côté UI dashboard

**Aucun changement immédiat.** On expose plus tard un compteur « triées localement / N totales capturées » dans le sidecar event si besoin.

---

## 9. CRITÈRES DE SUCCÈS

À la fin de la sous-étape D :
- ✅ Sur un burst de 8 photos, R2 reçoit 1 à 3 photos (jamais 0).
- ✅ Sur un burst dont aucune photo n'est « bonne », R2 reçoit exactement 1 photo (la moins pire).
- ✅ Aucune mesure de latence capture (`takePhoto resolved ${dt}ms`) ne dégrade vs baseline étape 1.
- ✅ `lostCount` reste à 0 sur un event normal.
- ✅ `lostByQualityCount` est positif et cohérent.
- ✅ La queue scorer ne fait jamais grossir `pendingDir` au-delà des garde-fous existants pendant une session 2 h continue.

---

## 10. CE QUE CETTE CONCEPTION NE COUVRE PAS

- Le tri **inter-bursts** : si le même coureur déclenche 3 bursts (3 passages mobiles), on garde 3 × 3 = 9 photos avant le filtrage worker. Le worker top-3 par 30 s nettoie ce surplus, donc l'effet final est borné.
- La **détection « ce coureur a déjà été pris au km 12 »** : c'est serveur-only (besoin du runner_id et du multi-photographe).
- Le **tri par photogénie / dossard visible / sourire** : on reste sur netteté + visage. Pas de scope feel.
- La **suppression d'une photo après upload** parce qu'on a changé d'avis : tout drop est avant upload, par construction.

---

## 11. STATUT DE VALIDATION

| Décision | Statut |
|---|---|
| Découpage A → F + STOP avant D | ✅ validé 2026-06-26 |
| 5 signaux retenus (cf §4.1) | ✅ validé 2026-06-26 |
| Poids défaut : `faceConfidence=0.40 / brightness=0.27 / eyesOpen=0.13 / faceArea=0.10 / yaw=0.10` | ✅ validé 2026-06-26 |
| Passage = burstTs côté mobile | ✅ validé |
| TOP_N = 3, pas de seuil absolu | ✅ validé |
| Tous poids paramétrables runtime via `eventConfig.quality.weights` (sous-étape F) | ✅ validé |
| Validation D bloquée derrière test failsafes (cf §7 STOP) | ✅ validé |

Prochain commit : code de la sous-étape A.
