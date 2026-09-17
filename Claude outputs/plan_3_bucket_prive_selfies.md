# #3 — Bascule bucket privé selfies (plan revu, à faire à froid après l'event)

## Objectif
Sortir les selfies (donnée biométrique) d'un bucket exposé en `pub-…r2.dev` vers un bucket **sans domaine public**. L'émission d'URL publique est déjà coupée (endpoint tokenisé `?tk=`) ; ceci ferme le dernier vecteur : une clé `_selfies/…` devinée reste lisible en clair sur r2.dev tant que le bucket est public.

## Principe : 1 helper, neutre tant que le binding n'existe pas
```js
function selfieBucket(env) { return env.SELFIE_BUCKET || env.BUCKET; }
```
Tant que `SELFIE_BUCKET` n'est pas bindé → `selfieBucket(env) === env.BUCKET` → **comportement identique, zéro risque**. On peut donc committer/déployer le refactor AVANT d'avoir le bucket, et le tester en prod à iso-comportement.

## Étape 1 — Refactor (worker, neutre)
Remplacer `env.BUCKET` par `selfieBucket(env)` **uniquement** sur les ops dont la clé commence par `_selfies/`. Catégories repérées :

- **lectures** (get / head / candidates jpg-jpeg-heic) : `/runner/selfie`, `/runner/selfie/exists`, `/runner/selfie/image`, rotation, matching.
- **écriture** : upload selfie (`put(_selfies/{userId}.jpg)`) + re-stockage rotation.
- **suppression** : DELETE selfie, purge RGPD compte, purge cron.
- **listing/metrics** : `list({prefix:"_selfies/"})` (admin, compteurs).

À NE PAS toucher : tout ce qui n'est pas `_selfies/` (photos, `_derived/`, `_auth/`, `_consents/`, slug…). Les photos restent sur le bucket public (bloqué par le bug `env.IMAGES`, chantier séparé).

> Numéros de ligne à reconfirmer sur le code prod au moment de coder (la copie de référence a divergé). ~15 sites, tous filtrables par la présence de `_selfies/` dans la clé.

Vérif : `node -c index.js` + relecture diff (le diff ne doit contenir que des lignes `_selfies/`).

## Étape 2 — Créer le bucket privé (dashboard, toi)
- Nouveau bucket R2, ex. `will-selfies`, **domaine public r2.dev désactivé**.
- Binding wrangler.toml :
```toml
[[r2_buckets]]
binding = "SELFIE_BUCKET"
bucket_name = "will-selfies"
```

## Étape 3 — Migrer les objets existants (script, une fois)
Copier `_selfies/*` de `will-photos` → `will-selfies` (rclone ou `wrangler r2 object` en boucle sur la liste). Vérifier le compte objets source == destination avant de basculer.

## Étape 4 — Bascule
1. Déployer le worker avec le binding en place → les lectures/écritures selfies passent sur le bucket privé.
2. Tester : upload selfie, `/runner/selfie/image?tk=`, matching, DELETE, purge RGPD.
3. Une fois validé : supprimer les vieux `_selfies/*` du bucket public `will-photos`.

## Rollback
Retirer le binding `SELFIE_BUCKET` → le helper repointe sur `env.BUCKET`. (Valable seulement si on n'a pas encore supprimé les objets du bucket public — donc **ne pas faire l'étape 4.3 avant plusieurs jours de prod OK**.)

## Pourquoi pas maintenant
Intestable ici, ~15 sites sur le chemin critique selfie, juste avant l'event. Gain résiduel faible (émission déjà fermée). À dérouler à froid, l'Étape 1 d'abord (neutre) pour valider le refactor sans dépendre du bucket.
