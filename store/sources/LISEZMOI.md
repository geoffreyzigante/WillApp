# Visuels des stores — sources

Tout se regénère depuis ces trois fichiers. Rien d'autre n'est nécessaire.

| Fichier | Produit | Format |
|---|---|---|
| `frames.html` | les 5 captures App Store | 1320 × 2868 (iPhone 6,9") |
| `frames-play.html` | les 5 captures Play | 1080 × 1920 |
| `feature.html` | le feature graphic Play | 1024 × 500 |

## Pourquoi deux fichiers de captures

Google refuse une image dont le côté long dépasse **2× le côté court**.
Le format App Store (1320 × 2868) vaut 2,17 : il est refusé par Play tel
quel. D'où la version 1080 × 1920 (ratio 1,78), qui passe aussi la barre
« recommandée » des 1080 px de Google.

Le **5e cadre diffère** entre les deux : la version App Store montre la vue
photographe, qui n'est pas proposée sur Android pour le moment. La version
Play montre la liste des courses du coureur à la place.

## Regénérer

```bash
npx playwright screenshot --viewport-size=1080,1920 frames-play.html x.png
```
ou, pour sortir les cadres un par un, le script utilisé :
un `page.$$('.frame')` puis un `screenshot()` par élément.

## Les contraintes à ne pas perdre

- Play : PNG 24 bits **ou** JPEG, **sans canal alpha**. Côté entre 320 et
  3840 px. Ratio ≤ 2:1. 2 captures minimum, 8 maximum par type d'appareil.
- Play : le **feature graphic 1024 × 500 est obligatoire** pour publier la
  fiche. C'est la seule image à qui la règle du 2:1 ne s'applique pas.
- Le texte du feature graphic est calé dans la moitié gauche : Google
  superpose parfois ses propres éléments sur les bords.
