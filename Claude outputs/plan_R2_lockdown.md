# Plan de bascule — Fermer l'accès public R2 (photos & selfies)

_Établi le 15 sept. 2026 · basé sur `worker/index.js` réel._

## 1. État actuel (ce que j'ai vérifié dans le code)

- **Bucket public** : `pub-…r2.dev` (`r2PublicBase()`, ligne 8380). N'importe quelle clé connue est lisible en clair : `https://…r2.dev/<key>` → renvoie **l'original sans filigrane**, hors du worker.
- **Selfies** exposés en **URL publique directe** :
  - `GET /runner/selfie` renvoie `{ uri: r2PublicBase/_selfies/<userId>.jpg }` (ligne 2456)
  - `GET /runner/selfie/exists` renvoie une `uri` publique (ligne 3663)
  - Le client charge ensuite l'image directement depuis r2.dev → **fuite permanente si l'URL sort**.
- **Endpoint tokenisé déjà prêt** (Phase 1 faite par le dev) : `GET /runner/selfie/image` (ligne 3675), auth `verifyRunnerToken` **header `Authorization` uniquement**, sert le binaire 280×280.
- **Photos** servies **via le worker** (`/photo-enhanced/`, `/photo-jpeg/`, `/list-public`, …) qui font `fetch(publicUrl, { cf: { image } })` → la transformation Cloudflare **fetch l'original sur r2.dev**. Donc le worker **dépend du bucket public** pour transformer.

## 2. Les 2 blocages techniques (à connaître avant de planifier)

1. **`<img>` web ne peut pas envoyer de header `Authorization`.** `/runner/selfie/image` n'accepte que le header → inutilisable tel quel dans une balise image côté site. Il faut **ajouter un token signé court en query** (`?tk=…`) OU charger l'image en `fetch()`+blob. L'app React Native, elle, peut passer un header sur `Image source`.
2. **`env.IMAGES` "plante à l'output"** (constaté 28/08, commentaire ligne 22) et `cf.image.draw` (watermark serveur) ne dessine plus. Les transformations photos reposent donc sur `fetch(publicUrl)` = **bucket public obligatoire**. **Tant que ce bug plateforme n'est pas résolu, on ne peut pas couper le bucket pour les photos** sans casser l'affichage/watermark.

**Conséquence :** on découple. Les **selfies** (biométrie, le vrai risque RGPD) se ferment maintenant. Les **photos** sont un chantier séparé, gaté sur le fix `env.IMAGES`.

---

## 3. Plan par phases

### Phase A — Fermer les selfies (faisable maintenant, priorité RGPD)

**Worker**
1. Ajouter le support d'un **token signé en query** à `GET /runner/selfie/image` : accepter `?tk=<signed>` en plus du header. Signer avec un secret scopé + TTL court (ex. 1 h), payload = `userId`. Réutiliser le pattern `sign()`/`scopedSecret()` déjà présent.
2. Remplacer les `uri` publiques renvoyées par une **référence tokenisée** :
   - ligne 2456 (`/runner/selfie`) → `uri: /runner/selfie/image?tk=<signé pour ce userId>` (ou un flag `has_selfie:true` + l'app/site appelle l'endpoint avec son token).
   - ligne 3663 (`/runner/selfie/exists`) → idem.
3. **Ne plus jamais émettre** `r2PublicBase/_selfies/...`.

**App (React Native)**
4. `Image source` du selfie → `GET /runner/selfie/image` avec header `Authorization: Bearer <runnerToken>` (RN le supporte nativement).

**Site web**
5. `<img>` du selfie → `GET /runner/selfie/image?tk=<token>` (query signé) **ou** `fetch()` + `URL.createObjectURL(blob)`.

**Découplage bucket (recommandé) :** déplacer les selfies dans un **bucket/prefix privé** non exposé par r2.dev (ex. bucket séparé sans domaine public, ou r2.dev désactivé sur un bucket dédié selfies). Ainsi les selfies sont fermés **sans attendre** le fix photos. Migration : copier `_selfies/*` vers le store privé, basculer les lectures, supprimer les anciens.

**Ordre de bascule (zéro coupure) :**
1. Déployer le worker (endpoint accepte header **ET** query ; continue d'émettre l'ancienne `uri` publique en parallèle).
2. Migrer app + site vers l'endpoint tokenisé.
3. Vérifier (logs/tests) que plus aucun client ne lit l'URL publique.
4. Worker : arrêter d'émettre l'`uri` publique + (si bucket dédié) désactiver le r2.dev des selfies.

### Phase B — Fermer les photos (bloqué, à planifier)

Pré-requis : **`env.IMAGES.output()` refonctionne** (bug plateforme Cloudflare) OU mise en place d'une origine authentifiée pour CF Image Transform OU passage à Cloudflare Images (produit).
Quand débloqué :
1. Remplacer les 5 `fetch(publicUrl, {cf:image})` (lignes 520, 629, 739, 934, 1093) par **lecture R2 binding + `env.IMAGES.transform()`**.
2. Vérifier watermark/`nowm`/enhanced sur ce nouveau chemin.
3. Idem selfies : ne plus émettre d'URL publique de photo.

### Phase C — Couper le bucket public

Seulement quand **selfies ET photos** ne dépendent plus de r2.dev :
- Désactiver le domaine public `pub-…r2.dev` sur le bucket (dashboard Cloudflare).
- Retirer `R2_PUBLIC_URL` / `r2PublicBase` du worker.
- Test de non-régression complet.

---

## 4. Reco pragmatique pour le prochain event

- **Faire la Phase A (selfies)** — c'est le risque RGPD réel (donnée biométrique) et l'endpoint est déjà là. Impact app + site limité (changer une source d'image + un endpoint worker).
- **Laisser les photos publiques** pour ce 1er event (event gratuit, photos destinées à être vues, watermark client en place) — assumer ce risque borné, et ouvrir un ticket « fix env.IMAGES » côté Cloudflare pour débloquer la Phase B.

## 5. Ce que je peux faire, et ce qui nécessite l'app

- **Worker (moi, prêt à coder) :** query-token sur `/runner/selfie/image`, arrêt des `uri` publiques, éventuel bucket privé selfies.
- **App + site (toi/ton code app) :** basculer la source d'image du selfie.
- **Dashboard Cloudflare (toi) :** bucket privé selfies / désactivation r2.dev / ticket env.IMAGES.
- **Déploiement (toi) :** `wrangler deploy`.
