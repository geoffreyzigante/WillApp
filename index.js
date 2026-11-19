import { registerRootComponent } from 'expo';

import App from './App';

// Plafond global de l agrandissement des textes par le systeme (taille de
// police / taille d affichage Android). Sans borne, un reglage « grand » fait
// deborder les libelles de leur boite : menu du bas, pastilles, cartes — vus
// coupes sur Android. Le reglage d accessibilite reste honore jusqu a 1,2.
// Ajoute aussi Montserrat comme police par defaut (typo coherente partout).
// React 19 ignore Text.defaultProps : on borne a l appel de rendu.
try {
  const { Text, TextInput } = require('react-native');
  [Text, TextInput].forEach((Cmp) => {
    if (!Cmp || typeof Cmp.render !== 'function') return;
    const rendu = Cmp.render;
    Cmp.render = function (...args) {
      const el = rendu.apply(this, args);
      if (!el || !el.props) return el;
      // Police par defaut : sans fontFamily, Android retombe sur Roboto et
      // l ecran n a plus la typo de la charte. Un style explicite gagne.
      return require('react').cloneElement(el, {
        maxFontSizeMultiplier: el.props.maxFontSizeMultiplier != null ? el.props.maxFontSizeMultiplier : 1.2,
        style: [{ fontFamily: 'Montserrat' }, el.props.style],
      });
    };
  });
} catch (e) {}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
