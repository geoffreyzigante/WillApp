/**
 * Expo Config Plugin: with-fast-shutter
 *
 * Patches react-native-vision-camera (iOS) to enable Smart-HDR-friendly
 * auto exposure on the back camera (photographer mode):
 *  - exposureMode = .continuousAutoExposure (laisse iOS gerer ISO + shutter
 *    + tone mapping, ce qui inclut le HDR multi-frame du buffer video).
 *  - activeMaxExposureDuration = 1/250s (plafond shutter pour eviter le
 *    flou de bouge sur les coureurs — iOS reste libre d'aller plus vite).
 *  - isVideoHDREnabled = true si le format actif le supporte.
 *  - automaticallyEnablesLowLightBoostWhenAvailable = true si supporte.
 *
 * Le mode .custom precedent (shutter forcee + ladder adaptative) etait
 * incompatible avec ces optimisations iOS, d'ou le passage en auto borne.
 * Un monitor read-only (WillAdaptiveShutter) lit la shutter effective tous
 * les 500ms et la mirroie vers <Caches>/will_shutter.json pour permettre au
 * JS d'afficher la valeur courante (sans pastille couleur — c'est iOS qui
 * decide, plus de "fail state" a signaler).
 *
 * Front camera : intouchee, continuousAutoExposure comme avant (selfies
 * indoor demandent une shutter plus lente que ce que la cap impose ici).
 *
 * IMPORTANT: ce patch ajoute du Swift, il faut un nouveau eas build iOS —
 * pas d'OTA possible.
 *
 * Implementation notes:
 *  - Idempotent: marker check skips re-patching.
 *  - Fail-loud: throws if the upstream block has moved (vision-camera bump),
 *    so the regression surfaces in CI rather than producing a silent broken
 *    binary.
 *  - Le monitor est appended fileprivate au meme fichier — pas de nouveau
 *    build input a injecter dans node_modules.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_REL_PATH =
  'node_modules/react-native-vision-camera/ios/Core/CameraSession+Configuration.swift';
const MARKER = '[will-fast-shutter]';
const HELPER_MARKER = '// [will-fast-shutter-helper]';

const SEARCH = `    if device.isExposureModeSupported(.continuousAutoExposure) {
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
      }
      device.exposureMode = .continuousAutoExposure
    }`;

const REPLACE = `    // ${MARKER} BACK camera: continuousAutoExposure + activeMaxExposureDuration
    // capped at 1/250s. Lets iOS pick the right ISO/shutter combo (Smart
    // tone mapping included) while still preventing motion blur on runners.
    // .custom mode disables video HDR + low-light boost, so we abandon it.
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
    }
    if device.position == .back {
      // Video HDR (10-bit) si le format courant le supporte — donne plus de
      // marge sur les contrastes (NB: ce n'est pas le Smart HDR multi-frame
      // d'AVCapturePhotoOutput, mais aide takeSnapshot qui lit le buffer video).
      if device.activeFormat.isVideoHDRSupported {
        device.automaticallyAdjustsVideoHDREnabled = false
        device.isVideoHDREnabled = true
        NSLog("[Will-HDR] video HDR enabled on active format")
      } else {
        NSLog("[Will-HDR] active format does not support video HDR")
      }
      // Low-light boost iOS si supporte (booste la sensibilite en tres faible
      // lumiere sans cramer le bruit, geree par iOS).
      if device.isLowLightBoostSupported {
        device.automaticallyEnablesLowLightBoostWhenAvailable = true
        NSLog("[Will-HDR] low-light boost enabled")
      }
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
      // Plafond shutter = 1/250s. iOS reste libre d'aller plus vite en bonne
      // lumiere, mais ne ralentira pas sous 1/250s (compromis flou de bouge).
      let maxDuration = CMTime(value: 1, timescale: 250)
      device.activeMaxExposureDuration = maxDuration
      WillAdaptiveShutter.shared.startMonitor(device: device)
      NSLog("[FastShutter] continuousAutoExposure + cap 1/250s on back camera")
    } else if device.isExposureModeSupported(.continuousAutoExposure) {
      device.exposureMode = .continuousAutoExposure
    }`;

const HELPER = `

${HELPER_MARKER}
// Read-only shutter monitor for the WillApp photographer mode.
// iOS gere desormais l'exposition automatiquement (continuousAutoExposure +
// activeMaxExposureDuration). Ce monitor lit la shutter effective choisie
// par iOS toutes les 500ms et la mirroie vers <Caches>/will_shutter.json
// pour que le JS affiche la valeur courante dans la barre top.
// (Foundation + AVFoundation are already imported at the top of this file.)

fileprivate final class WillAdaptiveShutter {
  static let shared = WillAdaptiveShutter()

  private var timer: DispatchSourceTimer?
  private weak var device: AVCaptureDevice?

  func startMonitor(device: AVCaptureDevice) {
    self.device = device
    timer?.cancel()
    let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
    t.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(500))
    t.setEventHandler { [weak self] in self?.tick() }
    t.resume()
    timer = t
  }

  private func tick() {
    guard let device = device else { return }
    let duration = device.exposureDuration
    let seconds = CMTimeGetSeconds(duration)
    guard seconds.isFinite, seconds > 0 else { return }
    let denom = Int((1.0 / seconds).rounded())
    let label = "1/\\(denom)s"
    NSLog("[Will-Shutter] auto exposure shutter=%@ iso=%.0f", label, device.iso)
    writeState(label: label)
  }

  private func writeState(label: String) {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    // level toujours "auto" : le rendu JS sait que c'est juste un readout
    // (pas de pastille couleur, simple texte).
    let json = "{\\"shutter\\":\\"\\(label)\\",\\"level\\":\\"auto\\",\\"ts\\":\\(ts)}"
    guard let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
    let url = dir.appendingPathComponent("will_shutter.json")
    try? json.data(using: .utf8)?.write(to: url, options: .atomic)
  }
}
`;

function patchSwift(projectRoot) {
  const filePath = path.join(projectRoot, SWIFT_REL_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[with-fast-shutter] Fichier introuvable : ${filePath}. ` +
        'react-native-vision-camera est-il installe ?'
    );
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(MARKER) && content.includes(HELPER_MARKER)) {
    console.log('[with-fast-shutter] Already patched, skipping');
    return;
  }
  if (!content.includes(SEARCH)) {
    throw new Error(
      `[with-fast-shutter] Bloc original introuvable dans ${SWIFT_REL_PATH}. ` +
        'VisionCamera a peut-etre ete mis a jour - revoir le patch dans plugins/with-fast-shutter.js.'
    );
  }
  content = content.replace(SEARCH, REPLACE);
  if (!content.includes(HELPER_MARKER)) {
    content = content + HELPER;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[with-fast-shutter] Patched CameraSession+Configuration.swift (adaptive shutter)');
}

module.exports = function withFastShutter(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      patchSwift(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};
