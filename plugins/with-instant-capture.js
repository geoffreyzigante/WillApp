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
 *    petit cote, q0.5) AU MOMENT de la capture, depuis les octets encore en
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

const CONFIG_REPLACEMENT = `      // ${MARKER} iOS 17 : captures qui se chevauchent + priorite
      // vitesse automatique sous charge, et zero-shutter-lag explicite.
      if #available(iOS 17.0, *) {
        if photoOutput.isResponsiveCaptureSupported {
          photoOutput.isResponsiveCaptureEnabled = true
          if photoOutput.isFastCapturePrioritizationSupported {
            photoOutput.isFastCapturePrioritizationEnabled = true
          }
        }
        if photoOutput.isZeroShutterLagSupported {
          photoOutput.isZeroShutterLagEnabled = true
        }
      }`;

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
              CGImageDestinationAddImage(willDest, willThumb,
                [kCGImageDestinationLossyCompressionQuality: 0.5] as CFDictionary)
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
