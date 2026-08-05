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

**Au-delà de ~280 ms par photo, aucun réglage ne permet 3 photos sur un
coureur de route à 3 m/s.** Limite physique : le sujet ne reste pas assez
longtemps entre les lignes. En dessous, ça se rattrape en écartant les
lignes (à 200-250 ms : `lineOffsets` ±0.90 au lieu de ±0.75).

### Conséquence : auto-calibration au lieu d'un réglage global

Aujourd'hui `lineOffsets` est une valeur **globale** poussée par `/config`.
Avec un parc hétérogène, une valeur unique est forcément mauvaise pour une
partie des appareils.

Proposition — au premier lancement en mode photographe, l'app :

1. mesure sa **latence de capture réelle** (rafale de 5, médiane des écarts) ;
2. en déduit `lineOffsets` par `k ≈ 2 × cooldown × v_cible / zone`, borné par
   des min/max venant de `/config` ;
3. **refuse le rôle bénévole au-delà de 280 ms**, avec un message honnête
   plutôt qu'une galerie vide le jour de la course.

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

**Critère de sortie** — un tableau latence × modèle, comparé au seuil de
280 ms établi ci-dessus.

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
| 3.0 | **Auto-calibration + garde 280 ms** | 3-4 j | **À faire sur iOS d'abord.** Cf. « flotte non maîtrisée » |
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
| 5 | Que fait-on des appareils sous 280 ms ? | Refus du rôle bénévole, ou mode dégradé assumé à 2 photos ? Décision produit, pas technique |

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
