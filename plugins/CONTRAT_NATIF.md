# Contrat des modules natifs

Spécification des modules natifs de Will. **Toute implémentation — iOS
aujourd'hui, Android demain — doit respecter ces signatures à l'identique.**
Un écart silencieux (unité, repère, casse d'une clé) produit deux
comportements différents sans la moindre erreur : c'est le mode de panne
qu'il faut rendre impossible.

Source de vérité côté JS : `src/services/capabilities.js`.

---

## Principe : le natif mesure et exécute, le JS décide

Aucun module natif ne contient de seuil, de règle ou d'arbitrage. Il expose
une mesure brute ou applique un ordre reçu. Toute décision vit dans un module
JS pur, testable, piloté par `/config`.

**Pourquoi c'est structurant.** Une décision descendue dans le natif devrait
être écrite deux fois (Swift + Kotlin) et testée zéro fois. C'est exactement
ce que l'architecture actuelle évite : `lineTrigger.js` (16 paramètres,
9 tests) et `framingGuide.js` (18 tests) sont communs aux deux plateformes,
et leurs tests protègent iOS et Android d'un seul coup.

Deux exemples déjà en place, à imiter :

| Module | Ce qu'il fait | Ce qu'il ne fait PAS |
|---|---|---|
| `HumanDetectorPlugin` | renvoie les bbox brutes | aucun seuil de confiance, aucun filtre de taille |
| `ExposureReaderPlugin` | applique le cap qu'on lui donne | ne choisit pas entre 1/1000 et 1/500 — c'est `App.js`, d'après `/config` |

**Règle de revue :** un nombre magique dans un fichier `.swift` / `.kt` est un
bug d'architecture, pas un détail. Les seuls tolérés aujourd'hui sont
`kProgressThrottleS = 0.2` et `HTTPMaximumConnectionsPerHost = 6`
(`BackgroundUploader.m`) — les deux devraient remonter dans `/config`.

---

## Conventions transverses

- **Repère image** : origine en **haut à gauche**, coordonnées normalisées
  `[0,1]`. Apple Vision travaille en bas-à-gauche : `HumanDetectorPlugin`
  fait déjà la conversion (`cy = 1 - midY`). ML Kit renvoie des pixels dans
  le repère haut-gauche — **il faudra diviser par la taille de l'image**.
- **Temps** : secondes flottantes, horloge **monotone du buffer** (pas
  l'horloge murale — le tracker ne consomme que des différences, et la gigue
  de dispatch fausserait les vitesses).
- **Absence de module** : jamais de crash. `capabilities.js` renvoie `false`,
  le JS dégrade. Une seule exception, `faceDetection` : sans elle il n'y a pas
  de produit.
- **Aucun paramètre en dur.** Tout arrive par arguments JS ou `/config`.

---

## 1. `detectHumans` — frame processor **(bloquant)**

Détection de visages sur le flux caméra. Alimente `lineTrigger.js`.

**Entrée** — `{ axis: 'midX' | 'midY', zoneWidthPercent: number }`
`axis` sélectionne l'axe de filtrage selon la lentille (l'ultra-wide et le
wide 1x ne cadrent pas pareil). `zoneWidthPercent` ∈ `[0,1]`, clampé.

**Sortie**

```js
{
  count: number,     // visages DANS la bande centrale (filtrés par axis+zone)
  ts: number,        // horloge buffer, secondes
  faces: [ { cx, cy, w, h } ]   // TOUS les visages, zone comprise ou non
}
```

> `count` et `faces.length` ne sont **pas** interchangeables et c'est
> volontaire. `faces` contient tout : le tracker doit voir un coureur
> *approcher* pour disposer d'une vitesse au moment où il franchit la
> première ligne. `count` ne compte que la bande centrale et sert à la garde
> statique historique.

**Android** — ML Kit Face Detection, mode `FAST`, `performance` sans
landmarks ni classification (on n'utilise que la bbox). Convertir les pixels
en normalisé, et `ts` depuis le timestamp de l'`ImageProxy`, pas
`System.currentTimeMillis()`.

---

## 2. `readExposure` — frame processor

Double rôle : lecture seule de l'exposition, **et** application d'un cap de
vitesse d'obturation.

**Entrée (optionnelle)** — `{ setCapSeconds: number, brightnessLabel: string }`
Présents : applique le cap. Absents : lecture pure. Dédupliqué en interne
(pas de réécriture si identique au dernier appel), l'appelant tape à 1 Hz.

**Sortie** — `{ iso, shutter, brightness }` ou `null` si indisponible.
`shutter` en **secondes** (pas un dénominateur). `brightness` est l'APEX
Brightness Value EXIF.

**Android** — `CaptureResult.SENSOR_SENSITIVITY` / `SENSOR_EXPOSURE_TIME`
(nanosecondes → **diviser par 1e9**). Le cap passe par
`CONTROL_AE_TARGET_FPS_RANGE` ou le mode manuel.

> ⚠️ **Le point dur du portage.** Le contrôle manuel d'exposition exige
> `INFO_SUPPORTED_HARDWARE_LEVEL >= FULL`, que beaucoup d'appareils milieu de
> gamme n'ont pas. À vérifier sur les appareils cibles **avant** de
> s'engager : c'est ce qui décide si l'architecture de capture tient telle
> quelle sur Android.

---

## 3. `BackgroundUploader` — NativeModule + events

Upload qui survit à l'app minimisée.

```
enqueueUpload(url, filePath, headers, itemId) -> Promise
getActiveUploads() -> Promise<string[]>
```

**Events** — `BackgroundUploaderComplete`
`{ itemId, success, statusCode, error }`, et `BackgroundUploaderProgress`.

Le contrat réel est plus subtil que la signature : `enqueueUpload` résout dès
que **la tâche est créée**, pas quand l'upload finit. Le résultat arrive par
l'event, que `backgroundUploader.js` réconcilie via la map `pendingBgUploads`.
Une implémentation qui résoudrait à la complétion casserait `drainQueue`.

**Android** — `WorkManager` + `OneTimeWorkRequest`, contrainte réseau.
Modèle différent (persisté en base, rejoué après redémarrage) : c'est un
avantage, mais l'`itemId` doit survivre au process.

**Absent** → `drainQueue` retombe sur `fetch`. Déjà implémenté, testé.
**Un Android v1 peut sortir sans ce module.**

---

## 4. `PhotoMetadataBurner` — NativeModule

```
burnMetadata(srcPath, dstPath, label, exifJson) -> Promise
enumerateFormatsForLens(lensName) -> Promise
```

Grave le dossard et l'EXIF, ré-encode, fixe l'extension de sortie.
**C'est lui qui produit le `.heic` final** sur iOS.

**Android** — `ExifInterface` (androidx) + `Canvas` pour l'incrustation.
Sortie **JPEG** : le support HEIC est trop variable.

> 💰 **Conséquence directe :** les photos Android seront ~2× plus lourdes à
> qualité égale. Impact sur le stockage R2 et la bande passante, à budgéter.

**Absent** → la photo part brute, sans dossard.

---

## 5. `ThermalMonitor` — NativeModule + event

```
getThermalState() -> Promise<{ state, ts }>
```

`state` ∈ `nominal | fair | serious | critical`. Event `ThermalStateChanged`.

Sert uniquement à moduler la concurrence d'upload
(`concurrencyForThermal` : 3 / 3 / 2 / 1). La capture reste à cadence pleine —
on préfère ralentir le drain qu'un arrêt thermique caméra en plein peloton.

**Android** — `PowerManager.getCurrentThermalStatus()`, **API 29+**.
Mapper les 7 niveaux Android sur les 4 d'iOS.
**Absent** → concurrence fixe à 3.

---

## 6. `PhotoQualityScorer` — **ne pas porter**

```
scoreRaw(srcPath) -> Promise
```

À supprimer, y compris sur iOS, dès que le déclenchement par lignes est
stabilisé. Deux raisons vérifiées :

1. Le `quality_score` utilisé par le serveur est calculé **côté worker**
   (`processPhotoAsync`, via Rekognition DetectFaces), pas par ce module.
2. Le déclenchement par lignes le court-circuite déjà (`item.lineTriggered`).

Contient `MAX_ANALYSIS_DIMENSION = 800` — seule constante métier restée dans
le natif, et elle disparaîtra avec le module.

---

## 7. Patches VisionCamera — **hors contrat**

`with-shutter-lock` et `with-heic-capture` ne sont pas des modules : ils
**patchent le code source de VisionCamera** dans `node_modules`.

Ils ne s'alignent pas et resteront deux implémentations distinctes. Chaque
montée de version de VisionCamera peut les casser — les deux échouent
bruyamment si l'ancre a bougé, ce qui est le comportement voulu.

C'est le prix du contrôle fin du capteur. Ne pas chercher à factoriser.

---

## Le piège à connaître : `/config` filtre en silence

Les paramètres partagés transitent par `GET /config`, mais le worker ne sert
que les clés déclarées dans `defaultGlobalConfig()` (`worker/index.js`) —
`mergeWithDefaults` ignore les autres.

**Une clé oubliée est stockée dans R2 et jamais servie à l'app.** Sans erreur,
sans log. C'est arrivé le 2026-08-05 avec `linesShadow` / `linesEnabled` :
le flag était bien enregistré, l'app ne l'a jamais vu.

Avec deux plateformes ce bug devient bien plus vicieux : il peut produire
**deux comportements différents** entre iOS et Android, sans rien signaler.

> **Toute nouvelle clé `camera.*` doit être ajoutée à `defaultGlobalConfig()`
> dans le même commit que le code qui la lit.**
