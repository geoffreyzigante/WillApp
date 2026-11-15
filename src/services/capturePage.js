// Capture de la page sous un menu (Android uniquement). Une Modal Android est
// une fenetre a part : expo-blur n y voit rien a flouter. On photographie donc
// la page avant d ouvrir le menu, et on affiche l image floutee par Skia.
// Toute erreur rend null : l appelant garde son voile sombre.
import { makeImageFromView } from '@shopify/react-native-skia';

let racine = null;
export let derniereErreur = '';

export function setCaptureRoot(ref) { racine = ref; }

export async function capturerPage() {
  try {
    derniereErreur = '';
    if (!racine || !racine.current) { derniereErreur = 'racine absente'; return null; }
    const img = await makeImageFromView(racine);
    if (!img) derniereErreur = 'image nulle';
    return img || null;
  } catch (e) {
    derniereErreur = String((e && e.message) || e);
    return null;
  }
}
