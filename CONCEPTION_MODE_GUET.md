# CONCEPTION — Mode GUET / ACTIF pour la caméra capture

Branche cible : `feat/capture-v2`. Document de conception, aucun code, aucun deploy.
Statut : à valider AVANT toute implémentation.

## Principe

La caméra (`isActive`) **reste toujours active en foreground** (pas de coupure totale,
cf. AUDIT_BATTERIE.md piste A : sans capteur tiers, couper = aveugle complet).

À la place, deux modes opérationnels, distingués uniquement par **`fps` + `preview`**
(props React de `<VisionCamera>` changeables runtime, switch quasi-instantané — pas de
re-init d'`AVCaptureSession` car le `format` reste constant) :

| Mode | `fps` | `preview` | Frame processor | Vision face/s |
|---|---|---|---|---|
| **GUET** | 5 (fixe) | `false` | actif | ~1.7 (skip 1/3 sur 5 fps) |
| **ACTIF** | 30 (fixe) | `true` | actif | 10 (skip 1/3 sur 30 fps) |

Bascule pilotée par un **state machine** explicite, voir §1.

---

## 1. MACHINE À ÉTATS

Deux états seulement : **GUET** et **ACTIF**. Pas d'état intermédiaire (un seul intermédiaire
"PROBE" a été envisagé pour wake-up court, écarté : `fps` switch est déjà sub-100ms, pas
besoin d'étape supplémentaire).

```
  ┌──────────┐                                         ┌──────────┐
  │          │   count ≥ 1 (visage in-zone détecté)    │          │
  │  GUET    ├────────────────────────────────────────►│  ACTIF   │
  │          │                                         │          │
  │ fps=5    │   45 s sans visage (count=0 continu)    │ fps=30   │
  │ preview= │◄────────────────────────────────────────┤ preview= │
  │  false   │                                         │  true    │
  └────┬─────┘                                         └─────┬────┘
       │                                                     │
       │ État initial au mount écran photographe = GUET      │
       │                                                     │
       │ Stop! manuel (isAutoArmed=false)                    │
       │ ─ rester en GUET (jamais ACTIF même si visage)      │
       │                                                     │
       │ AppState: background → setCameraActive(false)       │
       │ ─ coupure totale (comportement existant inchangé)   │
       │                                                     │
       │ AppState: active → setCameraActive(true), mode=GUET │
       └─────────────────────────────────────────────────────┘
```

### 1.1 Conditions exactes de bascule

**GUET → ACTIF** : déclenché quand `onHumansDetectedJS(count)` reçoit `count ≥ 1` ET
`isAutoArmedRef.current === true`. Une seule frame suffit (pas de débounce sur le passage
vers ACTIF). Bascule immédiate, pas de délai applicatif.

→ Switch effectif côté natif : `fps` 5 → 30 prend ~10-50 ms (re-configure
`AVCaptureDevice.activeMaxFrameDuration`, pas de session restart). `preview` false → true
attache le SurfaceView (~10-30 ms). Total : **~50-80 ms avant que la première frame à
30 fps soit dispatchée**.

**ACTIF → GUET** : déclenché par un timer dédié `activeModeIdleTimer`, armé à chaque
`onHumansDetectedJS(0)`. Si **45 s** s'écoulent sans aucune frame avec `count ≥ 1`,
retour GUET.

→ Switch effectif : ~30-50 ms (fps + preview détachement).

**Pourquoi 45 s** ? cf. §3 (anti-yo-yo).

**Stop! manuel** : `isAutoArmed = false`. Mode reste celui en cours mais **toute bascule
vers ACTIF est inhibée**. Si on est en ACTIF au moment du Stop!, on retombe en GUET au
prochain timeout 45 s naturel.

→ Variante envisagée : Stop! immédiat → GUET force. Écarté : si Stop! est utilisé comme
micro-pause de 5 s, le re-Go! relance ACTIF instantanément si visage présent. Pas de
gain à forcer le passage.

**AppState background** : `setCameraActive(false)` → comportement existant inchangé.
Au retour foreground, `setCameraActive(true)` + reset état mode = GUET (pas ACTIF par
défaut : on ne sait pas si le coureur a continué).

---

## 2. GUET → ACTIF : prouver qu'on ne rate pas l'entrée de zone

### Déclencheur exact retenu

**`count ≥ 1` rapporté par `detectHumans` en mode GUET**, où `count` est le nombre de
visages dont le centre tombe dans la zone capture (`zoneWidthPercent = 0.36` par défaut,
inchangé). Plug-in `HumanDetectorPlugin.swift:81-90` (filtre `c >= zMin && c <= zMax`).

### Cadence Vision en GUET et anticipation

À `fps=5` natif + skip 1/3 du worklet → **Vision tourne ~1.67 fois par seconde**, soit
**1 frame analysée toutes les ~600 ms**.

Coureur trail : 3-5 m/s. Zone capture physique typique (objectif 24-28 mm équivalent à
2-3 m de distance) : **~3-5 m de couloir traversable**, soit **traversée de 1.0 à 1.7 s**.

→ Pendant la traversée, on a **2-3 detections Vision** garanties (1 toutes les 600 ms).
La PREMIÈRE detection tombe dans les **premières 0-600 ms d'apparition dans la zone**.

### Timeline pire cas (entrée de zone juste après une frame Vision)

| t (ms) | Événement |
|---|---|
| 0 | Coureur entre dans la zone. Frame Vision vient de partir avec count=0. |
| 600 | Frame Vision suivante : count=1. `onHumansDetectedJS(1)` → bascule ACTIF. |
| 600+80 | `setMode('ACTIF')` → React state → VisionCamera applique fps=30 + preview=true. |
| 680 | Première frame à 30 fps dispatchée. Worklet → Vision (1/3 skip) → count=1. |
| 680+33 | `onHumansDetectedJS(1)` → `faceInZoneRef.current = true` → `captureBurstLoop()`. |
| 713+50 | `captureOne()` lance `takePhoto` (parallèle, MAX_IN_FLIGHT=3). |
| ~800 | 1ère photo capturée. |

→ **Délai pire cas entre entrée de zone et 1ère photo : ~800 ms.**

Délai moyen (frame Vision aléatoire dans la fenêtre 600 ms) : ~500 ms.
Délai meilleur cas (visage entre juste avant une frame Vision) : ~150-200 ms.

### Combien de photos par traversée ?

Une traversée de 1.5 s en ACTIF (post-bascule), avec `MAX_IN_FLIGHT=3` et `takePhoto`
~150-250 ms par shot en `photoQualityBalance="speed"` :
- Sans le délai pire cas : **5-8 photos** capturées sur la traversée
- Avec le délai pire cas (-700 ms perdues) : **3-5 photos**

`MAX_BURST_SHOTS=15` n'est jamais atteint sur une traversée simple — c'est le cap pour
les pelotons denses (cf. §4).

### Risque résiduel — "rate-t-on l'entrée ?"

**Non, on ne rate pas l'entrée de la zone**, mais on rate les **1-3 premières frames
photo possibles** (300-700 ms) sur le pire cas. Ces frames correspondent en général au
**début de zone** : le coureur n'a fait que 1-2 mètres dedans, son visage est en bord de
zone, pas centré. Le tri local (`facesInZone` + composite center=0.20) aurait probablement
filtré ces photos comme "moins bonnes" de toute façon. **Risque acceptable**.

**Cas qui resterait raté** : coureur ultra-rapide (sprint final, vélo ~10 m/s) traversant
une petite zone (~3 m). Traversée 300 ms. Mode GUET pourrait avoir 0 detection si le
coureur entre juste après une frame Vision (qui revient 600 ms plus tard, donc 300 ms
après que le coureur soit déjà SORTI de la zone). **Cas extrême** ; à monitorer post-event
sur télémétrie.

**Mitigation envisagée mais écartée pour V1** : élargir `zoneWidthPercent` à 0.80 en
GUET (anticipe l'entrée), revenir à 0.36 en ACTIF. Pose un problème : la zone est lue par
le worklet via un `Worklets.SharedValue` (`zoneSV`), donc on peut la changer dynamiquement.
**Garder en tête pour V2** si la télémétrie montre des manqués.

---

## 3. ACTIF → GUET : anti-yo-yo

### Délai retenu : 45 s sans visage

**Pourquoi 45 s** ?
- **Trop court (≤ 10 s)** : entre deux coureurs d'un même peloton lâche (intervalle
  10-30 s), on bascule ACTIF → GUET → ACTIF. Chaque switch = ~100-130 ms de transition +
  perte des 1-3 premières frames du coureur suivant. **Inacceptable.**
- **Trop long (≥ 120 s)** : on consomme ACTIF pour rien après le passage. Le bénéfice du
  mode GUET disparaît sur les phases de calme entre vagues.
- **45 s** couvre :
  - Le peloton lâche (intervalle typique 10-30 s entre coureurs) : on reste en ACTIF du
    premier au dernier sans osciller.
  - Le coureur isolé suivi 30 s plus tard : on est encore en ACTIF, capture immédiate.
  - Au-delà de 45 s sans rien : statistiquement, prochaine vague hors fenêtre courte.

### Hystérésis asymétrique (clé anti-yo-yo)

- **GUET → ACTIF** : 1 frame avec `count ≥ 1` suffit (réactivité prioritaire).
- **ACTIF → GUET** : 45 s CONSÉCUTIVES de `count = 0` (stabilité prioritaire).

→ Asymétrie volontaire : un faux positif vers ACTIF coûte 45 s de mode ACTIF, soit
~45 s × (30 fps − 5 fps) × coût_par_frame. Coût marginal vs économie globale d'un event
4 h.

### Yo-yo en cas d'oscillation visage juste à la frontière de la zone

Cas : un bénévole assis 1 m hors de la zone, mais sa tête oscille légèrement (regarder
l'arrivée, etc.) et entre/sort de la zone à chaque mouvement.

→ Chaque entrée déclenche ACTIF. Le timer 45 s est armé à chaque count=0, et **reset à
chaque count ≥ 1**. Tant que le bénévole bouge un peu sur 45 s, on reste en ACTIF en
continu. Pas d'oscillation, juste un mode ACTIF prolongé pour rien.

**Mitigation envisagée** : compteur "score Stop! depuis N min" pour passer ACTIF →
"ACTIF dégradé fps=15" si trop de temps actif sans burst confirmé. **Écarté V1**, trop
de complexité. À évaluer V2 si télémétrie montre des cas durables.

### Risque résiduel

Si le photographe regarde un coureur arriver en GUET et coupe Stop! parce qu'il croit
que la caméra "n'est pas prête" → bascule manuelle compromise. **Mitigation UX** : afficher
discrètement le mode en cours (badge "Veille" en GUET, rien en ACTIF) pour que le photographe
voie que la caméra surveille toujours.

---

## 4. PELOTON CONTINU — rester en ACTIF tout du long

### Garantie par construction

Le timer ACTIF → GUET est **armé sur la réception d'un `count = 0`** (frame Vision avec
zéro visage) et **reset sur tout `count ≥ 1`**. Tant qu'un visage est détecté à chaque
frame Vision (~10 fps en ACTIF), le timer ne dépasse jamais 100 ms avant d'être reset.

→ Tant qu'il y a un coureur visible dans la zone (même en flux continu), on reste en
ACTIF, **garanti**.

### Cas du peloton dense avec micro-trous (1-2 frames sans visage)

À 10 fps Vision, un trou de 1-2 frames = 100-200 ms sans visage. Le timer s'arme mais
est reset par la frame suivante. **Pas de bascule**.

### Risque résiduel

Aucun. Le seul cas de bascule pendant peloton serait 45 s consécutives sans visage, ce
qui contredit la définition de "peloton".

---

## 5. PERSONNE IMMOBILE DANS LA ZONE (selfie, arrêt)

### Cas typique

Coureur s'arrête dans la zone pour boire / faire un selfie / attendre un copain. Visage
détecté en continu pendant 30 s à 2 min.

### Comportement décidé

**On reste en ACTIF sans timeout** tant que le visage est détecté. Aucun mécanisme de
"timeout max ACTIF" n'est ajouté.

### Pourquoi

- Le tri local `qualityReducer.js` filtre déjà les photos répétées via le top-N par burst
  (et le `dropEnabled=true` actuel jette les non-kept du même burst). Une session selfie
  produit **N bursts indépendants** (chaque burst recommence quand `faceInZoneRef` repasse
  brièvement à false, ce qui n'arrive pas si le visage reste fixe → en réalité **un seul
  burst long** capé à `MAX_BURST_SHOTS=15`).
- Au-delà de 15 shots, `captureBurstLoop` sort sur `'max-burst-cap'` (`App.js:2194`) et le
  prochain shot attend que `faceInZoneRef` repasse à `true` après un `false` (transition).
  Tant que le visage reste statique → **0 nouveau burst lancé**, donc capture inerte ;
  seul Vision continue à 10 fps + caméra à 30 fps.
- **Mode ACTIF continu sans burst = caméra qui tourne pour rien** pendant la session
  selfie. Coût mesurable mais borné (max quelques minutes par cas).

### Coût battery du cas "selfie 2 min"

Vs mode GUET (qu'on n'atteint pas dans ce cas) :
- Surcoût ~10-15 % batterie pendant ces 2 min, soit ~0.3-0.5 % de batterie absolue.
- **Acceptable** vs le risque inverse : si on baisse le mode pendant que le visage est
  encore là, on rate les photos s'il repart soudainement.

### Mitigation envisagée mais écartée

**Idée** : si > 60 s en ACTIF avec `count ≥ 1` constant ET 0 nouveau burst déclenché,
basculer en "ACTIF dégradé fps=15". **Écartée V1** : ajoute un 3ème état, complexifie la
machine pour un cas-bord à faible impact batterie.

### Risque résiduel

Faible (~0.5 % batterie sur événements avec sessions selfies multiples). Pas de risque de
manqué.

---

## 6. PASSAGE HORS ZONE (badaud, bénévole) — limiter les réveils inutiles

### Comportement actuel du plugin

`HumanDetectorPlugin.swift:81-90` **filtre déjà côté natif** : ne retourne que `count` des
visages dont le centre tombe dans `[0.5 − zoneWidth/2 ; 0.5 + zoneWidth/2]` de l'axe
configuré (`midX` en mode actuel). Les visages hors zone **ne remontent jamais** au worklet.

### Comportement retenu en mode GUET

**Aucun changement.** Le déclencheur GUET → ACTIF reste `count ≥ 1` où `count` est déjà
filtré sur la zone. **Badaud hors zone = invisible pour notre trigger** → pas de bascule.

### Conséquence — pas d'anticipation au bord de zone

Un coureur qui approche par le bord (par exemple à 1 m hors zone) n'est pas vu par notre
filtre. On le détecte uniquement quand il ENTRE physiquement dans la zone capture.

Cf. §2 timeline : 0-600 ms entre entrée effective et 1ère detection. Acceptable.

### Mitigation V2 envisagée

**Élargir `zoneSV` à 0.80 ou 1.0 en mode GUET, restaurer à 0.36 en mode ACTIF**. Permet
d'anticiper l'entrée 300-500 ms en avance. Risque : bascule pour rien sur badaud +
captures de badauds par le burst (filtré par `facesInZone` côté reducer → skipped → drop).

**Pas retenu V1** pour rester strictement isofonctionnel sur le périmètre détection-zone.
À évaluer V2 si la télémétrie montre des manqués d'entrée.

### Risque résiduel

Badaud strictement hors zone : **0 réveil intempestif**. C'est le bon comportement
(économie maximale en présence d'un public statique).

---

## 7. FAIBLE LUMIÈRE — fps fixe vs range dynamique

### Option `fps={5}` fixe vs `fps={[2, 30]}` range

VisionCamera 4 accepte `fps?: number | [minFps, maxFps]` (`node_modules/.../CameraProps.ts:196`).
- **Fixe** : framerate constant choisi par l'app.
- **Range** : iOS choisit dynamiquement entre min et max, **en augmentant la durée
  d'exposition par frame en faible lumière** (gain de lumière sans monter ISO).

### Choix retenu pour V1

- **Mode GUET** : `fps={5}` **fixe**. Économie prédictible. Risque accepté en faible
  lumière : le shutter va se rapprocher de 1/5 s = motion blur sur les coureurs en
  mouvement, mais Apple Vision `VNDetectFaceRectanglesRequest` tolère bien le blur
  modéré (jusqu'à ~20-30 px de smear).
- **Mode ACTIF** : pas de prop `fps` (default 30 fps) → comportement actuel inchangé.

### Pourquoi pas de range en GUET ?

Range `[2, 30]` ferait de la conso un paramètre non maîtrisable (en faible lumière, iOS
remonterait jusqu'à 30 fps pour rester en `1/30 s` exposure, perdant tout l'avantage
GUET). À l'inverse, range `[2, 5]` revient à `fps=5` clamp haut, donc équivalent à fixe
sans avantage.

### Risque résiduel

En sous-bois très sombre, motion blur des visages → Vision peut rater. Le coureur entre,
sort, on n'a rien vu. Plus probable en fin d'après-midi automne / hiver. **À monitorer
sur télémétrie : ratio detections GUET vs ACTIF par condition de luminosité.**

Mitigation V2 si terrain confirme : `fps` adaptatif basé sur `liveExposureSamples` (déjà
disponible à 1 Hz) — passer à `fps=10` en GUET si brightness < 0.25.

---

## 8. INTERACTION AVEC L'EXISTANT

### Garde-fou batterie / disque 95% (`DISK_CRITICAL_PERCENT`)

`src/constants/queue.js:33` `DISK_CRITICAL_PERCENT = 0.95`. Quand atteint, l'auto-capture
est désarmée (cf `App.js:1481-1502`). Le mode GUET **est compatible** : `isAutoArmed=false`
→ pas de bascule vers ACTIF, mais la caméra continue à tourner en GUET (5 fps + preview
off). Économie maximisée pour permettre au photographe de drainer la queue avant de
relancer.

→ **Aucune modif nécessaire** sur ce garde-fou.

### Bouton Stop! manuel

`onCapturePress()` (`App.js:2062-...`) toggle `isAutoArmedRef.current`. La nouvelle conception :
- **Stop! pressé** : `isAutoArmed=false`. **Bascules GUET → ACTIF inhibées.** Le mode
  reste GUET en permanence (économie max sans coupure totale).
- **Go! pressé** : `isAutoArmed=true`. Si un visage est déjà dans la zone à ce moment, la
  prochaine frame Vision (~600 ms en GUET) déclenche la bascule ACTIF.

→ **Comportement actuel préservé** : Stop! ne coupe pas la caméra, ne fait que désarmer.
Le mode GUET améliore l'économie sans changer la sémantique du bouton.

### Tri qualité local `facesInZone`

Le scorer `PhotoQualityScorer.swift` tourne **dans `processQueue` post-capture**, sur la
photo HEIC stockée. Indépendant du mode caméra. **Non impacté** par la conception GUET/ACTIF.

### Auto-capture lifecycle (`startSession` / `stopSession`)

`isDetectionEnabledRef.current` est `true` dès mount de l'écran photographe
(`App.js:2052-2059`). Il sera respecté par la machine GUET/ACTIF : si
`isDetectionEnabledRef=false`, on reste en GUET sans bascule possible.

→ **Aucune modif** nécessaire sur le lifecycle existant.

### Bug batterie identifié dans l'audit — frame processor early-return

L'audit `AUDIT_BATTERIE.md §1.2` notait que `detectHumans` tourne même si
`!isDetectionEnabledRef`. **À fixer dans la même sous-étape** que le wiring de la machine
(les deux modifient le worklet).

---

## 9. DÉCOUPAGE EN SOUS-ÉTAPES (du moins risqué au plus risqué)

### Étape A — Quick-wins isolés (préalable, AUCUN état machine)

A.1. Frame processor early-return si `!isAutoArmedSV && !isDetectionEnabledSV` → corrige
le bug audit (~5 lignes, 0 risque).

A.2. `videoStabilizationMode` priorité `'standard'` au lieu de `'cinematic-extended'`
(`App.js:540-546`, 2 lignes, 0 risque).

→ Validable indépendamment, gain immédiat ~10-15 % batterie. **À livrer en premier.**

### Étape B — Mode GUET passif : juste fps + preview, pas de machine

B.1. Ajouter 2 nouveaux state React + sharedValue : `cameraMode` = `'GUET' | 'ACTIF'`,
init `'GUET'`.

B.2. Wire les props `<VisionCamera fps={mode === 'GUET' ? 5 : undefined} preview={mode === 'ACTIF'} />`.

B.3. **Pas de bascule automatique encore**. Bascule manuelle via un toggle dev (debug
button) pour tester le switch fps + preview sur device et mesurer les latences réelles.

→ **Mesure terrain critique** : confirmer que switch fps + preview prend bien < 100 ms
(la conception suppose 50-80 ms). Si > 200 ms, revoir la machine (timeline §2 devient
~1 s pire cas, pas 800 ms).

### Étape C — Machine à états basculée par la détection

C.1. `onHumansDetectedJS(count)` :
- Si mode=GUET ET count ≥ 1 ET isAutoArmedRef → `setMode('ACTIF')`.
- Reset `activeIdleTimerRef` à chaque count ≥ 1 quand mode=ACTIF.
- Si count = 0 quand mode=ACTIF → arme le timer 45 s.

C.2. `activeIdleTimer` callback (45 s) → `setMode('GUET')`.

C.3. Au mount écran, mode=GUET initial. Au unmount, cleanup timers.

→ **Validation par télémétrie** : compter le nombre de bascules GUET↔ACTIF par
session et le temps cumulé en chaque mode. Si > N bascules/h ou < X % en GUET sur un
event calme, ajuster les seuils.

### Étape D — UX badge mode (optionnel mais recommandé)

D.1. Petit indicateur discret dans le header : "● Veille" en GUET, rien en ACTIF.
Pour que le photographe sache que la caméra surveille toujours et ne stresse pas en
voyant le preview off.

D.2. Tap sur le badge → force temporairement ACTIF (15 s) pour vérifier le preview.
Confort UX, n'altère pas la machine.

### Étape E — Optimisations V2 (post-event, après validation terrain)

E.1. Zone élargie en GUET (`zoneSV=0.80` GUET, `0.36` ACTIF) pour anticiper.
E.2. fps adaptatif en GUET selon `liveExposureSamples` (fps=10 si brightness < 0.25).
E.3. État dégradé "ACTIF sans burst > 60 s" → fps=15 (cas selfie).

**Aucune de ces optimisations V2 ne doit être lancée avant la validation E2E V1 sur
un event réel.**

---

## 10. RISQUES GLOBAUX — synthèse

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Rater l'entrée d'un coureur ultra-rapide (vélo, sprint) en GUET | Faible | 1-3 photos manquées au début | Élargir zoneSV en V2 si terrain confirme. |
| Yo-yo ACTIF↔GUET | Très faible | Surcoût marginal | Hystérésis 45 s suffit, validé par construction. |
| Mode ACTIF prolongé inutilement (selfie statique) | Modéré | < 0.5 % batterie | Acceptable V1, état dégradé en V2 si besoin. |
| Switch fps + preview > 200 ms réel | À mesurer | Timeline §2 +400 ms | Validation device en étape B, revoir si confirmé. |
| Faible lumière → motion blur en GUET → Vision rate visage | Modéré (events soir/sous-bois) | Manqué coureur | fps adaptatif V2 si télémétrie confirme. |

**Priorité absolue de la conception : ne pas rater un coureur.** Toutes les valeurs (45 s
hystérésis, fps=5, zone 0.36) sont calibrées pour minimiser ce risque, au prix d'une
économie batterie un peu moindre que ce qu'on pourrait théoriquement atteindre. Le tuning
fin (V2) sera fait sur la base de la télémétrie d'un event réel, pas en spéculation.

---

## 11. TÉLÉMÉTRIE NÉCESSAIRE POUR VALIDER

Compteurs à ajouter (déjà patterné par `recordScore` / `recordBurstReduction` dans
`src/services/qualityTelemetry.js`) :

- `mode_transitions`: { guet_to_actif: N, actif_to_guet: N }
- `time_in_mode_ms`: { guet: ms, actif: ms }
- `actif_no_burst_duration_ms` (P50, P95) — détecte selfies prolongés
- `frame_count_first_detection_after_guet_to_actif` — distribution du délai réel
  (pour validation §2)
- `bursts_per_mode_transition` — bursts capturés par cycle ACTIF (qualifie la pertinence
  de chaque bascule)

À logguer dans le summary 60 s existant (`App.js:1251-1264`).

---

## 12. CRITÈRES D'ACCEPTATION

V1 valide si, sur un event réel de 2 h+ :
- **Aucun coureur connu manqué** (par croisement avec galerie manuelle référence).
- Temps en GUET ≥ 50 % du temps total foreground (sinon l'économie n'est pas réelle).
- Bascules GUET→ACTIF par heure ≤ 1.5 × nombre de passages réels (ratio faux-réveils
  < 50 %).
- Pas de plainte UX "caméra figée" du photographe (sous-entendu : preview off n'a pas été
  vécue comme un bug par l'utilisateur).
- Mesure conso batterie (Xcode Energy Log ou indicateur iPhone) montre une baisse
  significative (objectif : −20 à −30 % par rapport au mode "tout ACTIF" actuel).

Si l'un de ces critères échoue, retour conception V2 avant relivraison.
