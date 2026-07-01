# Guided Access iPhone bénévole — WILL event pilote

LOT 1.4 du plan pilote. Vérification que le mode photographe est compatible avec l'Accès Guidé iOS (kiosk).

## Vérif code — aucun `Linking.openURL` en mode photographe

Audit `grep -rn "Linking\." App.js src/` sur la branche `feat/pilote-autonomie` (2026-07-01) :

| Call site | Utilisation | Impact Guided Access |
|---|---|---|
| `App.js:2202` | `Linking.openSettings()` sur bouton "Autoriser l'appareil photo" quand permission refusée | Réglages iOS s'ouvrent si Guided Access autorise, sinon silencieux |
| `src/components/CriticalAlert.js:82` | `Linking.openSettings()` sur kind=camera | Idem |
| `src/screens/EventDetailScreen.js:284, :517` | `openURL(url)` externe | **HORS mode photographe** (pas monté) |
| `src/components/modals/SelfieModal.js:115` | `openURL('https://will-app.com/privacy')` | **HORS mode photographe** |
| `src/components/modals/AuthRunnerModal.js:221, :223` | Liens CGU/confidentialité | **HORS mode photographe** |
| `src/components/modals/SelfieCameraModal.js:99` | `openSettings()` | **HORS mode photographe** |

**Conclusion** : le mode photographe ne fait aucune tentative d'ouverture externe sauf `openSettings()`. Aucun crash / freeze attendu en Guided Access.

## Configuration iPhone bénévole (avant l'event)

Sur l'iPhone qu'on va donner au bénévole :

1. **Réglages iOS → Accessibilité → Accès Guidé → activer** (toggle vert).
2. **Code d'accès** : définir un code 4 chiffres (que **toi** connais, PAS le bénévole).
3. **Face ID / Touch ID pour l'accès guidé** : optionnel, plus rapide pour sortir du mode.
4. Alternatif : **Raccourcis de temps** off (sinon iOS peut mettre en pause l'accès guidé pendant une notif).

## Comment démarrer le mode kiosque le jour J

1. Login orga effectué + PIN photographe entré par toi.
2. Écran capture affiché (armement auto déjà en place LOT 1.1).
3. **Triple-click du bouton latéral** (iPhone X+) OU **Triple-click Home** (iPhone SE) → menu Accès Guidé.
4. Options recommandées :
   - **Bouton veille** : désactivé (empêche le lock).
   - **Volume** : activé (pour laisser le bénévole ajuster son ou couper).
   - **Mouvement** : activé.
   - **Clavier / Touch** : activé.
   - **Temps limite** : off (event de 4h+).
5. **Démarrer** → saisir le code défini plus haut.

## Cas dégradé — permission caméra refusée en cours d'usage

Si iOS révoque la permission caméra (très rare, mais possible après un crash) :
- L'écran `CriticalAlert kind=camera` s'affiche avec bouton "Ouvrir les réglages".
- Guided Access bloque probablement l'ouverture des Settings.
- **Action** : le bénévole doit t'appeler, tu triple-click pour sortir de Guided Access, tu ouvres les Réglages, tu réactives la permission, tu redémarres Guided Access.

## Ce qui reste à faire

- **Tester en conditions réelles** : activer Guided Access sur iPhone test + laisser tourner 30 min + simuler une alerte critique (batterie basse forcée dans Xcode). Notre couverture d'audit code est OK, la validation terrain reste TODO (LOT 4 protocoles).

## Notes

- `pointerEvents="none"` sur le toast auto-arm (`App.js:2958`) : n'intercepte pas les touches en Guided Access. OK.
- Le CriticalAlert utilise `Modal transparent statusBarTranslucent` : compatible Guided Access.
- Le mode `useKeepAwake()` (déjà en place `App.js:349`) empêche la veille — comportement souhaité.
