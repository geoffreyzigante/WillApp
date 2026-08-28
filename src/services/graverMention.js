// Incrustation de la mention « Photo capturée par Will » dans le FICHIER.
//
// Pourquoi ici et pas sur le serveur : les deux chemins de gravure du worker
// sont hors service. cf.image.draw ne dessine rien (verifie le 2026-08-28 :
// meme fichier a l octet pres avec et sans watermark), et le binding
// env.IMAGES plante a l output — c est exactement pour cette raison que le
// site grave sa mention dans un <canvas> du navigateur. Le telephone n a pas
// de canvas : on passe par Skia, qui joue le meme role.
//
// Le calque dessine est le MEME PNG que celui utilise par le serveur et le
// site (assets/mention-will.png) : une seule source pour les trois surfaces,
// donc aucune divergence de typo ou d ombre.
//
// Tout est defensif : si Skia n est pas dans le binaire (mise a jour OTA sur
// un build plus ancien) ou si quoi que ce soit echoue, on rend null et
// l appelant enregistre la photo telle quelle. Une photo sans mention vaut
// mieux qu un telechargement casse.

import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';

let skiaModule;
let skiaIndisponible = false;
function chargerSkia() {
  if (skiaModule || skiaIndisponible) return skiaModule;
  try {
    skiaModule = require('@shopify/react-native-skia');
  } catch (e) {
    skiaIndisponible = true;
    console.warn('[mention] Skia absent de ce binaire, gravure ignoree');
  }
  return skiaModule;
}

let calqueCache = null;
async function chargerCalque(Skia) {
  if (calqueCache) return calqueCache;
  const asset = Asset.fromModule(require('../../assets/mention-will.png'));
  if (!asset.localUri) await asset.downloadAsync();
  const data = await Skia.Data.fromURI(asset.localUri || asset.uri);
  calqueCache = Skia.Image.MakeImageFromEncoded(data);
  return calqueCache;
}

/**
 * @param {string} uriLocale fichier deja telecharge (file://...)
 * @returns {Promise<string|null>} uri d un NOUVEAU fichier grave, ou null
 */
export async function graverMention(uriLocale) {
  const mod = chargerSkia();
  if (!mod?.Skia) return null;
  const { Skia, ImageFormat } = mod;
  try {
    const data = await Skia.Data.fromURI(uriLocale);
    const photo = Skia.Image.MakeImageFromEncoded(data);
    if (!photo) return null;

    const L = photo.width();
    const H = photo.height();
    const surface = Skia.Surface.MakeOffscreen(L, H);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.drawImage(photo, 0, 0);

    const calque = await chargerCalque(Skia);
    if (calque) {
      // Tout est proportionnel a la largeur : la mention garde le meme poids
      // visuel sur une photo 1200 px comme sur un 6000 px. 26 % de large,
      // c est ce que donne le rendu du site a l ecran.
      const largeur = Math.round(L * 0.26);
      const hauteur = Math.round(largeur * (calque.height() / calque.width()));
      const marge = Math.round(L * 0.022);
      canvas.drawImageRect(
        calque,
        { x: 0, y: 0, width: calque.width(), height: calque.height() },
        { x: marge, y: H - hauteur - marge, width: largeur, height: hauteur },
        Skia.Paint(),
      );
    }

    surface.flush();
    const rendu = surface.makeImageSnapshot();
    const octets = rendu.encodeToBytes(ImageFormat.JPEG, 92);
    if (!octets) return null;

    const fichier = new File(Paths.cache, `will_mention_${Date.now()}.jpg`);
    if (fichier.exists) fichier.delete();
    fichier.create();
    fichier.write(octets);
    return fichier.uri;
  } catch (e) {
    console.warn('[mention] gravure impossible:', e?.message || e);
    return null;
  }
}
