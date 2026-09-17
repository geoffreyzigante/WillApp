# 📸 Will — Parcours d'une photo, de la lumière à la galerie

> Mode **HEIC** (actuel). Chaque photo traverse 9 phases : téléphone → Worker → Lambda → galerie.
> Légende sévérité : 🟢 sain · 🟠 à surveiller · 🔴 point dur.

---

## 0️⃣ Amont — avant toute capture
- App connectée à l'event ; `/config` chargée au montage puis **toutes les 5 min** (bascules à chaud, sans rebuild).
- Caméra : **wide-angle strict** (exclut ultra-wide + caméras virtuelles), **flux 1080p** (batterie), Deep Fusion (`balanced`), **autofocus continu + suivi de visage**, HDR/lowLightBoost/stabilisation **coupés**.
- Après ~900 ms → **auto-armement** : capture auto prête.

🟢 Socle sain.

## 1️⃣ Flux & détection — continu (Go! actif)
- **Frame processor** ~30 fps, throttle 1/3 → **~10 détections/s** (Apple Vision).
- Tick **1 Hz** lit l'exposition → **voyant lumière** (🟢/🟠/🔴 selon l'obturateur médian).
- **Plancher d'obturation adaptatif** poussé au natif (`activeMaxExposureDuration`) : jamais plus lent que 1/500 en lumière faible, iOS libre au-dessus, **sans quitter le mode auto** (Deep Fusion préservé).
- Chaque position de visage → **stepTrigger**.

## 2️⃣ Déclenchement — stepTrigger (instant)
Un seul **repère au centre** (x = 0.5). Le tir part si :
- un visage **franchit** le repère (→ centré), **ou**
- un visage **apparaît déjà** dans la **fenêtre ±0,10** autour du centre (rattrapage des lointains).

Garde-fous : **cooldown 180 ms**, **limiteur 30 tirs/10 s**, **refus sans visage**. Le repère s'allume (jauge de placement). → `captureOne()`. Capture **pipelinée** (plusieurs `takePhoto` en vol, bornés).

## 3️⃣ Prise de vue — `takePhoto`
- iOS exécute **Deep Fusion** → 🔴 **~640 ms**, obturateur ≥ 1/500, MAP sur le visage.
- Sortie : **HEIC 12 Mpx** (`photo.path`) + **sidecar EXIF** (pose / ISO / ouverture).
- En HEIC : **JPEG 2400 natif sauté** (flag `will_skip_jpeg`) → CPU/thermique/disque économisés.
- **Liseré blanc 380 ms** = confirmation bénévole. Latence + EXIF loggés (preuve que 1/500 tient).

🔴 **Les ~640 ms sont LE point dur** : le coureur bouge pendant la pose (voir note finale).

## 4️⃣ File locale — `will_pending`
- HEIC → `will_pending/raw/{id}.heic` + sidecar → état **« En attente »**. File **persistante** (rien perdu si l'app se ferme).
- `processQueue` : **scoring local** (~1 photo/10 en instant) + refus sans visage ; **gate HEIC** → item `processed`, `heic:true`, clé forcée en `.jpg` (galeries inchangées), EXIF compact extrait.
- 🟢 Aucune conversion, aucun dérivé fabriqué sur le téléphone.

## 5️⃣ Envoi — `drainQueue` (immediate)
- Envoi **aussitôt** (pas d'attente de lot).
- **BackgroundUploader natif (NSURLSession arrière-plan)** → **survit à l'app repliée/fermée**.
- `PUT` du HEIC, `Content-Type: image/heic`, en-têtes `X-Will-Exif / Race / Km`.
- **PUT 200** → état **« Sauvegardée »**, fichier local supprimé.

## 6️⃣ Réception — Worker Cloudflare
- Stocke le HEIC sous la clé `.jpg` (customMetadata : real_format=heic, race, km, exif).
- Tâche de fond : **sniff des octets** → HEIC → `decoderHeicViaLambda`.
- **Invoque la Lambda** (SigV4 aws4fetch, **synchrone**, payload `{ key, meta, sharpen }`), **retry 3×** (backoff 0/800/2000 ms).
- 🟢 Le Worker **ne décode jamais de HEIC**.

## 7️⃣ Décodage & dérivés — Lambda AWS `will-heic`
- Lit le HEIC depuis R2 (S3). **`heic-convert`** (libheif **JS pur**) → **PNG lossless**.
- **`sharp`** produit et réécrit dans R2 :
  - **master JPEG 3600 px q90** + **accentuation** (unsharp, sigma = `sharpen`) → **même clé `.jpg`**, métadonnées reposées ;
  - **petit JPEG 1600 px q72** (`_reko/`) → pour Rekognition ;
  - **WebP 400 / 800 / 1200 px** accentués (`_derived/`) → galerie.
- Retour `{ ok, rekoKey }` (~1–2 s).

## 8️⃣ Reconnaissance — Worker (sur le `_reko`)
- **DetectFaces** (qualité + boîtes), **DetectText** (OCR dossards), **SearchFacesByImage** (match coureurs **consentants**, collection globale).
- **Re-put final** : `matched_user_ids`, `detected_numbers`, `processed_quality` dans les customMetadata.

## 9️⃣ Galerie & affichage
- Le coureur ouvre sa galerie (reconnu via `matched_user_ids`).
- Grille : **WebP 800 px** · premier plein écran : **WebP 1200 px** · puis **fondu vers le HD** (`/photo-jpeg` = master + léger sharpen CF).
- Filigrane (mention + couvrant) sur les payantes non achetées ; **téléchargement = master JPEG** universel.

---

## 🔴 Le point critique — la latence de capture
Deep Fusion prend **~640 ms** (phase 3). Le coureur **bouge** pendant ce temps ⇒ décentré / flou de mouvement. La fenêtre d'apparition (phase 2) corrige le **cadrage**, pas le **mouvement pendant la pose**.

**Deux leviers :**
- 🟢 **Couper Deep Fusion (mode Speed)** : capture ~150 ms → coureur figé et centré. Coût : un peu plus de grain en basse lumière (négligeable en plein jour). *Pilotable par config.*
- 🟠 **Restaurer le ZSL caméra arrière** : garde Deep Fusion **et** tue la latence, mais chantier **natif risqué** (a déjà retourné des selfies → reconnaissance cassée). À investiguer à part, testé.
