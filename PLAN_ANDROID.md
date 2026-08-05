# Plan de passage sur Android

Établi le 2026-08-05, d'après l'état réel du code (`feat/cleanup-technique`).
Prérequis conceptuel : `plugins/CONTRAT_NATIF.md`.

## Le constat qui structure tout

Will est **deux applications dans un binaire** :

| | Coureur | Photographe / bénévole |
|---|---|---|
| Events, selfie, galerie, panier, achat | ✅ | |
| Chaîne de capture | | ✅ |
| Natif custom | **aucun** | 8 plugins iOS, ~1 500 lignes |
| Effort Android | **~5 jours** | **4 à 7 semaines** |

Les 35 dépendances sont toutes cross-platform. **Le blocage est entièrement
dans `plugins/`.** D'où la stratégie : sortir le coureur d'abord, garder les
bénévoles sur iPhone au démarrage, porter la capture ensuite — une fois le
déclenchement par lignes validé sur de vrais events.

> **Décision du 2026-08-05 :** les bénévoles restent sur iPhone *au lancement
> seulement*. Le rôle bénévole sera ouvert aux utilisateurs Android juste
> après. **Le lot 3 n'est donc pas optionnel : il est engagé, seulement
> différé.** Cela change la nature du lot 0 — cf. section suivante.

---

## Le vrai risque : une flotte non maîtrisée

Tant que les bénévoles sont sur iPhone, tu choisis le matériel. Dès que
*tout utilisateur Android* peut devenir bénévole, tu hérites de la
fragmentation complète du marché — et le déclenchement par lignes repose sur
un plancher de **150 ms par photo**, mesuré sur iPhone.

Simulation en rejouant `lineTrigger.js` (zone 0.37, config actuelle) :

```
Vitesse max pour 3 photos (m/s à 4 m)
cooldown |  k=0.45   k=0.60   k=0.75   k=0.90   k=1.00
---------+------------------------------------------------
   150ms |   3.0      4.2 OK   4.4 OK   5.5 OK   5.7 OK
   200ms |   2.4      2.5      2.9      3.5 OK   4.2 OK
   250ms |   1.7      2.3      2.6      3.5 OK   3.3 OK
   300ms |   1.3      1.7      2.2      2.5      2.6
   400ms |   0.9      1.3      1.5      1.8      2.0
   500ms |   0.7      1.0      1.3      1.5      1.7
```

**Au-delà de ~250 ms par photo, aucun réglage ne permet 3 photos sur un
coureur de route à 3 m/s.** Limite physique : le sujet ne reste pas assez
longtemps entre les lignes. En dessous, ça se rattrape en écartant les
lignes (à 200-250 ms : `lineOffsets` ±0.90 au lieu de ±0.75).

Ce seuil **n'exclut aucun appareil** : il marque la frontière entre les
niveaux de capture définis ci-dessous.

### Conséquence : auto-calibration au lieu d'un réglage global

Aujourd'hui `lineOffsets` est une valeur **globale** poussée par `/config`.
Avec un parc hétérogène, une valeur unique est forcément mauvaise pour une
partie des appareils.

Proposition — au premier lancement en mode photographe, l'app :

1. mesure sa **latence de capture réelle** (rafale de 5, médiane des écarts) ;
2. en déduit un **niveau de capture** (ci-dessous) ;
3. applique le `lineOffsets` correspondant.

### Niveaux de capture (décision produit 2026-08-05)

Plutôt que refuser les appareils lents, on **dégrade par paliers**. Vérifié
en rejouant `lineTrigger.js` :

| Niveau | Config | Promesse | Tient jusqu'à |
|---|---|---|---|
| **1** | 3 lignes ±0.90 | 3 photos | **230 ms** |
| **2** | 2 lignes ±0.90 | 2 photos | **530 ms** |
| **3** | 1 ligne centrale | 1 photo | **2 000 ms** |

**Coût de développement dans le tracker : zéro.** Un niveau n'est qu'un
`lineOffsets` de longueur différente, et `computeLines` mappe déjà sur le
tableau. Les 9 tests existants restent valides.

Deux propriétés non évidentes, toutes deux vérifiées :

- **Le niveau 3 ne rate jamais personne** — 1 photo garantie jusqu'à 5 m/s
  sur un appareil à 700 ms, par construction (failsafe F1).
- **Le palier produit de MEILLEURES photos, pas seulement un affichage
  honnête.** À 300 ms, la config 3 lignes donne déjà 2 photos — mais ce sont
  les deux premières lignes franchies, donc deux clichés quasi au même
  endroit. La config 2 lignes donne les mêmes 2 photos, délibérément
  espacées.

### Le niveau dépend de la discipline, pas seulement du téléphone

Photos obtenues avec 3 lignes ±0.90 :

```
latence | Marche 1,4 | Trail 2,0 | Route 3,0 | Vélo 6,0 m/s
--------+------------+-----------+-----------+-------------
  150ms |     3      |     3     |     3     |     2
  250ms |     3      |     3     |     2     |     2
  400ms |     3      |     2     |     2     |     1
  700ms |     2      |     2     |     1     |     1
```

Un appareil à 400 ms est **niveau 1 sur une marche, niveau 2 sur un trail,
niveau 3 sur du vélo**. Le niveau doit donc se calculer à l'entrée dans
l'event, en croisant latence mesurée et `event_type` — déjà présent dans
`event.json`.

**Effet de bord favorable :** moins de photos sur les appareils lents = moins
d'appels Rekognition. Un niveau 3 coûte le tiers d'un niveau 1 par coureur.

**Point de vigilance :** dans un même event, un coureur vu par un niveau 1
aura 3 photos et son voisin 1 seule. Se gère en affichant son niveau au
bénévole et à l'organisateur, pour placer les meilleurs téléphones aux points
clés (arrivée).

C'est le principe habituel — le natif mesure, le JS décide — et ça profite
aussi à iOS : un iPhone 12 et un 16 Pro n'ont pas la même latence, alors
qu'ils reçoivent aujourd'hui le même réglage.

**Charge estimée : 3-4 jours**, à faire **sur iOS d'abord** (où c'est
vérifiable contre un comportement connu), avant tout code Android.

---

## LOT 0 — Spike de faisabilité caméra ⚠️ **GO / NO-GO**

**2 à 3 jours. À faire avant tout engagement sur le lot 3.**

Un APK jetable, hors du repo, qui répond à trois questions sur **les appareils
cibles réels** :

1. Quelle est la latence de `takePhoto` ? *(iOS : ~150 ms, plancher sur lequel
   repose tout le déclenchement par lignes)*
2. `INFO_SUPPORTED_HARDWARE_LEVEL` vaut-il `FULL` ou mieux ? *(sans quoi pas
   de verrouillage de vitesse à 1/1000s — donc du flou sur les coureurs)*
3. ML Kit tient-il 10 fps en détection de visages sans faire chauffer ?

**Critère de sortie** — un tableau latence × modèle, converti en
**répartition par niveau** (combien d'appareils en niveau 1 / 2 / 3) pour
chaque discipline.

> ⚠️ **Le rôle bénévole étant ouvert à tous les Android, l'échantillon ne
> peut pas se limiter à 3 appareils choisis.** Il faut couvrir le milieu de
> gamme, là où la latence se dégrade. La question n'est plus « nos appareils
> passent-ils ? » mais **« quelle proportion du parc réel passe, et que
> fait-on des autres ? »**.
>
> C'est le seul lot qui peut invalider le reste du plan. Le faire en premier
> coûte 3 jours ; le découvrir en semaine 5 en coûte 25.

---

## LOT 1 — Android coureur

**~5 jours. Indépendant du lot 0.** C'est la valeur livrable la plus rapide.

| # | Tâche | Détail |
|---|---|---|
| 1.1 | `expo prebuild -p android` | `app.json` a déjà son bloc `android` (icône adaptative, permissions) |
| 1.2 | Auditer **27 branches `Platform.OS === 'ios'`** | 8 dans `App.js`, le reste en modales. Clavier, safe-area, header. Une seule branche `'android'` existe aujourd'hui |
| 1.3 | Firebase + `google-services.json` | requis par `expo-notifications` (½ j) |
| 1.4 | Arbitrage `expo-blur` | rend nettement moins bien sur Android — flou ou aplat opaque ? |
| 1.5 | Profils EAS Android | `preview` (APK interne) et `production` (AAB) |
| 1.6 | Tests sur 2-3 appareils réels | pas d'émulateur pour valider le rendu |

**Critère de sortie** — parcours coureur complet sur Android : recherche
d'event (y compris par code), compte, selfie, galerie, panier, achat Stripe.

---

## LOT 2 — Compte Play Store

**~1 jour de travail, 2 à 3 semaines de calendrier. À lancer en parallèle du
lot 1 — c'est le chemin critique.**

⚠️ **Décision irréversible, à prendre avant de créer le compte.**

Google impose aux nouveaux comptes **personnels** un test fermé avec
**12 testeurs pendant 14 jours consécutifs** avant d'autoriser la production.
Deux semaines incompressibles.

**Tu as une société (Sarl Zigante) : un compte « organisation » n'est pas
soumis à cette obligation.** Vérifier ce point avant l'inscription — le type
de compte ne se change pas après coup.

Reste : fiche Play Store, captures, politique de confidentialité (celle du
site existe déjà), déclaration « données sensibles » — la reconnaissance
faciale exige une section dédiée dans le formulaire *Data safety*.

---

## LOT 3 — Capture Android

**5 à 8 semaines, sous réserve du GO du lot 0.** Nécessite Kotlin + Camera2.
**Engagé, pas optionnel** (décision du 2026-08-05).

Ordre imposé par les dépendances :

| Étape | Module | Charge | Note |
|---|---|---|---|
| 3.0 | **Auto-calibration + niveaux 1/2/3** | 3-4 j | **À faire sur iOS d'abord.** Zéro changement dans `lineTrigger.js` |
| 3.1 | `detectHumans` (ML Kit) | 1 sem. | **Bloquant** — rien ne marche sans lui |
| 3.2 | Validation `lineTrigger` | 3 j | Aucun code à écrire : les 9 tests tournent déjà. On valide sur **traces réelles** |
| 3.3 | `readExposure` + cap shutter | 1-2 sem. | Le point dur. Charge conditionnée par le lot 0 |
| 3.4 | `PhotoMetadataBurner` (JPEG) | 1 sem. | |
| 3.5 | `ThermalMonitor` | 2 j | `PowerManager`, API 29+ |
| 3.6 | `BackgroundUploader` (WorkManager) | 1 sem. | **Reportable** : le fallback `fetch` existe |
| — | `PhotoQualityScorer` | **0** | Ne pas porter. À supprimer même sur iOS |

Un **Android v1 utilisable** s'arrête à 3.4 : `capabilities.js` dégrade
proprement l'absence de 3.5 et 3.6, sans un seul `Platform.OS` dans le code
métier.

**Critère de sortie** — un passage à allure course donne 3 photos, comme sur
iPhone, sur au moins deux modèles Android distincts.

---

## Calendrier

```
Semaine 1   ├─ Lot 0 spike ──┐        Lot 2 Play Store ─────────────┐
            │                │        (calendrier, en parallèle)    │
Semaine 2   ├─ Lot 1 coureur ┴─────┐                                │
Semaine 3   │                      │                                │
Semaine 4   │                      └──▶ Android coureur EN LIGNE ◀──┘
            │
Semaine 5-11├─ Lot 3 capture (si GO du lot 0)
```

**Android coureur en ligne : ~4 semaines.** Capture : ~11 semaines au total.

---

## Décisions produit en attente

| # | Question | Pourquoi ça bloque |
|---|---|---|
| 1 | Compte Play **organisation** ou personnel ? | **Irréversible.** Détermine si tu perds 2 semaines |
| 2 | Quels appareils cibles ? | Conditionne le lot 0. Sans liste, le spike ne prouve rien |
| 3 | Photos Android en JPEG : accepté ? | **~2× le poids** à qualité égale → coût R2 et bande passante |
| 4 | ~~Les bénévoles restent-ils sur iPhone ?~~ | ✅ **Tranché** : iPhone au lancement, ouverture à Android juste après. Le lot 3 est engagé |
| 5 | ~~Que fait-on des appareils lents ?~~ | ✅ **Tranché** : paliers 1/2/3 (3, 2, 1 photo) plutôt qu'un refus. Aucun appareil exclu |
| 6 | Montre-t-on le niveau au bénévole et à l'organisateur ? | Nécessaire pour placer les meilleurs téléphones à l'arrivée. Question d'UI |

---

## Ce qui est déjà fait

- **`plugins/CONTRAT_NATIF.md`** — cahier des charges de l'implémentation
  Kotlin, avec les unités et les repères à respecter au caractère près.
- **`src/services/capabilities.js`** — le code métier interroge des capacités,
  plus la plateforme. Un module absent dégrade, il ne casse pas.
- **La logique de décision est déjà commune.** `lineTrigger.js`
  (16 paramètres pilotés par `/config`, 9 tests) et `framingGuide.js`
  (18 tests) sont du JS pur : **zéro ligne à réécrire, et leurs tests
  protègent les deux plateformes**.

C'est cette architecture — le natif mesure, le JS décide — qui fait tenir le
portage en semaines plutôt qu'en mois.

## Le piège à surveiller

`GET /config` ne sert que les clés déclarées dans `defaultGlobalConfig()`
(`worker/index.js`). Une clé oubliée est stockée dans R2 et **jamais servie à
l'app**, sans erreur ni log — c'est arrivé le 2026-08-05 avec
`linesShadow` / `linesEnabled`.

Avec deux plateformes, ce bug peut produire **deux comportements différents**
en silence. Toute nouvelle clé `camera.*` doit rejoindre
`defaultGlobalConfig()` dans le même commit que le code qui la lit.
