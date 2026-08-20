# Upload en deux temps

État : **implémenté, désactivé par défaut** (`upload.two_tier: false`).
Deux verrous restent à lever avant de l'activer sur un vrai event — §4.

## L'idée

Deux besoins n'ont aucune raison d'aller à la même vitesse :

| | ce qu'il faut | poids |
|---|---|---|
| **Être reconnu** | une image analysable | ~300 Ko |
| **Avoir sa photo** | l'original | 1,94 Mo |

Le téléphone envoie donc la copie légère d'abord, sur la même clé R2, puis
l'original quand le réseau suit. Un coureur apparaît dans sa galerie ~6×
plus tôt. Et si le bénévole n'a jamais de réseau correct de la journée, tout
le monde a quand même sa photo — en qualité réduite plutôt que pas du tout.

La priorité du léger est **stricte** : tant qu'il reste une copie légère à
envoyer, aucun original ne part. Aujourd'hui le 400ᵉ coureur attend que les
399 premiers aient poussé leurs 1,94 Mo avant d'exister dans la galerie.

## La règle de résolution

La légèreté s'achète sur la **qualité JPEG**, jamais sur la résolution.

À 1280 px, `DetectFaces` voit encore les visages mais `SearchFacesByImage`
ne matche plus jamais (mesure Château Gaillard, 2026-06-28). Aucune erreur
n'est levée : juste zéro match.

`lightPlanFor` reproduit donc **exactement** la géométrie du worker —
largeur plafonnée à 2400 px, `fit: scale-down`. Un test compare les deux
implémentations ; s'il casse, c'est qu'elles ont divergé.

> Première version écrite avec une règle « grand côté ≤ 2400 ». Elle
> réduisait la capture nominale 2400×3200 à 1800×2400, soit 25 % de moins
> que ce que le serveur analyse. Rattrapée par le test, gardée en test.

## Ce qui garantit qu'aucune photo n'est perdue

Tout chemin d'échec de la voie légère rend l'item à l'envoi direct :

| Échec | Conséquence |
|---|---|
| `makeLightCopy` échoue | `lightSkipped`, budget de retries rendu, envoi direct |
| gain < ×2 | idem |
| PUT léger échoue `maxRetries` fois | idem (`echecUpload`) |
| cold start pendant le PUT léger | l'identifiant porte `#light` → l'orphelin marque `lightDone`, ne supprime rien |

La copie légère est fabriquée **à la volée** au moment du PUT et supprimée
dans le `finally`. Hors ligne on ne draine pas, donc elle n'existe pas et ne
coûte rien au disque du téléphone.

`Uploadées` continue de signifier « original sur R2 ».

## 4. Les deux verrous avant activation

### A. Le cache HTTP survit à l'arrivée de l'original

`purgeDerived` invalide les variantes `_derived/` dans R2. Mais les réponses
du worker partent avec `Cache-Control: public, max-age=2592000` **et**
`CDN-Cache-Control` identique — 30 jours — et l'URL ne change pas
(`?v=wm20` est statique).

Scénario : la copie légère atterrit → le coureur reçoit sa notification →
il ouvre sa galerie dans la minute → la vignette est fabriquée depuis la
copie à q0,45 et mise en cache edge + navigateur pour un mois → l'original
arrive, `purgeDerived` nettoie R2, **et rien ne change pour lui**.

Ce n'est pas un cas limite : faire regarder le coureur tôt est *tout l'objet*
de la fonctionnalité.

Pistes : jeton de cache-busting dans l'URL (`photoUrl` reçoit déjà `uploaded`
sans l'utiliser), ou `Cache-Control` court tant que
`customMetadata.tier === 'light'`.

### B. L'analyse tourne deux fois dans le cas nominal

`dejaAnalysee` se décide sur un HEAD au moment où l'original arrive. Or
l'analyse de la copie légère dure plusieurs secondes et n'écrit ses
métadonnées qu'à la fin. Quand la file ne contient qu'une photo, le
re-drain immédiat pousse l'original avant — donc `processed_quality` est
absent, l'analyse repart, et AWS est facturé **deux fois** au lieu de zéro.

Les métadonnées convergent (mêmes visages, mêmes résultats, écritures
conditionnelles), donc ce n'est pas une perte de données — mais le gain de
coût annoncé est inversé. À traiter avec la déduplication par visage suivi,
qui attaque le même problème par l'autre bout.

## Ce qui reste à mesurer

1. Poids réel de la copie sur de vraies photos d'event (l'estimation ~300 Ko
   vient d'un calcul, pas d'une mesure).
2. Taux de match **inchangé** entre l'original et la copie. C'est la mesure
   qui autorise ou interdit l'activation — et elle ne se lit dans aucun log,
   il faut la faire explicitement.
3. Coût CPU de `makeLightCopy` sur le téléphone pendant une course.
