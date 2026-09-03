/**
 * Expo Config Plugin: with-instant-capture
 *
 * Deux patchs sur VisionCamera (iOS), le socle natif du mode Instant v2.
 *
 * 1. CameraSession+Configuration.swift — la ou VisionCamera laisse un TODO :
 *    responsive capture + fast capture prioritization (iOS 17) et
 *    zero-shutter-lag explicite. Mesure terrain 2026-08-30 : takePhoto
 *    montait a 1031 ms sous throttling thermique et le 3e tir d un coureur
 *    tombait sur la limite de vol. Les captures qui se chevauchent suppriment
 *    cette file ; le ZSL sert une frame DEJA exposee a l instant du
 *    declenchement — coureur centre par construction.
 *
 * 2. PhotoCaptureDelegate.swift — encode le JPEG de livraison (2400 px sur le
 *    petit cote, q0.75, progressif, EXIF conserve) AU MOMENT de la capture, depuis les octets encore en
 *    memoire. Le telephone ne redecode plus jamais ce qu il vient d encoder :
 *    c etait le poste de chauffe n1 (decodage 12 Mpx + resize + reencodage
 *    par photo, cote JS). 2400 px = plancher Rekognition valide sur le
 *    terrain (Chateau Gaillard 2026-06-28) ; q0.5 = valeur /config du
 *    2026-08-30. Le chemin sort dans la reponse takePhoto (willJpegPath) ;
 *    un JS ancien l ignore, un build ancien ne le fournit pas et le JS
 *    retombe sur la conversion classique — les deux sens sont surs.
 *
 * Idempotent : markers, fail-loud si les anchors ont bouge.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CONFIG_REL = 'node_modules/react-native-vision-camera/ios/Core/CameraSession+Configuration.swift';
const DELEGATE_REL = 'node_modules/react-native-vision-camera/ios/Core/PhotoCaptureDelegate.swift';
const MARKER = '[will-instant-capture]';

const CONFIG_ANCHOR = `      // TODO: Enable isResponsiveCaptureEnabled? (iOS 17+)
      // TODO: Enable isFastCapturePrioritizationEnabled? (iOS 17+)`;

const CONFIG_REPLACEMENT = `      // ${MARKER} Les enables iOS 17 (responsive capture, fast capture
      // prioritization, zero-shutter-lag) sont RETIRES depuis le 2026-09-01.
      //
      // Ils sortaient les selfies physiquement retournes a 180 deg, avec un
      // EXIF qui annonce pourtant une image droite : rien cote app ne peut
      // rattraper ca. Deux garde-fous ont ete tentes sans succes —
      // isMirrored (toujours false, donc inoperant) puis la position du
      // device (.back), qui laissait encore passer le cas. Un troisieme
      // essai coutait un build de plus pour un gain de vitesse dont la
      // capture course se passe : elle tient deja sa cadence sans eux.
      //
      // Le JPEG de livraison 2400 px encode dans PhotoCaptureDelegate, lui,
      // reste en place : c est lui qui porte le vrai gain de bout en bout.`;

const IMPORT_ANCHOR = `import AVFoundation`;
const IMPORT_REPLACEMENT = `import AVFoundation
import ImageIO // ${MARKER}`;

const DELEGATE_ANCHOR = `      promise.resolve([
        "path": path.absoluteString,`;

const DELEGATE_REPLACEMENT = `      // ${MARKER} JPEG de livraison 2400 px, encode ICI depuis les
      // octets encore en memoire. CreateThumbnailWithTransform applique
      // l orientation EXIF : les pixels sortent a l endroit.
      var willJpegPath: String? = nil
      if let willData = photo.fileDataRepresentation(),
         let willSrc = CGImageSourceCreateWithData(willData as CFData, nil) {
        let willProps = CGImageSourceCopyPropertiesAtIndex(willSrc, 0, nil) as? [CFString: Any]
        let willW = (willProps?[kCGImagePropertyPixelWidth] as? Int) ?? 0
        let willH = (willProps?[kCGImagePropertyPixelHeight] as? Int) ?? 0
        if willW > 0 && willH > 0 {
          let willCourt = min(willW, willH)
          let willLong = max(willW, willH)
          // 2400 sur le PETIT cote (plancher Rekognition) -> la contrainte
          // ImageIO porte sur le grand cote.
          let willMaxPix = willCourt > 2400
            ? Int((2400.0 * Double(willLong) / Double(willCourt)).rounded())
            : willLong
          let willOpts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: willMaxPix,
          ]
          if let willThumb = CGImageSourceCreateThumbnailAtIndex(willSrc, 0, willOpts as CFDictionary) {
            let willURL = path.deletingPathExtension().appendingPathExtension("will.jpg")
            if let willDest = CGImageDestinationCreateWithURL(willURL as CFURL, "public.jpeg" as CFString, 1, nil) {
              // Qualite 0.75 : 0.5 laissait des artefacts visibles (grain de
              // compression pris pour du bruit capteur). ~500 Ko en 2400 px.
              // Progressif : l image se precise au chargement au lieu
              // d apparaitre d un bloc — percu 2x plus rapide sur 4G.
              // EXIF + TIFF recopies de l original (le thumbnail ImageIO les
              // jette) ; orientation remise a 1 puisque les pixels ont ete
              // redresses par la transform.
              var willEnc: [CFString: Any] = [
                kCGImageDestinationLossyCompressionQuality: 0.75,
                kCGImagePropertyJFIFDictionary: [kCGImagePropertyJFIFIsProgressive: true] as CFDictionary,
                kCGImagePropertyOrientation: 1,
              ]
              if let exif = willProps?[kCGImagePropertyExifDictionary] {
                willEnc[kCGImagePropertyExifDictionary] = exif
              }
              if var tiff = willProps?[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
                tiff[kCGImagePropertyTIFFOrientation] = 1
                willEnc[kCGImagePropertyTIFFDictionary] = tiff as CFDictionary
              }
              CGImageDestinationAddImage(willDest, willThumb, willEnc as CFDictionary)
              if CGImageDestinationFinalize(willDest) {
                willJpegPath = willURL.absoluteString
              }
            }
          }
        }
      }
      promise.resolve([
        "path": path.absoluteString,
        "willJpegPath": willJpegPath as Any,`;

function applyPatch(filePath, anchor, replacement, label) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(MARKER) && label !== 'delegate-import' && content.includes(replacement.slice(0, 60))) {
    console.log(`[with-instant-capture] ${label} deja applique, skip`);
    return;
  }
  if (!content.includes(anchor)) {
    if (content.includes(MARKER)) { console.log(`[with-instant-capture] ${label} deja applique, skip`); return; }
    throw new Error(`[with-instant-capture] anchor introuvable (${label}) dans ${filePath} — VisionCamera a change ?`);
  }
  content = content.replace(anchor, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[with-instant-capture] ${label} patche`);
}

module.exports = function withInstantCapture(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      applyPatch(path.join(root, CONFIG_REL), CONFIG_ANCHOR, CONFIG_REPLACEMENT, 'configuration');
      applyPatch(path.join(root, DELEGATE_REL), IMPORT_ANCHOR, IMPORT_REPLACEMENT, 'delegate-import');
      applyPatch(path.join(root, DELEGATE_REL), DELEGATE_ANCHOR, DELEGATE_REPLACEMENT, 'delegate');
      return cfg;
    },
  ]);
};
