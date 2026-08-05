# Audit Android de la couche JS

Fait le 2026-08-05 sur `feat/cleanup-technique`. Vérifié par bundle Android
réel (`expo export --platform android` : 1466 modules, aucune erreur).

## Verdict : la couche JS est en bien meilleur état que prévu

Le chiffrage initial prévoyait ~5 jours dont une bonne part d'audit des
`Platform.OS`. **Cette partie est déjà faite** — reste un vrai problème, non
détectable par un grep sur `Platform.OS`.

| Vérification | Résultat |
|---|---|
| 27 branches `Platform.OS === 'ios'` | ✅ **toutes** ont un chemin Android |
| `<Modal>` sans `onRequestClose` (bouton retour) | ✅ aucun (38 modals vérifiés) |
| `<BlurView>` non gardé | ⚠️ 16 occurrences — voir §2 |
| Ombres `shadowColor` sans `elevation` | ⚠️ 22 vs 27 — voir §3 |
| Polices variables + `fontWeight` | 🔴 **bloquant visuel** — voir §1 |

Les 27 branches gèrent déjà correctement `keyboardDidShow`, `display:
'default'`, `behavior: undefined`, `StatusBar.currentHeight`. Rien à y faire.

---

## 1. 🔴 Polices variables : la hiérarchie typographique va s'effondrer

**Le problème.** `App.js:5734` charge deux polices **variables** sous un seul
nom de famille chacune :

```js
Font.loadAsync({
  'AVEstiana-Bold': require('./assets/fonts/AV_Estiana-VF.ttf'),
  AVEstiana:        require('./assets/fonts/AV_Estiana-VF.ttf'),
  Montserrat:       require('./assets/fonts/Montserrat-VF.ttf'),   // ← VF
});
```

Or **18 endroits** combinent `fontFamily: 'Montserrat'` avec un `fontWeight`
(`'400'`, `'500'`, `'700'`…).

Sur iOS, Core Text sait interpoler l'axe de graisse d'une police variable :
les 18 graisses s'affichent correctement. **Sur Android, le système associe
un fichier à une graisse unique.** Les `fontWeight` seront soit ignorés, soit
remplacés par du faux-gras synthétique.

**Conséquence** : titres, boutons et corps de texte rendus à la même graisse.
Rien ne casse, rien ne log — l'app est juste typographiquement plate.

**Pourquoi un grep sur `Platform.OS` ne le trouve pas** : ce n'est pas une
branche, c'est une différence de moteur de rendu.

**Correctif** — livrer les instances statiques de Montserrat (Regular /
Medium / SemiBold / Bold) et les enregistrer comme familles distinctes :

```js
Font.loadAsync({
  'Montserrat-Regular':  require('./assets/fonts/Montserrat-Regular.ttf'),
  'Montserrat-Medium':   require('./assets/fonts/Montserrat-Medium.ttf'),
  'Montserrat-SemiBold': require('./assets/fonts/Montserrat-SemiBold.ttf'),
  'Montserrat-Bold':     require('./assets/fonts/Montserrat-Bold.ttf'),
});
```

puis remplacer `fontFamily + fontWeight` par la famille explicite. Le plus
propre est un helper central (`src/constants/fonts.js`) exposant
`font(weight)` — un seul fichier à toucher si la palette de graisses bouge.

**Charge : ~1 jour**, dont l'ajout de 4 fichiers de police (Google Fonts,
licence SIL OFL — libre y compris en usage commercial).

> ⚠️ **À vérifier visuellement en premier au premier build Android.** C'est
> le genre de régression qu'on ne voit pas dans les logs mais que tout
> utilisateur remarque immédiatement.

`AVEstiana` est moins exposé : il est chargé sous un nom explicitement
`-Bold` et utilisé sans `fontWeight` sur les gros titres. À contrôler
quand même.

---

## 2. ⚠️ BlurView : 16 usages, qualité variable

`expo-blur` fonctionne sur Android mais rend différemment, et le coût GPU est
supérieur. Trois endroits gardent déjà le flou derrière `Platform.OS` avec un
aplat en repli (`AppHeader`, `BurgerMenuModal`) — c'est le bon geste.

Les 13 autres afficheront un flou Android, acceptable mais à contrôler à
l'œil, en particulier :

- `App.js:7568` et `LoginModal:219` — `intensity={10}`, un flou très léger
  qui risque d'être invisible ou au contraire de virer au gris opaque ;
- `PhotoViewerModal:482` — `intensity={60}` en plein écran photo, l'endroit
  le plus coûteux en GPU.

**Aucune action avant de l'avoir vu.** Corriger à l'aveugle serait pire.

---

## 3. ⚠️ Ombres : 22 `shadowColor` pour 27 `elevation`

Les propriétés `shadow*` d'iOS n'ont aucun effet sur Android, qui utilise
`elevation`. Le rapport suggère que la plupart des ombres ont bien leur
pendant, mais pas toutes.

Cas identifié : `PhotoViewerModal:451` applique une ombre portée aux icônes
blanches **uniquement sur iOS** (`Platform.OS === 'ios' ? {...} : null`).
Sur Android, ces icônes blanches perdront leur contour — potentiellement
illisibles sur une photo claire.

**Charge : ~½ journée**, mais à faire captures d'écran en main.

---

## Ce qui reste à faire côté JS

| # | Sujet | Charge | Vérifiable sans appareil ? |
|---|---|---|---|
| 1 | Polices statiques + helper `font()` | 1 j | partiellement (bundle) |
| 2 | Revue visuelle des 13 BlurView | ½ j | non |
| 3 | Ombres → `elevation` | ½ j | non |
| 4 | Firebase + `google-services.json` | ½ j | non |

Les points 2 et 3 exigent un appareil : les faire avant le premier build
serait du travail à l'aveugle.
