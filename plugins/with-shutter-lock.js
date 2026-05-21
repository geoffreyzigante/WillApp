/**
 * Expo Config Plugin: with-shutter-lock
 *
 * 2026-05 : NEUTRALISE. Historiquement ce plugin forcait un shutter fixe
 * via setExposureModeCustom + metering loop ISO (mode S/Tv). Strategie
 * abandonnee : on laisse iOS gerer expo + Deep Fusion + Smart HDR +
 * reduction de bruit en mode .continuousAutoExposure natif, pour obtenir
 * le rendu iPhone propre sans bruit. La classe WillShutterController est
 * conservee et reduite a un simple logger NSLog [WILL-CAM] qui trace le
 * device attache (capteur principal/secondaire/virtuel) au demarrage de
 * session.
 *
 * Architecture :
 *   1. Hook dans CameraSession+Configuration.swift inchange : appelle
 *      WillShutterController.shared.attachDevice apres setup exposure.
 *   2. Helper WillShutterController : NSLog [WILL-CAM] only, plus de
 *      timer ni de setExposureModeCustom.
 *
 * Idempotent : marqueurs sur hook + helper, fail-loud si upstream bouge.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_REL_PATH =
  'node_modules/react-native-vision-camera/ios/Core/CameraSession+Configuration.swift';

const HOOK_MARKER = '[will-shutter-lock-hook]';
const HELPER_MARKER = '// [will-shutter-lock-helper]';

const HOOK_SEARCH = `    if device.isExposureModeSupported(.continuousAutoExposure) {
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
      }
      device.exposureMode = .continuousAutoExposure
    }`;

const HOOK_REPLACE = `    if device.isExposureModeSupported(.continuousAutoExposure) {
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
      }
      device.exposureMode = .continuousAutoExposure
    }
    // ${HOOK_MARKER} Attache le device au logger qui NSLog [WILL-CAM] le
    // capteur reel (principal/secondaire/virtuel) + son format actif. AUCUNE
    // modification d'exposition : .continuousAutoExposure ci-dessus reste
    // actif -> rendu iPhone natif Deep Fusion + Smart HDR.
    WillShutterController.shared.attachDevice(device)`;

const HELPER = `

${HELPER_MARKER}
// Hook NSLog [WILL-CAM] : logge le device (capteur principal/secondaire/
// virtuel) et son format actif au moment ou la session AVCapture est
// configuree. Permet de tracer dans Console.app quel AVCaptureDevice est
// effectivement attache. AUCUNE modification d'exposition : on laisse iOS
// gerer en .continuousAutoExposure natif (Deep Fusion + Smart HDR + AE/AF
// continus). Historique : cette classe forcait setExposureModeCustom +
// metering loop pour shutter fixe -- abandonne 2026-05.

fileprivate final class WillShutterController {
  static let shared = WillShutterController()

  func attachDevice(_ d: AVCaptureDevice) {
    Self.logCameraInfo(d)
  }

  private static func logCameraInfo(_ d: AVCaptureDevice) {
    let typeStr: String
    switch d.deviceType {
    case .builtInWideAngleCamera:   typeStr = "PRINCIPAL-wide"
    case .builtInUltraWideCamera:   typeStr = "SECONDAIRE-ultraWide"
    case .builtInTelephotoCamera:   typeStr = "SECONDAIRE-tele"
    case .builtInDualCamera:        typeStr = "VIRTUEL-dual"
    case .builtInDualWideCamera:    typeStr = "VIRTUEL-dualWide"
    case .builtInTripleCamera:      typeStr = "VIRTUEL-triple"
    default:                        typeStr = "AUTRE"
    }
    let videoDim = CMVideoFormatDescriptionGetDimensions(d.activeFormat.formatDescription)
    var photoStr = "n/a"
    if #available(iOS 16.0, *) {
      photoStr = d.activeFormat.supportedMaxPhotoDimensions
        .map { "\\($0.width)x\\($0.height)" }
        .joined(separator: ",")
    }
    let fps = d.activeFormat.videoSupportedFrameRateRanges.last?.maxFrameRate ?? 0
    NSLog("[WILL-CAM] capteur='%@' type=%@ photoMax=[%@] video=%dx%d maxFps=%.0f",
          d.localizedName, typeStr, photoStr, videoDim.width, videoDim.height, fps)
  }
}
`;

function patchSwift(projectRoot) {
  const filePath = path.join(projectRoot, SWIFT_REL_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[with-shutter-lock] Fichier introuvable : ${filePath}. ` +
        'react-native-vision-camera est-il installe ?'
    );
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Patch hook
  if (content.includes(HOOK_MARKER)) {
    console.log('[with-shutter-lock] hook patch already applied, skipping');
  } else if (!content.includes(HOOK_SEARCH)) {
    throw new Error(
      `[with-shutter-lock] Bloc exposure introuvable dans ${SWIFT_REL_PATH}. ` +
        'VisionCamera a peut-etre ete mis a jour — revoir le HOOK_SEARCH.'
    );
  } else {
    content = content.replace(HOOK_SEARCH, HOOK_REPLACE);
    console.log('[with-shutter-lock] attachDevice hook applied');
    changed = true;
  }

  // Helper (append en fin de fichier)
  if (!content.includes(HELPER_MARKER)) {
    content = content + HELPER;
    console.log('[with-shutter-lock] WillShutterController helper appended');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[with-shutter-lock] CameraSession+Configuration.swift updated');
  }
}

module.exports = function withShutterLock(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      patchSwift(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};
