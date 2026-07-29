# CONCEPTION — DÉCLENCHEMENT PAR LIGNES (3 photos ciblées / coureur)

Statut : **à valider AVANT toute implémentation**. Aucun code.
Remplace la chaîne mitraillage → scoring → tri → gate par un déclenchement
ciblé à la capture. Une seule règle pour solo et peloton.

Sources auditées (état 2026-07-29) :
- `App.js:735,1036-1037,1112-1117` (zone : `zoneSV=0.30` défaut, tunable
  `/config camera.captureZoneWidthPercent`, `axis:'midX'` codé en dur),
  `App.js:823-855` (onHumansDetectedJS, relance), `App.js:2260-2388`
  (captureBurstLoop, MAX_BURST_SHOTS=15, MAX_IN_FLIGHT=3),
  `App.js:2408-2440` (captureOne, takePhoto), `App.js:1852-1858` (gate),
  `App.js:2056-2082` (cleanup skipped conditionné R2 + dropEnabled).
- `plugins/HumanDetectorPlugin.swift` (VNDetectFaceRectanglesRequest,
  bbox calculées puis jetées, retour `["count": filtered]`).
- `plugins/PhotoMetadataBurner.swift:84-85` (enhance/burn désactivés
  20/05/2026 — fast path = recopie octet pour octet).
- `src/services/qualityReducer.js:261` (`isMulti = maxFacesInZone >= 2`),
  `src/constants/queue.js` (caps disque/queue).
- `WILL/worker/index.js` (processPhotoAsync 2-7 appels AWS/photo,
  scorePassagesCron top-3 serveur).
- Docs : CONCEPTION_TRI_SOLO_UPLOAD.md, CONCEPTION_MODE_GUET.md,
  AUDIT_TROP_PHOTOS.md, AUDIT_CAPTURE.md, AUDIT_BATTERIE.md, AUDIT_COUTS.md.

---

## 0. VÉRIFICATION DES CONSTATS DU BRIEF

Chaque constat §6 du brief a été contre-vérifié dans les sources.

| # | Constat | Verdict | Référence |
|---|---|---|---|
| 1 | `main` sans tri (tout part sur R2) | ✅ confirmé | `git show main:App.js:1615-1619` — filtre sans `upload_kept` ; `qualityReducer.js` absent de main |
| 2 | Étape A codée non mergée | ✅ confirmé | commit `67b99c9`, branche `feat/cleanup-technique`, 46 commits d'avance |
| 3 | Coût = photos ENVOYÉES | ✅ confirmé | `worker/index.js:6367` — `processPhotoAsync` sur chaque PUT image |
| 4 | Cleanup conditionné R2 → saturation offline | ✅ confirmé, **+nuance** | `App.js:2061` — exige AUSSI `dropEnabled` (`pilote.drop_enabled`). Offline : rien n'est jamais supprimé |
| 5 | Plugin calcule les bbox et les jette | ✅ confirmé | `HumanDetectorPlugin.swift:86-91` — filtre sur `boundingBox.midX/midY`, retourne count seul |
| 6 | Burn EXIF neutralisé | ✅ confirmé | `enhanceEnabled=false`, `burnEnabled=false` depuis 2026-05-20 |
| 7 | Peloton garde tout | ✅ confirmé | `qualityReducer.js:261-266` |
| 8 | Captures séquentielles, non annulables | ✅ confirmé (commentaires code) | `App.js:2262-2270` |
| 9 | Obturation ≤ 80 ms, Vision domine | ⚠️ plausible, **non mesuré** | tout remonte au commentaire `App.js:2685-2690`. Mesure prévue en M2 (§7) sans code natif |
| 10 | 4032×3024 HEIC ~2,5-3 Mo, speed | ✅ confirmé | `App.js:511-552,2693` + shutter-lock 1/500-1/1000s |

**Deux corrections au brief** :
- L'axe n'est PAS « midX ou midY selon l'objectif » : le call site JS code
  `axis:'midX'` en dur (`App.js:1114`). Les lignes sont donc **verticales**,
  la traversée **horizontale**. Le plugin supporte midY mais il n'est pas utilisé.
- La largeur de zone est **déjà runtime-tunable** via
  `/config camera.captureZoneWidthPercent` → `zoneSV` (`App.js:1036`).
  Précédent direct pour rendre les positions de lignes tunables pareil.

---

## 1. RÈGLE DE DÉCLENCHEMENT — SPÉCIFICATION

### 1.1 Signaux natifs (plugin v2)

`HumanDetectorPlugin` retourne, au lieu de `{count}` :

```
{
  count: Int,                    // inchangé (compat onHumansDetectedJS)
  ts: Double,                    // timestamp frame (ms epoch)
  faces: [{ cx, cy, w, h }]      // bbox normalisées [0..1], TOUS les visages
}                                //   (pas seulement in-zone : le tracker
                                 //   doit voir l'approche avant la zone)
```

Aucun travail Vision supplémentaire : les `VNFaceObservation` sont déjà là.
Coût : sérialisation de ≤ ~10 petits objets par frame. Négligeable.

### 1.2 Suivi des visages (tracker JS)

État par track :

```
{ id, x, y, w, h,            // dernière observation
  vx, vy,                    // vitesse lissée (EMA, alpha=0.5), largeur/s
  lastTs, createdTs,
  lines: Set<int>,           // indices de lignes consommées
  photos: int,               // photos créditées
  staticSince: ts|null,
  coastingSince: ts|null }
```

**Association frame → tracks** (10 fps, N ≤ ~10 : le brute force suffit) :
1. Prédire chaque track : `x' = x + vx·dt`, `y' = y + vy·dt`.
2. Coût d'appariement = distance euclidienne (x',y') → détection.
3. Appariement glouton par coût croissant. Accepté si
   `dist ≤ max(GATE_FACTOR × w_detection, GATE_FLOOR)`.
4. Détection non appariée → **nouveau track** (budget neuf, cf. F3).
5. Track non apparié → **coasting** : il avance sur sa prédiction pendant
   `TRACK_COAST_MS`, puis est clôturé (après check F1, cf. 1.5).

**Franchissement** : pour la ligne d'indice i non consommée, il y a
franchissement quand `sign(x_prev − L_i) ≠ sign(x_curr − L_i)` — positions
réelles OU prédites (le coasting peut franchir). Une ligne consommée l'est
définitivement pour ce track, quel que soit le sens (un aller-retour ne
re-déclenche pas).

### 1.3 Les lignes

Verticales (axe X), définies **en fraction de demi-zone** pour suivre
automatiquement `captureZoneWidthPercent` :

```
L_i = 0.5 + k_i × (zone/2)        k = [-0.45, 0, +0.45]
```

À zone=0.30 : lignes à x = 0.4325 / 0.50 / 0.5675.

Justification du placement asymétrique-serré :
- Ligne centrale = photo « sûre » pour Rekognition (visage plein cadre).
- ±0.45 de demi-zone = variété réelle entre les 3 photos, tout en gardant
  ~7,5 % de largeur entre la dernière ligne et le bord de zone — la marge
  où vivent la fenêtre de crédit et le failsafe de sortie.
- Symétrique : fonctionne dans les deux sens de traversée.

### 1.4 Déclenchement anticipé

À chaque frame, pour chaque track, pour chaque ligne non consommée située
devant lui (dans son sens de marche) :

```
t_cross = (L_i − x) / vx                    // vx en largeur/s
si 0 < t_cross ≤ HORIZON_MS :
    programmer takePhoto à (t_cross − LATENCE_SYS_MS), clampé ≥ 0
```

- `HORIZON_MS = 250` : couvre 2 intervalles Vision + marge. Au-delà, on
  reprogrammera à la frame suivante avec une meilleure estimation.
- `LATENCE_SYS_MS = 50` : constante d'avance (obturation + dispatch).
  Valeur initiale, calibrée en M2 (§7).
- Une capture programmée pour un track dont `photos == 0` n'est **jamais**
  annulée, même si le track disparaît entre-temps.

**Cooldown capteur** : si une capture a été tirée il y a moins de
`CAPTURE_MIN_INTERVAL_MS = 150` ou est déjà programmée à ±75 ms, on ne
programme pas — la capture existante créditera (1.5). Le capteur traite
séquentiellement (~150-200 ms/photo) : ce cooldown fait qu'on ne sature
jamais la file AVFoundation, donc **plus de photos parasites** (les
3 expositions pré-engagées de l'ancien mode disparaissent par construction).

### 1.5 Crédit — la règle qui unifie solo et peloton

Au moment où une capture part (t_fire), pour CHAQUE track dont la position
prédite à t_fire vérifie :

- **dans la zone** : `|x − 0.5| ≤ zone/2`, ET
- **matchable** : `w×h ≥ MIN_FACE_AREA = 0.005` (les visages < 0,5 % de
  l'image ne sont jamais matchés par Rekognition — REKOGNITION_AUDIT /
  consigne terrain AUDIT_EVENT_DIMANCHE:299)

→ `photos++` et consommation de **sa** ligne non consommée la plus proche
de sa position.

Conséquences :
- 1 coureur seul : 3 lignes → 3 photos. Cas dégénéré de la règle générale.
- 5 coureurs groupés : la 1ʳᵉ capture crédite les 5 → chaque capture
  suivante ne se déclenche que pour des lignes encore non consommées →
  **3-5 photos pour le groupe entier**, pas 15.
- Un coureur qui entre en cours de peloton n'est crédité que s'il est
  réellement dans la zone et assez grand — sinon il garde son budget.

### 1.6 Contrainte physique — plafond de photos par traversée

Le capteur traite les captures **séquentiellement** (~150-200 ms chacune,
`App.js:2262-2270`). Le nombre de photos atteignables sur un passage est donc
borné, indépendamment de la géométrie des lignes :

```
photos_max ≈ durée_de_présence_en_zone ÷ CAPTURE_MIN_INTERVAL_MS
```

Garantir 3 photos exige donc **≥ 450 ms de présence**. En prenant le repère
documenté (`CONCEPTION_MODE_GUET.md:139` : vélo ~10 m/s traversant une zone de
~3 m en **300 ms**) :

| Discipline | Vitesse | Présence (zone 3 m) | Photos atteignables |
|---|---|---|---|
| Marche | ~1,5 m/s | 2 000 ms | 3 ✓ |
| Course sur route | ~3 m/s | 1 000 ms | 3 ✓ |
| Trail rapide / sprint final | ~5 m/s | 600 ms | 3 ✓ (juste) |
| **Vélo** | **~10 m/s** | **300 ms** | **1-2 ✗** |

**Conséquence assumée** : à vélo, dans une zone de 3 m, le budget de 3 n'est pas
atteignable. Les 3 lignes sont franchies en ~88 ms, soit sous le cooldown → F2
les collapse en une seule capture. C'est la physique, pas un défaut.

**Correction terrain (2026-07-29)** : la distance de pose réelle est de **2 à
6 m**, et l'objectif est le 1x (§1.8) — la zone vaut donc `0,4 × d`, soit
0,8 m à 2 m et 2,4 m à 6 m. Nettement moins que les 3 m supposés dans
`CONCEPTION_MODE_GUET`. Photos atteignables :

| | 2 m | 4 m | 6 m |
|---|---|---|---|
| Marche 1,5 m/s | 3 | 3 | 3 |
| Course 3 m/s | **1-2** | 3 | 3 |
| Trail 5 m/s | **1** | 2 | 3 |
| Vélo 10 m/s | **1** | **1** | **1-2** |

**Règle** : `distance_min ≈ 1,1 × vitesse` (m, m/s) pour atteindre 3 photos.
La contrainte ne concerne donc pas que le vélo : **à 2 m, même un coureur sur
route n'a pas ses 3 photos**.

**Trois leviers, par ordre de simplicité :**

1. **Guider le placement (retenu)** — reculer élargit la zone sans toucher au
   logiciel, mais reculer réduit aussi la taille du visage donc la
   reconnaissance : les deux contraintes tirent en sens inverse. La distance
   ne peut donc plus être laissée au hasard → **guide de cadrage embarqué,
   §1.8**.
2. **Élargir `camera.captureZoneWidthPercent`** — tunable à chaud, mais
   **bloqué par le couplage §1.7 tant qu'il n'est pas traité**.
3. **Accepter 1-2 photos à vélo** et l'annoncer — repli assumé, aucune
   distance ne satisfait à la fois les 3 photos (11 m) et la reconnaissance.

### 1.7 Couplage zone de capture / zone du scorer — à traiter AVANT M3

`PhotoQualityScorer.swift:169` code en dur `zoneHalfWidth = 0.18`, soit
x ∈ [0,32 ; 0,68], et applique une règle brutale (commentaire ligne 168,
décision event J) : **« si 0 visage dans la zone, on supprime »**.

La zone de **capture** est tunable via `/config` ; celle du **scorer** ne l'est
pas. Aux valeurs par défaut (zone 0,30 → lignes 0,4325 / 0,50 / 0,5675), aucun
conflit. Mais **au-delà de zone ≈ 0,72**, les lignes extrêmes sortent de
[0,32 ; 0,68] : les photos correspondantes sont marquées `skipped-outzone` et
**ne partent jamais** — sans erreur, sans alerte, sans log distinctif.

C'est précisément le réglage qu'appellerait le levier 2 du §1.6 : les deux
corrections se contredisent.

**Résolution retenue** : sortir le reducer du chemin **dès M3** (au lieu de M4).
Coût marginal — un flag et l'initialisation d'un champ. Bénéfice : le couplage
disparaît avant de pouvoir mordre, et le levier 2 redevient utilisable.

### 1.8 Guide de cadrage bénévole — contrôler la distance de pose

**Problème** : aujourd'hui la distance de pose n'est ni mesurée ni guidée. Le
terrain rapporte 2 à 6 m, ce qui fait varier la largeur de zone d'un facteur 3
(§1.6) — donc le nombre de photos par passage, sans que personne ne le sache.
C'est probablement la première source de variance de résultat entre postes.

**Contrainte de conception (décision 2026-07-29)** : le réglage doit se faire
sur **chemin vide**, sans sujet de référence. Le bénévole est seul, il pose le
téléphone avant l'arrivée des coureurs. Toute méthode exigeant quelqu'un dans
le cadre est écartée.

**Méthode retenue — projection du plan du sol.** Aucun capteur additionnel,
aucun sujet :

- **Inclinaison** : le vecteur gravité (CoreMotion) donne le tangage θ de
  l'appareil, précis à mieux que 1°.
- **Hauteur de pose** h : saisie par le bénévole en un geste (présets — posé au
  sol / barrière ~1 m / trépied ~1,4 m).
- **Champ** : `fieldOfView` est exposé par le format AVFoundation actif, donc
  exact par appareil (pas de valeur codée en dur).

Le sol étant supposé plan, **chaque ligne de l'image sous l'horizon correspond
à une distance au sol connue** :

```
d(ligne) = h / tan(θ + α_ligne)
```

où `α_ligne` est l'angle de la ligne sous l'axe optique, déduit du champ
vertical. L'inverse donne la position à l'écran du repère « 3 m ».

**Interface** : un repère horizontal « 3 m » superposé à la preview, qui se
déplace en temps réel quand le bénévole incline ou relève l'appareil. Il
n'a qu'une chose à faire : **poser le repère sur le chemin**. Validation
visuelle immédiate, sur parcours vide.

**Version enrichie** (si le temps le permet) : projeter au sol l'**empreinte
de la zone de capture** (bande centrale de 30 %) sous forme de corridor, avec
la durée de présence estimée à l'allure de la discipline — le bénévole voit
littéralement où le système déclenchera, et si le passage sera assez long
pour 3 photos (§1.6).

**Limites assumées** :
- `d ∝ h` : une erreur de 20 % sur la hauteur saisie donne 20 % sur la
  distance. C'est la principale source d'imprécision, d'où les présets plutôt
  qu'une saisie libre.
- Sol supposé plan. Faux en dévers ou en côte — dégradation progressive, pas
  de rupture.
- Conditionnement médiocre si h < 0,8 m (le repère se tasse vers l'horizon).
  À signaler dans l'interface plutôt qu'à interdire.

**Confirmation a posteriori** : dès les premiers coureurs, la largeur de bbox
du visage (déjà exposée par le plugin v2, §1.1) vérifie l'hypothèse — à 3 m
avec le 1x, un visage adulte occupe ~3,7 % de la largeur d'image. Un écart
durable signale une hauteur mal saisie ou un sol non plan, et déclenche une
alerte douce. La géométrie règle, le visage contrôle.

**Distance cible par discipline** — la cible n'est pas unique, elle arbitre
entre « assez loin pour 3 photos » (§1.6, d ≥ 1,1 × v) et « assez près pour
être reconnu » :

| Discipline | Cible | Photos/passage attendues |
|---|---|---|
| Marche | 2-3 m | 3 |
| Course sur route | 3,5-4 m | 3 |
| Trail / cross | 4-5 m | 2-3 |
| Vélo | 6 m | 1-2 (§1.6, limite physique) |

Si l'event porte sa discipline dans `/config`, la cible en découle ; sinon
défaut 3,5 m. Paramètre `capture.target_face_width` (fraction), tunable.

**Deux temps** :
1. **Réglage, sur chemin vide** : repère géométrique « 3 m » à aligner sur le
   parcours. Seul, sans sujet, avant l'arrivée des coureurs.
2. **Surveillance, en course** : la largeur des visages observés confirme (ou
   non) la distance réglée. Si la médiane sort de la plage cible pendant N
   passages, alerte douce — le téléphone a bougé, ou le flux s'est déporté.

**Bénéfice télémétrie** : logger la distribution des largeurs observées donne
la première mesure réelle de la distance de pose sur un event. Donnée jamais
collectée à ce jour, et prérequis pour calibrer §1.6 autrement qu'au doigt
mouillé.

**Dépendances** : le réglage géométrique ne dépend **ni du plugin v2 ni du
tracker** — seulement de CoreMotion et du `fieldOfView` du format actif. Il est
donc livrable **isolément et en premier**. Seule la confirmation par largeur de
visage attend le plugin v2.

**Valeur propre** : cette fonction corrige un angle mort du dispositif actuel
(distance de pose ni mesurée ni guidée, §1.6) et reste utile **même si le
déclenchement par lignes n'est jamais activé**.

### 1.9 Failsafes, par priorité décroissante

- **F1 — sortie à zéro photo (règle la plus importante du système)** :
  si un track avec `photos == 0` a sa position prédite hors zone à horizon
  150 ms, OU passe en coasting → **capture immédiate, inconditionnelle**,
  ignorant cooldown et limiteur global. La promesse « ne jamais rater un
  coureur » vit ici.
- **F2 — sujet rapide** : plusieurs lignes franchies dans le même horizon
  (vélo ~10 m/s : les 3 lignes sont traversées en ~88 ms, sous le cooldown)
  → UNE capture programmée au franchissement médian, consommation de toutes
  les lignes concernées. **Pas de rattrapage : le passage vaut 1 photo**, cf.
  la contrainte physique §1.6. Ne pas espérer davantage sans élargir la zone.
- **F3 — identité perdue puis retrouvée** : nouveau track = budget neuf.
  Doctrine « en cas de doute, capturer » : sur-capturer un même coureur est
  acceptable, le rater ne l'est pas. L'emballement est borné par F4, et le
  filet serveur (`scorePassagesCron`, cap galerie 3) absorbe les doublons
  côté expérience. Le churn réel est mesuré en M2 avant activation.
- **F4 — limiteur global (remplace MAX_BURST_SHOTS)** :
  `CAPTURES_MAX_PER_10S = 24` en fenêtre glissante. Au-delà, seules les
  captures F1 passent. Couvre : churn d'IDs massif, bug tracker, badaud
  qui clignote.
  **Calibrage** : l'event cible (400 coureurs / 15 min sur la course 3) donne
  un passage toutes les 2,25 s, soit **13,3 captures/10 s** à plein budget.
  Une valeur de 12 mordrait donc en fonctionnement NORMAL. 24 laisse un
  facteur ~2 de marge pour les resserrements de peloton, tout en restant
  très en dessous d'un emballement (mitraillage = 50-70/10 s).
- **F5 — visage statique** (photographe qui se teste, badaud posté) :
  `|v| < V_STATIC = 0.02 largeur/s` pendant `STATIC_MS = 10 s` → budget
  gelé, F1 désactivé pour ce track. Dégelé dès qu'il bouge.
- **F6 — dégradation progressive disque** (remplace l'arrêt net) :
  pipeline > 700 items → `k = [0]` (1 photo/coureur, ligne centrale).
  Disque ≥ 95 % → désarmement (inchangé, `DISK_CRITICAL_PERCENT`).
  On dégrade la redondance, jamais la couverture.

---

## 2. PIPELINE AVAL SIMPLIFIÉ

### 2.1 Ce qui change

```
AVANT : capture ×15-18 → raw/ → scoring natif → burn (recopie) → processed/
        → reducer top-3/rafale → gate upload_kept → drain → cleanup skipped
APRÈS : capture ×3 ciblées → raw/ → RENAME vers processed/ → drain
```

- **Rename, pas réécriture** : `File.move` raw→processed. Le HEIC de
  `takePhoto` contient déjà l'EXIF natif AVFoundation (dont Orientation,
  que le worker lit — `worker/index.js:6738`). Rien à injecter. Le sidecar
  JSON reste (burstTs/idx pour l'identité R2).
- `upload_kept: true` posé **à la création** de l'item : le gate étape A
  reste en place et laisse tout passer — par construction, tout ce qui est
  capturé mérite l'envoi.
- Identité R2 inchangée : `{burstTs}_{idx}` où burstTs = t_fire, idx = 0.
  Le cron serveur regroupe déjà sur 30 s par (photographe, coureur).

### 2.2 Ce qui est retiré du chemin (puis supprimé en M5)

| Composant | Sort |
|---|---|
| `captureBurstLoop` + MAX_BURST_SHOTS + MAX_IN_FLIGHT | remplacés par le scheduler de lignes (code conservé derrière flag jusqu'à M5) |
| `scorePhotoSafely` + `PhotoQualityScorer.swift` | sortis du chemin (M4), supprimés (M5) |
| `qualityReducer.js` (reduceBurst, isMulti, ticks) | idem |
| burn `PhotoMetadataBurner` | bypass par rename (M4) |
| cleanup skipped conditionné R2 | sans objet — plus de skipped. **Le bug de saturation offline disparaît structurellement** |
| Serveur : `processPhotoAsync`, `scorePassagesCron`, cap galerie | **inchangés** — filets conservés, zéro coût AWS additionnel |

### 2.3 Effet chiffré (event 1000 coureurs / 3 courses 15-20 min)

| | Production actuelle | Après lignes |
|---|---|---|
| Photos envoyées | ~15 000 | ~3 000-4 000 |
| Coût infra (Rekognition + R2 12 mois) | ~50 € | ~10-13 € |
| Coureurs couverts hors ligne avant saturation | 60-80 | ~330 (borne = file de 1000, plus le disque) |
| Captures/passage (batterie, disque) | 15-18 | 3 |

---

## 3. PARAMÈTRES

Tous exposés via `/config` (précédents : `camera.captureZoneWidthPercent`,
`upload.gate_enabled`), modifiables sans rebuild ni OTA.

| Clé `/config` proposée | Défaut | Rôle | Justification |
|---|---|---|---|
| `capture.line_offsets` | `[-0.45, 0, 0.45]` | positions (fraction demi-zone) | §1.3 |
| `capture.latency_ms` | `50` | avance de déclenchement | §0 constat 9, calibré M2 |
| `capture.horizon_ms` | `250` | fenêtre de programmation | 2 frames Vision + marge |
| `capture.min_interval_ms` | `150` | cooldown capteur | débit AVFoundation |
| `capture.credit_min_area` | `0.005` | taille min. de crédit | seuil matchabilité Rekognition |
| `capture.gate_factor` / `gate_floor` | `1.5` / `0.10` | tolérance d'appariement | ~1 largeur de visage/frame à allure course |
| `capture.coast_ms` | `300` | survie sans détection | 3 frames Vision |
| `capture.max_per_10s` | `24` | limiteur global (F4) | §1.8 — 12 mordrait en usage normal sur l'event cible |
| `capture.static_v` / `static_ms` | `0.02` / `10000` | gel badaud (F5) | §1.6 |
| `capture.lines_shadow` / `lines_enabled` | `false` / `false` | interrupteurs M2/M3 | §4 |

---

## 4. MIGRATION — ÉTAPES LIVRABLES, CHACUNE RÉVERSIBLE

Aucun empilement : chaque étape validée sur ≥ 1 event ou session terrain
avant la suivante.

### M0 — Revert (✔ fait, 2026-07-29)
`MAX_BURST_SHOTS` restauré à 15, `App.js` identique à HEAD (hash vérifié).

### M1 — Merger l'étape A existante → production
**Réponse à la question 6 du brief : oui, merger d'abord.** Le tri par
rafale est du code écrit, testé sur branche, avec kill switch runtime.
C'est le filet pendant tout le chantier lignes : ~50 € → ~15 €/event dès
maintenant, indépendamment de la suite.
- Dev : 0 j (merge + deploy OTA).
- Rollback : `upload.gate_enabled=false` (1 PUT /admin/config).
- Validation : logs `[reducer] kept=3 skipped=12` sur solo ; R2 ~3-6
  photos/rafale solo ; zéro coureur sans photo sur 1 event.

### M1bis — Guide de cadrage (livrable seul, sans prérequis)
Repère géométrique « 3 m » sur chemin vide (§1.8) : CoreMotion + hauteur de
pose + `fieldOfView` du format actif. Ne dépend ni du plugin v2 ni du tracker.
- Dev : ~1 j. Rollback : flag `capture.framing_guide_enabled`.
- Validation : sur 3 poses réelles au mètre ruban, écart < 25 % entre distance
  affichée et distance mesurée.
- **Valeur immédiate** : c'est aujourd'hui le seul paramètre terrain qui fait
  varier le résultat d'un facteur 3 sans que personne ne le contrôle.

### M2 — Plugin v2 + tracker en mode ombre
Exposer les bbox (§1.1), brancher la **confirmation par largeur de visage**
sur le guide M1bis, et implémenter le tracker + scheduler qui **loggue ce
qu'il AURAIT déclenché** sans rien capturer (`capture.lines_shadow`).
L'ancien pipeline capture normalement, en parallèle.
- Dev : ~2 j (plugin ½ j, tracker 1 j, télémétrie ½ j).
- Produit les 4 chiffres manquants :
  0. **distribution des distances de pose réelles** (via largeurs de visage,
     §1.8) — jamais mesurée, conditionne l'interprétation de tout le reste,
  1. **% de passages multi-visages** (le chiffre le plus important du
     dossier — détermine le gain réel du crédit),
  2. **churn d'identités** (tracks/coureur réel — dimensionne F3/F4),
  3. **latence d'obturation réelle** : diff entre le ts d'appel JS et
     `EXIF SubsecTimeOriginal` de la photo produite par l'ancien pipeline.
     Zéro code natif, même horloge, précision ~10 ms,
  4. **would-fire vs kept réels** : les photos que les lignes auraient
     prises sont-elles celles que le reducer garde ? (corrélation qualité).
- Validation : sur une session terrain, ≥ 95 % des coureurs visibles ont
  3 would-fire ; churn < 2 tracks/coureur ; aucun would-fire sur badauds.
- Rollback : flag off. Aucun impact capture dans tous les cas.

### M3 — Bascule du déclenchement + sortie du reducer
`capture.lines_enabled=true` : le scheduler remplace `captureBurstLoop`
(conservé dans le code, flag-switché).

**Le reducer sort du chemin dans la MÊME étape** (et non en M4), pour la raison
du §1.7 : le laisser en place introduit un couplage silencieux entre la zone de
capture et la zone codée en dur du scorer. Concrètement :
- `upload_kept: true` posé **à la création de l'item** — indispensable, sinon
  le gate (`upload_kept === true`) bloquerait tout envoi.
- Reducer bypassé par le même flag. Le scorer continue de tourner (inutile
  mais inoffensif) ; il sort en M4.

Les deux changements sont couverts par un flag unique, donc restent une seule
unité de rollback — la règle « pas d'empilement » est respectée.
- Dev : ~1 j (branchement scheduler → `captureOne({burstTs: tFire, idx: 0})`
  + init `upload_kept` + bypass reducer).
- Validation : sur 1 event, photos/coureur ∈ [1..4] pour ≥ 98 % des coureurs
  matchés (∈ [1..2] attendu à vélo, cf. §1.6) ; coût AWS/photo constaté ;
  **zéro coureur à 0 photo** ; aucun item resté bloqué sans `upload_kept`.
- Rollback : flag false → comportement M1 intact, à chaud.

### M4 — Simplification aval
Rename au lieu de burn (`pipeline.rename_only`), scorer sorti du chemin.
(`upload_kept` et le reducer ont été traités en M3, cf. §1.7.)
- Dev : ~½ j. Validation : EXIF Orientation présent sur R2 (le worker
  redresse correctement), débit processQueue, batterie.
- Rollback : flags.

### M5 — Suppression du code mort
Après 2 events stables en M4 : reducer, scorer JS+natif, cleanup skipped,
captureBurstLoop, flags devenus inutiles. Pure hygiène, aucun changement
de comportement.

---

## 5. MODES DE DÉFAILLANCE

| Panne | Conséquence brute | Couverture |
|---|---|---|
| Tracker perd un visage en pleine zone | lignes non franchies | coasting 300 ms + F1 à la clôture → ≥ 1 photo garantie |
| Churn d'IDs massif (occlusions, croisements) | sur-capture | F4 borne à 12/10 s ; filet serveur cap l'affichage à 3 |
| Deux coureurs se croisent, IDs permutés | budgets échangés | dégradation douce : l'un 4 photos, l'autre 2 — jamais 0 (F1 par track) |
| Vélo : zone traversée en 300 ms | **1 photo au lieu de 3** | Contrainte physique, pas un bug (§1.6). Levier = placement du téléphone plus en retrait. Accepté et documenté |
| Zone élargie > 0,72 avec reducer en place | photos extrêmes jamais envoyées, en silence | Reducer sorti dès M3 (§1.7). Ne pas élargir avant |
| Vision throttlé (thermique) : 10→5 fps | prédictions vieillies | HORIZON couvre 2 frames à 5 fps ; F1 inconditionnel en dernier recours |
| LATENCE_SYS mal calibrée ±30 ms | décalage 2-5 % largeur à 3 m/s | dans la tolérance de la fenêtre de crédit (±15 % largeur) ; recalibrable /config |
| Badaud immobile dans le cadre | budget consommé pour rien | F5 gèle après 10 s |
| Bug scheduler complet | plus aucun déclenchement | rollback flag → M1 ; à terme, watchdog « armé + visages vus + 0 capture en 30 s » → alerte photographe |
| File pleine (offline long) | perte de couverture | F6 : dégradation 3→1 photo AVANT l'arrêt ; arrêt seulement à disque critique |

Le pire cas structurel du nouveau système : une photo **pas prise** est
irrécupérable, là où l'ancien sur-capturait puis triait. C'est le prix
assumé de la direction (§4 brief). Les compensations : F1 inconditionnel,
budget neuf sur identité douteuse (F3), mode ombre M2 qui mesure le taux
de loupés AVANT toute bascule, et M3 réversible à chaud.

---

## 6. QUESTIONS RESTANT OUVERTES

1. **Calibrage réel des seuils** (`line_offsets`, `gate`, `credit_min_area`,
   `latency_ms`) : à faire sur les logs M2 d'une vraie course, pas en
   chambre. Les défauts proposés sont des points de départ raisonnés.
2. **% multi-visages** : si M2 révèle > 40-50 % de passages multi, le crédit
   devient le mécanisme dominant et ses seuils méritent un raffinement
   (fenêtre de crédit par taille relative plutôt que seuil fixe).
3. **Cadence Vision pendant traversée** (skipMod 3→1 quand un track a des
   lignes en attente) : n'activer que si M2 montre des loupés vélo. Coût
   batterie réel à mesurer alors. **Attention** : ça n'augmente PAS le nombre
   de photos atteignables à vélo — la borne est le capteur (§1.6), pas Vision.
   Ça n'améliore que la précision du placement.

6. **Distance de pose du téléphone** : détermine la largeur physique de la
   zone, donc si la contrainte §1.6 mord réellement. À relever auprès des
   bénévoles, et à transformer en consigne de placement chiffrée.

7. **Présence de `SubsecTimeOriginal` dans l'EXIF** produit par AVFoundation,
   et sémantique du champ (instant d'exposition vs instant de requête). Toute
   la mesure de latence de M2 en dépend. Vérifiable sur **une seule photo**.
4. **Résolution de capture** : hors scope. Ne pas y toucher sans mesure du
   taux de reconnaissance (piège n°5 du brief).
5. **Notification photographe** (« X coureurs sans photo ») : hors scope,
   déjà noté dans CONCEPTION_TRI_SOLO_UPLOAD.md §8.3.

---

## 7. RÉSUMÉ EXÉCUTIF

- **Une règle unique** : suivre chaque visage, 3 lignes verticales dans la
  zone, franchissement = capture anticipée par la vitesse, chaque photo
  crédite tous les visages bien placés. Solo = cas N=1, peloton = N>1.
- **Le budget de 3 est géométrique**, pas compté : une ligne ne se franchit
  qu'une fois. Le garde-fou global passe de « 15 par rafale » à « 24 par
  10 s + capture inconditionnelle de sortie à zéro photo ».
- **Une limite physique est posée** : le capteur étant séquentiel
  (~150-200 ms/photo), 3 photos exigent ≥ 450 ms de présence en zone. À vélo
  (300 ms sur 3 m) le passage vaut 1-2 photos. Le levier est le **placement du
  téléphone**, pas le logiciel (§1.6).
- **Le pipeline aval fond** : plus de scoring, plus de tri, plus de burn,
  plus de cleanup conditionné — et le bug de saturation hors ligne
  disparaît avec lui (60-80 → ~330 coureurs).
- **Coût event 1000 coureurs : ~50 € → ~10-13 €**, sous les deux forfaits
  avec marge.
- **Chemin** : M0 revert ✔ → M1 merge étape A (filet immédiat, 0 dev) →
  **M1bis guide de cadrage** (1 j, sans prérequis, valeur terrain immédiate) →
  M2 mode ombre (2 j, produit les mesures manquantes) → M3 bascule
  **+ sortie du reducer** réversible à chaud → M4 simplification → M5 nettoyage.
- **Décision demandée** : valider M1 (merge + deploy) et le lancement de
  M2. Les seuils du §3 se calibrent sur les données M2, pas avant.

---

## 8. RÉVISION 2026-07-29 (post-relecture)

Corrections apportées après contre-lecture :

1. **§1.6 ajouté** — contrainte physique des sujets rapides. Le document
   promettait 3 photos par passage sans jamais poser la borne
   `présence ÷ intervalle_capture`. À vélo, la cible est inatteignable dans une
   zone de 3 m ; le levier est opérationnel (placement), pas logiciel.
2. **§1.7 ajouté** — couplage entre la zone de capture (tunable) et celle du
   scorer (codée en dur à 0,18). Au-delà de zone ≈ 0,72, perte silencieuse de
   photos. Conséquence : le reducer sort du chemin dès M3, plus en M4.
3. **F4 : 12 → 24 captures/10 s** — 12 mordait en fonctionnement normal sur
   l'event cible (13,3/10 s attendus).
4. **F2 clarifié** — le tableau des défaillances annonçait « 2 photos min. »
   à vélo, en contradiction avec la spec de F2 (une seule capture). C'est bien
   1 photo.
5. **§6 questions 6 et 7 ajoutées** — distance de pose, et vérification de
   `SubsecTimeOriginal` avant de bâtir la mesure de latence de M2 dessus.

**Révision 2, après retour terrain (distance de pose 2-6 m, objectif 1x) :**

6. **§1.6 recalculé** — la zone vaut `0,4 × d`, soit 0,8 à 2,4 m et non 3 m.
   Conséquence : à 2 m, même un coureur sur route n'atteint pas 3 photos. La
   contrainte est générale, pas propre au vélo.
7. **§1.8 ajouté — guide de cadrage bénévole**. Décision produit : la distance
   de pose ne peut pas rester au hasard puisqu'elle arbitre entre nombre de
   photos et qualité de reconnaissance. **Contrainte imposée : le réglage doit
   fonctionner sur chemin vide, sans sujet de référence.** La méthode est donc
   géométrique (gravité + hauteur de pose + champ réel → projection du plan du
   sol), la largeur de visage n'étant qu'un contrôle a posteriori. Livrable
   isolément, avant même le plugin v2.
8. **`SubsecTimeOriginal` abandonné** — vérification écartée. `latency_ms`
   reste à 50 ms comme hypothèse assumée, validée visuellement en M2 (le
   visage tombe-t-il là où on l'a visé ?). À rouvrir seulement si les sujets
   rapides sortent du cadre.
