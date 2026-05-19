/**
 * Expo Config Plugin: with-heic-capture
 *
 * Patch unique sur VisionCamera (iOS) qui bascule le codec de capture de
 * JPEG (defaut AVCapturePhotoSettings()) vers HEVC quand le hardware le
 * supporte (iPhone 7+ tous OK). Gain : ~2x plus petit a qualite egale,
 * 10-bit color depth, capture plus rapide.
 *
 * Fallback : si availablePhotoCodecTypes ne contient pas .hevc (cas rare,
 * device tres ancien), on retourne aux settings JPEG par defaut — pas de
 * crash.
 *
 * Cote post-capture : PhotoMetadataBurner.swift gere l'enhance (CIImage
 * autoAdjustmentFilters) + le burn + le reencodage HEIC final. C'est lui
 * qui fixe l'extension de sortie (.heic). Ce plugin-ci ne touche QUE les
 * AVCapturePhotoSettings — un fichier, une ligne.
 *
 * Idempotent : marker sur le bloc patche, fail-loud si l'anchor a bouge
 * (mise a jour VisionCamera).
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_REL_PATH =
  'node_modules/react-native-vision-camera/ios/Core/CameraSession+Photo.swift';

const MARKER = '[will-heic-capture]';

// Anchor exact (CameraSession+Photo.swift L.42 dans VisionCamera 4.x).
// Indentation 6 espaces, ligne unique. Si VisionCamera change cette ligne
// (rare — le code n'a pas bouge depuis 2023), le patch fail-loud.
const ANCHOR = '      let photoSettings = AVCapturePhotoSettings()';

const REPLACEMENT = `      // ${MARKER} Bascule codec HEVC (HEIC) si supporte. iPhone 7+ OK.
      // Fallback JPEG sur device ancien (pas de crash). Le reencodage
      // final + extension .heic est gere cote PhotoMetadataBurner.swift.
      let photoSettings: AVCapturePhotoSettings = {
        if photoOutput.availablePhotoCodecTypes.contains(.hevc) {
          return AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
        }
        return AVCapturePhotoSettings()
      }()`;

function patchSwift(projectRoot) {
  const filePath = path.join(projectRoot, SWIFT_REL_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[with-heic-capture] Fichier introuvable : ${filePath}. ` +
        'react-native-vision-camera est-il installe ?'
    );
  }
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(MARKER)) {
    console.log('[with-heic-capture] deja applique, skip');
    return;
  }
  if (!content.includes(ANCHOR)) {
    throw new Error(
      `[with-heic-capture] Anchor introuvable dans ${SWIFT_REL_PATH}. ` +
        'VisionCamera a peut-etre ete mis a jour — verifier la ligne ' +
        '"let photoSettings = AVCapturePhotoSettings()".'
    );
  }
  content = content.replace(ANCHOR, REPLACEMENT);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[with-heic-capture] CameraSession+Photo.swift patched (codec HEVC)');
}

module.exports = function withHeicCapture(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      patchSwift(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};
