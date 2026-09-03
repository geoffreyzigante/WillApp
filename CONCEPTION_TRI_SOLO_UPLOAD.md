# CONCEPTION — Tri à l'upload en mode SOLO

Statut : à valider AVANT toute implémentation. Aucun code, aucun deploy.
Branche cible pressentie : nouvelle branche depuis `feat/cleanup-technique`
(WillApp) — ne pas forker sur `feat/capture-v2` qui est mort depuis la refonte
Apple Vision.

Sources auditées (état 2026-07-20) :
- `App.js:823` (Vision callback), `App.js:842-843` (kick burst),
  `App.js:1274,1292-1311` (reducer tick), `App.js:1594,1626,1800,1341-1342`
  (drain kicks), `App.js:1836-1841` (drain filter), `App.js:2037-2064`
  (cleanup local), `App.js:2242,2280-2367` (captureBurstLoop, cap 15).
- `src/services/qualityReducer.js:170-302` (reduceBurst), `:329` (allRipe),
  `:261` (isMulti = maxFacesInZone >= 2).
- `src/constants/queue.js:44` (`PASSAGE_KEEP_TOP_N_MOBILE=3`), `:49`
  (`BURST_REDUCE_DELAY_MS=8000`), `:53` (`QUALITY_REDUCER_TICK_MS=2000`).
- `worker/index.js:238-293` (`/list-public`, filtre `isPhotoPassageActive`),
  `:6319-6415` (`/personal-gallery` + cap burst-friends), `:7312-7433`
  (cron `scorePassagesCron`, fenêtre 30 s, top-3 par (photographer, runner)).

---

## RÈGLE PRODUIT

- **Solo (0-1 visage in-zone sur tout le passage)** : mitrailler comme
  aujourd'hui (le hardware décide la cadence, cap 15 par burst reste),
  n'UPLOADER que les 3 meilleures par PASSAGE. Les autres ne quittent
  jamais le disque local.
- **Peloton (≥2 visages in-zone à un moment quelconque du passage)** :
  garder toutes les photos in-zone (comportement `qualityReducer.js:264-266`
  actuel). Cap MAX_BURST_SHOTS=15 déjà en place.
- **Failsafe absolu** : jamais 0 photo uploadée pour un passage. Si le
  scoring échoue (composite = FAILED_SCORE sur tous les items, ou score
  max sous seuil), on uploade au moins top-1 en secours. Priorité
  produit : **ne jamais louper un coureur**.

---

## 1. ÉTAT ACTUEL — pourquoi 15 photos partent sur R2 pour un solo

### 1.1 Le tri MARQUE mais ne GATE pas l'upload

Point d'intervention unique : `App.js:1840`.

```
// filter actuel (App.js:1836-1841) :
uploadable = arr.filter(it =>
     it.processed === true
  && it.status === 'pending'
  && it.upload_skipped !== true       // <-- undefined !== true est TRUE
  && (!it.nextAttemptAt || it.nextAttemptAt <= now)
);
```

`undefined !== true` = `true`. Un item pas encore décidé par le reducer
passe le filtre. Il n'y a **pas d'attente** que le reducer décide.

### 1.2 La race qui laisse fuir les 15

Timeline vécue pour un burst de 15 shots :

- t=0 à t≈3 s : 15 captures (~5-7 ph/s AVFoundation).
- t=0 à t≈5 s : `processQueue` burn EXIF natif serial (~200 ms/photo),
  chaque completion marque `processed=true` **un par un** et **kicke
  drainQueue** (`App.js:1594, 1626, 1800`).
- t=2, 4, 6 s : ticks reducer (`App.js:1274, QUALITY_REDUCER_TICK_MS=2000`).
  Le reducer attend `allRipe = tous les items ont qualityScore OU délai
  > 8 s` (`qualityReducer.js:144-150, 329`). Tant qu'un shot du burst
  n'est pas scoré, la décision est **différée**.
- **Fenêtre t=0 à t≈5-8 s** : drain voit des items `processed=true` sans
  flag → uploads. Certains partent avant même la 1ère décision reducer.
- t≈5-8 s : reducer marque 3 kept + 12 skipped. Trop tard, 10-15 sont
  déjà uploadés ou en cours.

Le cleanup `App.js:2037-2064` supprime les fichiers LOCAUX des skipped
après confirmation R2 d'un kept du même burst. Aucun `DELETE R2` sur les
skipped uploadés en avance. **La gate d'upload n'existe pas.**

### 1.3 Le passage vs le burst — reducer ignore la notion de passage

`qualityReducer.js:152-162` groupe par `burstTs` (= 1 appel de
`captureBurstLoop`). Un passage physique de 3-4 s produit N bursts
(cap 15 + relaunch, Vision blink, watchdog stale). Chaque burst voit
son propre top-3. Total gardé = 3 × N bursts, pas 3 par passage.

---

## 2. LE "PASSAGE" — regrouper les bursts

### 2.1 Définition retenue

Un **passage** = grappe de bursts consécutifs pour lesquels on estime
qu'ils appartiennent au même événement physique (même coureur qui
traverse la zone).

Signaux disponibles sur mobile (rappel : pas de trackingID Vision côté
plugin natif actuel, cf. `HumanDetectorPlugin.swift:76-106`) :

1. **Gap temporel** entre fin du burst A et début du burst B : `burstTs_B −
   (burstTs_A + span_A)` en ms. Un cap-then-relaunch après cap 15 produit
   typiquement 100-300 ms de gap.
2. **Continuité de bbox** : `biggestFaceCenter` (déjà remonté par
   `PhotoQualityScorer.swift`, consommé `qualityReducer.js:127`).
   Distance euclidienne dernier shot A → premier shot B en coordonnées
   normalisées [0..1].
3. **Nombre de faces in-zone** au cours des deux bursts (déjà remonté via
   `facesInZone`) : si l'un des bursts vaut ≥2, on est en peloton, pas en
   solo — la fusion perd son sens (on garde tout de toute façon).

### 2.2 Règle de fusion proposée

Deux bursts A et B fusionnent en une **grappe** si :

- `gap ≤ GRAPPE_GAP_MAX_MS` (proposé : **500 ms**), ET
- `distance(biggestFaceCenter_A_dernier, biggestFaceCenter_B_premier) ≤
  GRAPPE_BBOX_DIST_MAX` (proposé : **0.15** en coordonnées normalisées),
  ET
- `span_grappe_total ≤ GRAPPE_MAX_SPAN_MS` (proposé : **5000 ms**, garde-fou
  anti-photographe-qui-teste-sur-lui-même).

Tous les paramètres tunables via `/config` worker (miroir de
`sanitizeQualityConfig`, `qualityReducer.js:47-77`).

### 2.3 Doctrine "en cas de doute, ne pas fusionner"

Fusionner deux bursts est **destructif** — si on fusionne 2 vrais
coureurs qui se suivent, l'un perd potentiellement toutes ses photos
(seulement 3 pour la grappe entière, choisies parmi les shots des 2
coureurs, éventuellement uniquement le mieux cadré = le premier).

Ne PAS fusionner est **conservateur** — au pire on garde 6 photos au
lieu de 3 pour un même coureur. Coût gérable (le cron
`scorePassagesCron` refera un top-3 par (photographer, runner) sur 30 s
côté serveur, `worker/index.js:7312-7433`).

**Règle** : chaque critère de fusion doit être positif. Un critère
manquant/ambigu = pas de fusion.

### 2.4 Top-N par grappe (pas par burst)

Une fois les grappes formées :

- **Grappe solo** (`maxFacesInZone < 2` sur toute la grappe) : top-N par
  `qualityComposite` (déjà calculé, `qualityReducer.js:117-136`) sur
  l'ensemble des items de la grappe. `N = PASSAGE_KEEP_TOP_N_MOBILE = 3`
  (`src/constants/queue.js:44`), inchangé.
- **Grappe peloton** : `upload_kept = true` sur tous les in-zone de la
  grappe, comme aujourd'hui.

### 2.5 Ce qui reste par burst vs par grappe

| Chose | Aujourd'hui | Proposé |
|---|---|---|
| `burstTs` | 1 par `captureBurstLoop` | inchangé (identité R2 = `{HHMMSS}_{burstTs}_{idx}`) |
| Décision kept/skipped | par `burstTs` | **par grappe** |
| Cleanup local skipped | par `burstTs` (`App.js:2043-2064`) | par grappe |
| Filtre drain | `upload_skipped !== true` | `upload_kept === true` (cf. §3) |

L'identité R2 ne change PAS. Deux photos gardées d'une grappe peuvent
avoir des `burstTs` différents — c'est déjà géré par le cron worker qui
regroupe sur 30 s côté serveur.

---

## 3. LE RISQUE de l'upload sélectif — sécurisation

### 3.1 Nature du risque

Aujourd'hui, TOUT part sur R2. Rekognition, cron scoring, dashboard orga,
rescan admin : tout peut rattraper une erreur du reducer. Rien n'est
irréversible côté mobile.

Demain, si on gate l'upload sur `upload_kept === true`, une erreur du
reducer (jette la seule photo utilisable) est **irréversible** :
- La photo n'a jamais existé sur R2.
- Le cleanup local supprime le fichier après confirmation d'un kept du
  même burst.
- Aucun rescan côté serveur ne peut ressusciter ce qui n'a jamais été
  uploadé.

### 3.2 Cinq lignes de défense

1. **Failsafes existants du reducer, conservés :**
   - `allFailed` (`qualityReducer.js:177-186`) : tous les items du burst
     en `qualityScoreFailed` → garde tout.
   - `no in-zone` (`qualityReducer.js:229-242`) : aucun item avec face
     in-zone détectée → garde tout.

2. **Nouveau failsafe "score max trop bas" :** si le meilleur composite
   d'une grappe solo est < `QUALITY_MIN_TOP_THRESHOLD` (proposé : 0.25,
   tunable /config), passer en mode "keep all" pour la grappe. Un burst
   entier de photos médiocres est probablement un cas où l'on ne peut
   pas discriminer — mieux vaut trop uploader.

3. **Conservation locale des skipped pendant N minutes :** aujourd'hui
   `App.js:2043-2064` supprime dès qu'un kept est confirmé R2. Introduire
   un délai minimum `SKIPPED_RETENTION_MS` (proposé : **10 min**) avant
   `File.delete()`. Un photographe qui remarque qu'il a raté un coureur
   peut disarmer, retirer localement le kill switch (via /config
   `upload.gate_enabled=false`) et re-uploader les skipped du fichier
   disque. Bornes disque conservées (`STORAGE_WARN_BYTES=5 Go`,
   `DISK_CRITICAL_PERCENT=0.95`, `queue.js:29,34`).

4. **Kill switch runtime via `/config`** : nouveau flag
   `upload.gate_enabled` (miroir de `pilote.drop_enabled` déjà présent).
   Défaut `true` post-livraison. Si problème constaté en event live,
   l'orga bascule à `false` côté worker sans redéployer et sans OTA →
   comportement pré-fix restauré (`upload_skipped !== true`).

5. **Log verbose obligatoire à chaque décision** : le log existant
   `[reducer] burstTs=… total=… kept=… skipped=…` (`App.js:1307`) reste,
   augmenté d'un log grappe : `[grappe] span=… bursts=… total=… kept=…
   maxFacesInZone=… mode=solo|peloton|failsafe`. Permet post-mortem sur
   un event : "combien de coureurs ont été livrés avec 0 photo ?" via
   corrélation logs mobile ↔ galerie perso serveur.

### 3.3 Ce qu'on refuse

- Pas de "seuil confiance Rekognition" côté mobile (Rekognition tourne
  côté serveur, arrive trop tard).
- Pas de tracking Vision (`VNTrackObjectRequest`) — dev natif lourd, budget
  séparé.
- Pas de "if in doute upload tout" naïf — annule le gain d'économie.

---

## 4. INTERACTION avec capture-v2 (état actuel)

Rappel `capture-v2` = pipeline actuel déployé : disque source of truth
(`will_pending/raw|processed`), tri local reducer, upload_kept/skipped
en marquage, cleanup local safe. La branche `feat/capture-v2` elle-même
est morte depuis le merge, on parle du pipeline en production.

### 4.1 Ce qu'on GARDE tel quel

- Persistance disque des raws + sidecars (`App.js:1459,1508,1535`) —
  source of truth reste locale, aucun changement.
- `processQueue` natif serial (burn EXIF, encode HEIC final) — aucun
  changement, il continue à tourner sur tous les items capturés.
- `scorePhotoSafely` natif (`App.js:1714`, `PhotoQualityScorer.swift`) —
  aucun changement, on continue à scorer 100% des shots pour alimenter
  le reducer.
- Failsafes existants du reducer (allFailed, no-in-zone).
- Le natif Apple Vision (`HumanDetectorPlugin.swift`) et
  `captureBurstLoop` — inchangés. Le mode continu reste, cap 15 reste.
- Cleanup local `App.js:2037-2064` (skipped supprimés après kept
  confirmé R2) — logique conservée, timing ajusté (cf. §3.2 point 3).

### 4.2 Ce qui CHANGE

- **Réducer devient stateful sur la grappe**, pas seulement sur le
  burstTs (`qualityReducer.js:152-162` → grouping élargi).
- **Filtre drain** : `App.js:1840` passe de `upload_skipped !== true`
  à `upload_kept === true`. Conséquence : items sans flag attendent la
  décision du reducer.
- **Reducer devient bloquant pour l'upload d'un burst.** Latence
  upload d'une grappe solo : min(2 s tick, allRipe) après capture du
  dernier shot de la grappe. Pour une grappe de 5 s de span, l'upload
  démarre à t=5-7 s de la 1ère capture. Acceptable en course amateur
  sans temps réel serré.
- **Cleanup local retardé** de `SKIPPED_RETENTION_MS` (10 min proposé)
  au lieu d'immédiat post-confirmation R2.
- **Un flag `upload.gate_enabled` ajouté à la config /config**, câblé
  dans `App.js` près de `dropEnabled` (`App.js:1834`).

### 4.3 Ce qu'on RETIRE

Rien. Aucune suppression, uniquement des ajouts et le durcissement d'un
filtre existant.

---

## 5. BURST-FRIENDS SERVEUR — redondance ?

Rappel : commit `f33c49a` (worker `feat/cleanup-technique`, déployé
20/07) cap `/personal-gallery` à 3 photos par (runner, burstTs) via
`quality_score` DESC (`index.js:6356-6405`,
`PERSONAL_GALLERY_BURST_CAP=3`).

### 5.1 En solo (post-fix upload gate)

R2 contient déjà 3 photos par grappe (le mobile n'a uploadé que ça).
Chaque photo a matched_user_ids si Rekognition matche.

Burst-friends étend à tous les frères de `burstTs`, cap ramène à 3.
Comme R2 n'en a que 3 (ou moins) → **le cap est neutre en solo**.
Pas un no-op mathématique (il continue à trier par quality_score) mais
sans effet visible sur le compte.

Note : une grappe fusionnée peut inclure 2-3 burstTs distincts. Le
runner voit dans sa galerie perso les 3 photos de la grappe, chacune
avec son propre burstTs. Burst-friends serveur regroupe par burstTs
individuel — 3 buckets d'1 photo chacun → 3 total. Cohérent.

### 5.2 En peloton (post-fix upload gate)

Le mobile continue à uploader tous les in-zone (`upload_kept = true`
sur tous en mode multi, `qualityReducer.js:264-266`). Un burst peloton
= 10-15 photos sur R2. Rekognition matche photo par photo. Certains
shots ratés côté AWS ne se retrouvent pas dans matched_user_ids.

Burst-friends rattrape ces faux négatifs (utile). Cap 3 limite ce qui
est affiché à 3 par (runner, burstTs). Si un peloton produit 15 shots
et Rekognition matche 8, burst-friends étend à 15, cap ramène à 3
par runner. **Utile.**

### 5.3 Verdict

**Garder le cap** dans son état actuel. Utile en peloton, neutre en
solo, aucun coût si les 3 photos sont déjà les bonnes. Aligné avec le
cron `scorePassagesCron` (`PASSAGE_KEEP_TOP_N=3`, `index.js:7310`).

Pas de code à retirer côté worker suite à l'implémentation mobile.

---

## 6. GAIN ESTIMÉ

Hypothèses : passage solo type = 3-4 s en zone, 15 shots (2 bursts cap
15 + relaunch, moyenne 12-15 par passage). HEIC compressé natif ~2-3 Mo
sur iPhone (Deep Fusion 12 Mpx). Rekognition : DetectFaces + 1×
SearchFacesByImage par visage détecté (solo = 1 face → 1 search).

### 6.1 Par passage solo

| Poste | Actuel (15 shots) | Proposé (3 shots) | Delta |
|---|---|---|---|
| Upload egress mobile | ~37 Mo | ~7 Mo | **−80%** |
| R2 storage (12 mois retention) | ~37 Mo × 365j = 13 Go·j | ~7 Mo × 365j = 2.5 Go·j | −80% |
| AWS DetectFaces | 15 × $0.001 = $0.015 | 3 × $0.001 = $0.003 | −80% |
| AWS SearchFacesByImage | 15 × $0.001 = $0.015 | 3 × $0.001 = $0.003 | −80% |
| **Total AWS par passage solo** | **$0.030** | **$0.006** | **−80%** |

### 6.2 Extrapolation event 100 coureurs × 5 passages photographe

500 passages solo au total :

| Poste | Actuel | Proposé | Économie |
|---|---|---|---|
| Egress mobile total | 18.5 Go | 3.5 Go | 15 Go/event |
| R2 stockage à t=0 | 18.5 Go | 3.5 Go | 15 Go |
| R2 stockage sur 12 mois | 18.5 Go × 365j | 3.5 Go × 365j | ~5500 Go·j |
| AWS coût par event | $15 | $3 | **$12/event** |

À l'échelle de 20 events par mois : **~$240/mois d'économie AWS + 300 Go
d'écriture R2 évitée** (donc data transfer entrant + storage évités).

### 6.3 Ce que ça ne change PAS

- Peloton : coût inchangé (comportement inchangé).
- Rekognition SearchFaces sur peloton : 15 shots × N faces = coût
  proportionnel N. Zone d'optimisation séparée si N ×15 explose.
- Cout du cron `scorePassagesCron` : lit customMetadata, aucun appel
  AWS, coût CPU worker négligeable.

### 6.4 Ce qui pourrait dégrader

- **Bande passante intermittente** : les 3 kept sont uploadés en une
  fenêtre courte à t≈5-7 s après le passage (au lieu d'être étalés).
  Peut créer un pic si 5 photographes uploadent leurs 3 en même temps
  après le passage d'un peloton. Backpressure existant
  (`App.js:2321-2325`, MAX_TOTAL_IN_PIPELINE) absorbe.
- **Latence perçue "photo dans la galerie perso"** : passe de "~immédiat"
  à "~5-10 s post-passage" (attente reducer + upload). Non-critique en
  usage course, à documenter.

---

## 7. DÉCOUPAGE en étapes

Chaque étape est **livrable indépendamment**, réversible via
`/config`, et déclarée `production-ready` avant de passer à la
suivante. Aucune étape ne casse la précédente si abandonnée.

### Étape A — Gate d'upload strict (mini-risque)

**Change** : `App.js:1840` `upload_skipped !== true` →
`upload_kept === true`. Ajoute config `upload.gate_enabled` (défaut
`true`).

**Effet** : les items sans flag attendent le reducer avant upload. Solo
qui reste 2 s = 1 burst = top-3 uploadés (12 skipped, jamais sur R2).
Solo qui reste 3-4 s = 2 bursts × top-3 = **6 uploadés** (12+ skipped).

**Gain** : ~60% du gain final (2 bursts × 3 au lieu de 2 × 15).

**Risque** :
- Latence upload +2 à +8 s (reducer allRipe).
- Failsafes déjà présents → jamais 0 photo par burst.
- Kill switch `upload.gate_enabled=false` restaure comportement pré-fix
  côté worker en 1 PUT `/admin/config`.

**Métrique de validation** :
- Log `[reducer] kept=3 skipped=12 total=15` visible sur burst solo.
- `wrangler r2 object list` : ~3 photos par burstTs solo au lieu de 15.
- Zéro plainte "coureur sans photo" pendant 1 event pilote.

**Durée dev estimée** : 0.5 j (1 fichier, 1 ligne + config flag +
tests).

**Reverse** : revert commit + OTA preview. Immédiat.

---

### Étape B — Fusion multi-bursts en grappe (risque moyen)

**Change** : `qualityReducer.js:152-162` (grouping) → ajoute une passe
de fusion des `burstTs` proches en grappes selon règle §2.2. Top-N
appliqué par grappe.

**Effet** : solo qui reste 3-4 s = 1 grappe = **3 uploadés** (au lieu
de 6 en étape A seule). Cible atteinte.

**Gain** : les 20% de gain restants (2 bursts × 3 → 1 grappe × 3).

**Risque** :
- Faux positif de fusion (2 coureurs proches fusionnés en 1 grappe → 3
  photos partagées → potentiellement 1 coureur perdu).
- Doctrine §2.3 minimise le risque : gap ≤ 500 ms + bbox continue +
  span ≤ 5 s. Une double condition rend un vrai croisement
  quasi-impossible à confondre.
- Cron serveur `scorePassagesCron` est filet ultime : rejette top-3
  par (photographer, runner) sur 30 s. Si mobile fusionne à tort deux
  runners différents, chaque runner récupère top-3 côté serveur (le
  cron voit chaque matched_user_id séparément).

**Métrique de validation** :
- Log `[grappe] bursts=2 span=3200ms mode=solo kept=3` sur solo
  courant.
- Distribution du `bursts` par grappe : histogramme via
  `[quality-summary]` (existant, `App.js:1316-1329`) à étendre.
- Test terrain : 5 coureurs qui se suivent à intervalles variés (1 s,
  2 s, 5 s) → chacun garde ≥ 1 photo.

**Durée dev estimée** : 1.5 j (grouping stateful, tests unitaires
qualityReducer, calibration seuils).

**Reverse** : config `quality.grappeEnabled=false` ou revert commit.

---

### Étape C — Rétention locale + failsafe seuil bas (post-livraison A+B)

**Change** :
- Cleanup local (`App.js:2043-2064`) : ajoute délai
  `SKIPPED_RETENTION_MS = 10 min` avant `File.delete()`.
- Failsafe "score max grappe < 0.25" → keep all (cf. §3.2 point 2).

**Effet** : marge de sécurité si un photographe remarque un coureur
raté (basculement `upload.gate_enabled=false` puis re-drain manuel les
fichiers encore présents).

**Gain** : sécurité, pas économie.

**Risque** : espace disque local (10 min × cadence event = ~100-500 Mo
par photographe max, sous `STORAGE_WARN_BYTES=5 Go`).

**Durée dev estimée** : 0.5 j.

---

### Ordre recommandé

1. **A d'abord seul**. Déploie sur `preview`, teste sur 1 event ou
   session iPhone, valide la stabilité. Rollback trivial.
2. **B après validation empirique de A** (≥ 1 event terrain, logs
   collectés). Ne pas empiler avant preuve que A est stable.
3. **C en filet de sécurité** post-livraison A+B, avant tout event
   payant.

Ne PAS empiler A+B en un seul commit : impossible de discriminer le
gain / cause d'un bug si l'un des deux régresse.

---

## 8. QUESTIONS OUVERTES à trancher AVANT dev

1. **Seuil `GRAPPE_GAP_MAX_MS`** : 500 ms est prudent. Un peloton dense
   (Ironman, marathon) peut avoir des coureurs à ~700 ms d'écart.
   Trop haut → fusion à tort. Trop bas → pas de fusion des
   cap-then-relaunch. Faut-il rendre le paramètre event-scoped
   (marathon peloton = 300 ms, trail = 1000 ms) via
   `event.pilote.grappe_gap_ms` ?

2. **Priorité des matched vs friends dans top-N** (cf. audit
   burst-friends précédent) : la question ne se pose plus si le tri
   mobile fait bien son travail. Marker à confirmer post-livraison.

3. **Notification photographe "vous avez raté X coureurs"** : pas dans
   le scope de cette conception. À faire plus tard basé sur diff
   `matched_user_ids serveur ∪ ancré manuellement` vs
   `follows connus`. Hors sujet ici.

4. **Cible étape B seuils** (`GRAPPE_BBOX_DIST_MAX=0.15`,
   `GRAPPE_MAX_SPAN_MS=5000`) : à calibrer sur données réelles d'un
   event pilote. Sans données on part sur ces valeurs, tunables via
   `/config` sans rebuild.

---

## 9. RÉSUMÉ EXÉCUTIF

- **Problème** : le tri qualité local existe mais ne gate pas l'upload
  (race entre drain kick et reducer allRipe). Les 15 photos d'un burst
  solo partent sur R2 avant que le reducer ait décidé les 3 à garder.
- **Fix produit** : gate `upload_kept === true` (étape A) + fusion
  multi-bursts en grappe (étape B). Solo passe de 15 uploadés → 3
  uploadés par passage.
- **Économie** : ~$12/event AWS + 15 Go R2/event, extrapolable à
  ~$240/mois à 20 events.
- **Ne louper personne** : 4 failsafes préservés/ajoutés + kill switch
  runtime `upload.gate_enabled` + rétention locale 10 min.
- **Burst-friends serveur** : neutre en solo post-fix, utile en peloton.
  À garder tel quel.
- **Découpage** : A (0.5 j, mini-risque), puis B (1.5 j, moyen), puis
  C (0.5 j, sécurité). Aucun empilement, chaque étape reversible
  indépendamment.

Décisions à valider avant dev : §8.
