# M1bis — Intégration du guide de cadrage

Cf. `CONCEPTION_DECLENCHEMENT_LIGNES.md` §1.8. Trois fichiers livrés, plus
~30 lignes à câbler dans `App.js`.

## Fichiers

| Fichier | Rôle | Testé |
|---|---|---|
| `src/services/framingGuide.js` | géométrie pure, zéro dépendance | ✅ 12 tests |
| `src/services/__tests__/framingGuide.test.mjs` | les tests (`node test.mjs`) | — |
| `src/hooks/useDeviceTilt.js` | tangage/roulis via accéléromètre | parse OK |
| `src/components/FramingGuide.js` | repère + consigne sur la preview | parse OK |

## Prérequis build

```bash
npx expo install expo-sensors
```

**Dépendance native → build EAS, pas un OTA.** Le plugin v2 (bbox, M2) en exige
un de toute façon : grouper les deux dans le même build.

## Câblage dans `App.js` (PhotographerScreen)

```jsx
import { useDeviceTilt } from './src/hooks/useDeviceTilt';
import FramingGuide from './src/components/FramingGuide';
import { fovFromFormat, TARGET_DISTANCE_M, MOUNT_HEIGHT_M } from './src/services/framingGuide';

// --- état ---
const [framingMode, setFramingMode] = useState(false);          // bouton "Régler le cadrage"
const [mountHeight, setMountHeight] = useState(MOUNT_HEIGHT_M.barriere);

// --- capteur : ne tourne QUE pendant le réglage ---
const { pitch, roll, available } = useDeviceTilt(framingMode);

// --- champ réel de l'appareil, pas de valeur codée en dur ---
const fov = useMemo(
  () => fovFromFormat(format?.fieldOfView ?? 68, 'portrait'),
  [format?.fieldOfView],
);

const targetDistance =
  TARGET_DISTANCE_M[eventConfig.camera?.discipline] ?? TARGET_DISTANCE_M.default;
```

Puis, dans le JSX, **juste après** l'overlay « zone de capture » existant
(App.js ~2709-2722) pour hériter de la même géométrie de preview :

```jsx
{framingMode && available && (
  <FramingGuide
    targetDistance={targetDistance}
    height={mountHeight}
    pitch={pitch}
    roll={roll}
    halfFovH={fov.halfFovH}
    halfFovV={fov.halfFovV}
    rect={{ top: CAMERA_TOP, height: previewH, marginH: PREVIEW_MARGIN_H }}
  />
)}
```

## Ce que voit le bénévole

**Un point vert, et rien d'autre.** Il le place au milieu du chemin — le
cadrage est réglé. Aucune distance à comprendre, aucune consigne à lire.

Le point suit l'appareil en temps réel : il monte quand on incline vers le sol,
et se décale latéralement si le téléphone penche sur le côté (le roulis est
géré, contrairement à un simple trait horizontal qui aurait exigé un appareil
parfaitement droit).

Position du point à 3,5 m, h = 1 m :

| | incl. 0° | 10° | 25° |
|---|---|---|---|
| roulis 0° | (50 %, 71 %) | (50 %, 58 %) | (50 %, 38 %) |
| roulis 10° | (55 %, 71 %) | (52 %, 58 %) | (47 %, 38 %) |
| roulis 25° | (62 %, 69 %) | (54 %, 57 %) | (43 %, 39 %) |

Deux messages seulement, et uniquement quand c'est nécessaire : « Incline le
téléphone vers le sol » si le point sort du cadre, et un avertissement si la
hauteur choisie est inférieure à 80 cm.

Reste à ajouter : un bouton pour entrer/sortir du mode réglage, et un sélecteur
de hauteur à trois choix (sol / barrière / trépied).

## Le point à vérifier en premier sur device

**L'orientation du champ.** `fovFromFormat(fov, 'portrait' | 'landscape')`
inverse les deux axes. Le sens change la largeur de zone d'un facteur 1,35,
donc le nombre de photos atteignables :

| | Route à 2 m | Route à 4 m | Distance mini (3 photos, route) |
|---|---|---|---|
| Portrait (axe long vertical) | 1 | 2 | 4,4 m |
| Paysage (axe long horizontal) | 1 | 3 | 3,3 m |

Précédent direct dans ce dépôt : le choix `axis: 'midX'` vs `'midY'` de
`HumanDetectorPlugin` a dû être tranché empiriquement pour exactement cette
raison. Ne pas le déduire — le mesurer.

**Protocole, 10 minutes :** poser le téléphone sur une barrière, mesurer 3,5 m
au mètre ruban, poser un repère au sol, ouvrir le mode réglage. Si la ligne
affichée tombe sur le repère, l'hypothèse `'portrait'` est bonne. Sinon,
basculer sur `'landscape'` et refaire. Critère du doc : écart < 25 %.

## Ce qui reste hypothétique

- **`format.fieldOfView`** est documenté « video field of view » — le champ
  photo peut différer si le format photo n'a pas le même ratio. Ici les deux
  sont en 4:3, donc a priori identiques. À confirmer par le même protocole.
- **Sol plan.** Faux en dévers ou en côte : dégradation progressive, pas de
  rupture. Le contrôle par taille de visage (M2) le rattrapera.
- **`d ∝ h`** : 20 % d'erreur sur la hauteur = 20 % sur la distance. C'est la
  raison des présets plutôt que d'une saisie libre.
