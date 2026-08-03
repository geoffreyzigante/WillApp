# NOTE DE CONCEPTION — Déclenchement par lignes (v1 implémentable)

Statut : à valider avant implémentation. Complète CONCEPTION_DECLENCHEMENT_LIGNES.md
(§1.1-1.9) en tranchant les 6 questions ouvertes, après vérification du code réel.

## 0. Vérifications — trois faits qui changent la conception

1. **Le scorer local ne sert PAS au serveur.** `quality_score` est calculé par le
   worker dans `processPhotoAsync` depuis DetectFaces (`worker/index.js:4234`), pas
   par le scorer mobile. → Le scorer natif peut être coupé sans rien casser côté
   galerie/cron. (Le brief supposait l'inverse en filigrane.)
2. **Le cron serveur survit aux captures unitaires.** Il groupe par écarts de
   `burstTs` consécutifs ≤ 30 s (`worker/index.js:7527`). Trois captures espacées
   de ≤450 ms restent un seul passage. Le cap galerie groupe par `burstTs` :
   avec burstTs unitaires, chaque groupe a 1 photo → neutre.
3. **Le worklet réduit déjà les visages sur place** et ne fait traverser que 4
   scalaires (`App.js:1244-1254`). Confirmé — c'est le point d'architecture n°1.

## 1. La règle de déclenchement

Trois lignes verticales dans la zone : `L_i = 0.5 + k_i × zone/2`,
`k = [-0.45, 0, +0.45]` (zone 0.30 → x = 0.4325 / 0.50 / 0.5675).

Par visage suivi (track) :
- Franchissement d'une ligne **non consommée** (changement de signe de
  `x − L_i` entre deux positions, réelles ou prédites) → programme une capture à
  `t_cross_prévu − LATENCE` (anticipation par la vitesse).
- Une capture **crédite tous les tracks** dont la position prédite à t_fire est
  dans la zone ET dont la taille ≥ `MIN_FACE_AREA` ; chacun consomme sa ligne
  non-consommée la plus proche. (5 coureurs groupés → 3-5 photos, pas 15.)
- Une ligne consommée l'est **définitivement** pour ce track, quel que soit le
  sens. C'est ce qui rend la personne immobile bornée **par construction** : le
  bruit de bbox autour d'une ligne la consomme une fois, puis plus rien.
  Le test terrain « 5 s immobile = 30 photos » devient « ≤ 3 » sans garde dédiée.

Failsafes, par priorité :
- **F1 — sortie à zéro photo** : position prédite hors zone à horizon 150 ms, OU
  track perdu (fin de coasting), avec `photos == 0` → capture immédiate,
  inconditionnelle (ignore cooldown et limiteur). La promesse produit vit ici.
- **F2 — sujet rapide** : plusieurs lignes franchies dans la même fenêtre → UNE
  capture au franchissement médian, toutes consommées. Vélo = 1-2 photos, assumé.
- **F3 — résurrection anti-clignotement** : un nouveau track apparaissant à
  ≤ GATE d'un track mort depuis < 1,5 s **hérite de ses lignes consommées et de
  son compteur**. Répond directement à la donnée terrain n°1 (rafale coupée par
  clignotement) : sans F3, chaque clignotement redonnerait un budget de 3 et on
  recréerait le bug des 30 photos. Si aucun mort ne matche → budget neuf
  (doctrine : sur-capturer plutôt que rater), borné par F4.
- **F4 — limiteur global** : 24 captures / 10 s glissantes. Seul F1 le bypasse.
- **Cooldown capteur** : 150 ms entre captures (plancher séquentiel). Un
  franchissement pendant le cooldown est servi par le crédit de la capture en vol.

## 2. Réponses aux six questions

**Q1 — Frontière worklet : tracker en JS, traversée en tableau PLAT de scalaires.**
Le worklet sérialise `[ts, n, cx₀,cy₀,w₀,h₀, cx₁,…]` (Float, cap 8 visages triés
par aire) — pas d'objets, c'est le format que le commentaire du code proscrit.
Envoi **uniquement quand n > 0** : coût nul hors passages ; en passage, ~34
nombres à 10 fps, négligeable devant les 4 scalaires actuels + la photo elle-même.
Pourquoi pas le tracker dans le worklet : l'association est LE point critique du
système (« une faiblesse ici ne se voit pas en test ») — elle doit vivre dans un
module pur, unit-testable, loggable. Un tracker en worklet (état via SharedValues,
pas de tests, debug aveugle) échange le risque mesurable contre un risque opaque.
Le peloton reste traitable (8 visages traversent).

**Q2 — Association : plus-proche-voisin sur position prédite, gloutonne.**
- Prédiction `x' = x + vx·dt` (vitesse EMA, α = 0.4). Coût = distance à la
  détection, normalisée par la largeur du visage.
- Acceptée si distance ≤ `GATE = max(1.5 × w_visage, 0.10)`. À allure course un
  visage se déplace d'~une largeur/frame : la prédiction absorbe le gros, la
  marge ×1.5 absorbe bruit + accélération. N ≤ 8 → le glouton suffit.
- **Franchissements sur positions BRUTES** (pas de lissage : le lissage retarde,
  et les faux franchissements par bruit sont inoffensifs grâce au consomme-une-fois).
- Track non apparié → coasting sur prédiction 300 ms, puis mort (après check F1).
- Croisement de deux coureurs : au pire les identités permutent → les budgets
  s'échangent (4/2 au lieu de 3/3), jamais zéro (F1 par track). Dégradation douce.
- Perdu-retrouvé : F3 ci-dessus.

**Q3 — Lignes : `[-0.45, 0, +0.45]` de la demi-zone, tunables.**
Centrale = photo sûre pour Rekognition ; ±0.45 = variété réelle (espacement
~0.07 ≈ 1-2 largeurs de visage) en laissant 7,5 % de marge au bord de zone pour
F1 et la fenêtre de crédit. Resserrer davantage produirait 3 quasi-doublons —
inacceptable sans tri derrière.

**Q4 — Sujet rapide : une capture, toutes lignes consommées (F2).**
Pas de rattrapage, pas de montée de cadence Vision en v1 (coût batterie, gain
non prouvé). Le plancher de 150 ms du capteur rend de toute façon 3 photos
physiquement impossibles sous ~450 ms de présence. F1 garantit ≥ 1.

**Q5 — Sort de l'existant : tout reste, débranché par UN flag.**
`camera.linesEnabled` (défaut false, runtime via /config comme staticGuard) :
- ON : `onHumansDetectedJS` route vers le tracker ; `captureBurstLoop` jamais
  appelé ; garde anti-statique bypassée (sans objet — le consomme-une-fois la
  remplace structurellement) ; items créés `upload_kept: true` → le reducer,
  qui ne touche que les items non décidés, devient un no-op naturel ; le scorer
  natif est sauté (vérif §0.1 : le serveur ne s'en sert pas).
- OFF : comportement actuel à l'identique. Rollback = 1 PUT /config.
- Suppression physique (burst loop, reducer, scorer, garde statique) : seulement
  après 2 events stables — hors périmètre de cette livraison.

**Q6 — Identité R2 : `burstTs = t_fire`, `idx = 0`.**
Format de clé inchangé (`{time}_{burstTs}_{idx}`, App.js:2584). Unicité intra-
device garantie par le cooldown 150 ms ; la collision inter-devices même PIN
même ms est un risque préexistant documenté, inchangé. Groupement cron : OK
(vérif §0.2).

## 3. Paramètres (tous sous `/config camera.*`, défauts)

| Clé | Défaut | Justification |
|---|---|---|
| `linesEnabled` / `linesShadow` | false / false | interrupteurs L2 / L1 |
| `lineOffsets` | [-0.45, 0, 0.45] | §Q3 |
| `lineLatencyMs` | 50 | avance de tir ; borne sup 80 ms établie, jamais mesurée — à ajuster si le sujet sort du cadre |
| `lineHorizonMs` | 250 | 2 frames Vision + marge |
| `lineCooldownMs` | 150 | plancher capteur |
| `lineGateFactor` / `lineGateFloor` | 1.5 / 0.10 | §Q2 |
| `lineCoastMs` | 300 | 3 frames Vision |
| `lineResurrectMs` | 1500 | F3 — couvre les clignotements observés |
| `lineCreditMinArea` | 0.005 | seuil de matchabilité Rekognition |
| `lineMaxPer10s` | 24 | l'event cible fait 13,3/10 s à plein régime ; ×2 de marge |

## 4. Livraison — un seul build, deux flags

**L1 — build unique** : plugin (tableau plat), tracker (`src/services/lineTrigger.js`,
pur, unit-testé : association, crédit, F1-F4, rejeu de traces), branchement
double dans `onHumansDetectedJS` :
- `linesShadow` : le tracker LOGGUE ce qu'il aurait déclenché, l'ancien pipeline
  capture normalement. Comparaison directe sur les mêmes passages.
- `linesEnabled` : le tracker déclenche `captureOne({burstTs: tFire, idx: 0})`,
  l'ancien pipeline est débranché.
Les deux chemins sont dans le build ; **L2 n'est qu'un PUT /config**, zéro build.

**Validation L1 (ombre, sur event TEST)** : sur un passage normal, le log
would-fire ≈ 3 ; sur 5 s immobile, would-fire ≤ 3 ; zéro track terminé à 0 photo.
**Validation L2 (bascule)** : les trois critères du brief, mesurés en réel :
passage normal → 3 envoyées (au lieu de 6) ; immobile 5 s → ≤ 3 (au lieu de 30) ;
aucun coureur à zéro photo.

**Risque principal assumé** : une photo non prise est irrécupérable — c'est le
prix de l'architecture (décision produit). Compensations : F1 inconditionnel,
F3 borné par F4, mode ombre AVANT toute bascule, rollback à chaud.

## 5. ADDENDUM — validé par le propriétaire du produit (2026-07-30)

Deux règles ajoutées après discussion du cas « coureur qui reste longtemps » :

- **F5 — track statique par VITESSE** : un track dont la vitesse lissée reste
  < `lineStaticV` (0.02 largeur/s) pendant `lineStaticMs` (3000) passe STATIQUE :
  ses franchissements ne déclenchent plus rien. Il se réactive dès qu'il bouge
  réellement — ses lignes restent consommées. Différence clé avec l'ancienne
  garde (qui a échoué) : la vitesse EMA du tracker moyenne le bruit de bbox,
  le tremblement brut ne peut plus la défaire. Un track STATIQUE avec 0 photo
  qui sort de zone ne déclenche PAS F1 (un badaud n'est pas un coureur raté).
- **F3 affiné — résurrection adaptative** : héritage des lignes consommées si le
  track mort matche en position. Fenêtre : `lineResurrectMs` (1500) si le mort
  était en mouvement ; `lineResurrectStaticMs` (10000) s'il était quasi-immobile
  (personne ne « remplace » quelqu'un de statique en 10 s ; un vrai coureur
  arrive toujours avec de la vitesse).

Conception validée. Implémentation : L1 (build unique, deux flags) puis L2
(bascule par /config après validation du mode ombre sur event TEST).
