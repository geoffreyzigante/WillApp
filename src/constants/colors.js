// Design tokens couleurs.
//
// Toute reference au rose Will doit utiliser C.pinkPill, pas le hex brut.
// La brand mobile est volontairement desalignee de la brand officielle
// sRGB #D67CF8 utilisee par landing/dashboard/vitrine -- realignement
// cross-surface planifie (cf ~/WILL/DECISIONS_PRODUIT_EN_ATTENTE.md BRAND-02).
//
// Pose en sRGB brut, aucune compensation P3 appliquee. Sur ecran P3 iOS,
// la couleur rendue est legerement plus saturee/vive que la valeur sRGB
// brute (shift typique gamut P3, plus marque sur les magentas). Si la
// perception sur device s avere trop agressive, introduire une valeur
// compensee apres test reel a l oeil (comme #E476FF -> #D67CF8 en 2026-06-02).
//
// Semantiques UI-09 (2026-06-04). Rouge canonique = #B42318 (unifie le
// 2026-11-25 : #EF4444 echouait au contraste, 3,8 sur blanc). Toute reference success/error/
// warning doit utiliser ces tokens, pas les hex bruts.

// Charte partagee avec le site : WILL/charte/tokens.json.
import { T } from './tokens';

export const C = {
  bg: '#FFFFFF',
  // Le fond de l app, pose en dur dans styles.js root, PanierScreen,
  // PhotosUnauthScreen et OrganizerEventPhotosScreen. Nomme ici pour que
  // les nouveaux ecrans cessent de recopier le hex ; les quatre anciens
  // restent a migrer.
  fondApp: '#F5F3FF',
  primary: T.couleur.primaire,
  primaryDark: '#5A1FCC',
  primaryLight: T.couleur.primaireClair,
  text: '#1A1426',
  // Etait rgba(123,47,255,0.3) — un violet a 30 % illisible sur blanc,
  // constate sur tous les ecrans (2026-08-31). Regle : texte secondaire en
  // gris moyen ; les placeholders et etats vides utilisent #A89CB8 en dur.
  textSoft: '#5a5468',
  white: '#FFFFFF',
  // Gris des placeholders, icones et textes desactives (unifie #A89CB8 / #8B83A0 / #9CA3AF).
  muted: '#A89CB8',
  pillBg: '#EFE7FF',
  pinkPill: T.couleur.rose,
  pinkPillText: '#FFFFFF',
  pinkPillBg: '#FDECFF',
  pinkPillActive: '#f4a6ff',
  // Foreground icones sur fond pinkPill (blanc rose). Symetrique de
  // pinkPillText pour le texte sur le meme fond.
  pinkPillFg: '#FFF5FF',
  violetAccent: '#7C3AED',
  card: '#FFFFFF',
  shadow: 'rgba(123,47,255, 0.08)',
  success: '#10B981',
  error: '#B42318',
  warning: '#F59E0B',
  // Espaces organisateur et photographe : noir de la charte a la place du
  // violet (decision Geoffrey, 26/11). Le violet reste la couleur du coureur.
  // Texte blanc sur orga, texte orga sur orgaClair : contrastes > 15.
  orga: T.couleur.orga.accent,
  orgaSurvol: T.couleur.orga.accentSurvol,
  orgaClair: T.couleur.orga.accentClair,
};

// Palette arc-en-ciel synchronisee avec dashboard (src/orga/pages/
// EventCard.js -> TYPE_TINTS) et landing (will-app.com section "Pour qui").
// Toute modification doit etre repercutee sur les trois surfaces.
// Cles en lowercase pour que le lookup soit insensible a la casse + aux
// espaces parasites du champ event_type stocke en R2 -- utiliser
// colorForType() au lieu d'indexer directement TYPE_COLORS.
export const TYPE_COLORS = {
  trail: '#22C55E',
  course: '#14B8A6',
  'course a pied': '#14B8A6',
  'course à pied': '#14B8A6',
  route: '#3B82F6',
  'course sur route': '#3B82F6',
  cross: '#A855F7',
  triathlon: '#6366F1',
  velo: '#F97316',
  vtt: '#EC4899',
  marche: '#EAB308',
  // Palette decorative TYPE_COLORS, distincte du C.error semantique
  // (UI-09). "autre" garde son rouge dedie #EF4444 ; n est pas une
  // signalisation d erreur mais une categorie event_type non classifiee.
  autre: '#EF4444',
};

export const colorForType = (eventType) => {
  const k = (eventType || '').toLowerCase().trim();
  return TYPE_COLORS[k] || TYPE_COLORS.autre;
};
