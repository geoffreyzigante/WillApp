/**
 * Expo Config Plugin: with-fast-shutter
 *
 * Patches react-native-vision-camera (iOS) for the WillApp photographer mode.
 * Trois patches independants, tous idempotents :
 *
 *  1. SHUTTER (configureDevice)
 *     - exposureMode = .continuousAutoExposure (laisse iOS gerer ISO + shutter
 *       + tone mapping, ce qui inclut le multi-frame HDR du buffer video).
 *     - activeMaxExposureDuration = 1/500s (plafond shutter pour figer les
 *       coureurs jusqu'a ~25 km/h sans flou de bouge. iOS reste libre d'aller
 *       plus vite en bonne lumiere, le plafond ne s'applique que comme borne
 *       max de la duree d'exposition).
 *     - isVideoHDREnabled = true si le format actif le supporte.
 *     - automaticallyEnablesLowLightBoostWhenAvailable = true si supporte.
 *     - Monitor lit la shutter effective tous les 500ms -> will_shutter.json.
 *
 *  2. PHOTO OUTPUT (configureOutputs)
 *     - Force photoOutput.maxPhotoQualityPrioritization = .quality regardless
 *       of the JS-side photoQualityBalance prop. Ca rend la photo eligible
 *       Deep Fusion (iOS choisit automatiquement quand les conditions sont
 *       reunies : capteur wide/tele, bonne lumiere medium-low, iPhone 11+).
 *     - iOS 17+ : isResponsiveCaptureEnabled + isFastCapturePrioritizationEnabled
 *       quand supporte. Reduit la latence shutter-to-shutter pour les bursts
 *       photo (necessaire en single-shot intelligent).
 *
 *  3. HELPER (WillAdaptiveShutter)
 *     - Class fileprivate appended a CameraSession+Configuration.swift.
 *     - Lit device.exposureDuration toutes les 500ms, ecrit will_shutter.json
 *       pour que le JS affiche la valeur courante dans la barre top.
 *
 * IMPORTANT: ce patch ajoute du Swift, il faut un nouveau eas build iOS —
 * pas d'OTA possible.
 *
 * Implementation notes:
 *  - Idempotent : chaque patch verifie son propre marqueur avant d'agir.
 *  - Fail-loud : throws si un bloc upstream a bouge (vision-camera bump),
 *    pour que la regression surface en CI au lieu de produire un binaire
 *    silencieusement casse.
 *  - Le monitor est appended fileprivate au meme fichier — pas de nouveau
 *    build input a injecter dans node_modules.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_REL_PATH =
  'node_modules/react-native-vision-camera/ios/Core/CameraSession+Configuration.swift';

// Markers — chaque patch a son propre marker pour rester independant.
const SHUTTER_MARKER = '[will-fast-shutter]';
const PHOTO_MARKER = '[will-photo-hq]';
const HELPER_MARKER = '// [will-fast-shutter-helper]';

// ─── Patch 1 : exposure / shutter cap ────────────────────────────────────
const SHUTTER_SEARCH = `    if device.isExposureModeSupported(.continuousAutoExposure) {
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
      }
      device.exposureMode = .continuousAutoExposure
    }`;

const SHUTTER_REPLACE = `    // ${SHUTTER_MARKER} BACK camera: continuousAutoExposure + activeMaxExposureDuration
    // capped at 1/500s. Lets iOS pick the right ISO/shutter combo (Smart
    // tone mapping included) while still preventing motion blur on runners.
    // .custom mode disables video HDR + low-light boost, so we abandon it.
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
    }
    if device.position == .back {
      // Video HDR (10-bit) si le format courant le supporte — donne plus de
      // marge sur les contrastes (NB: ce n'est pas le Smart HDR multi-frame
      // d'AVCapturePhotoOutput, mais aide la preview qui lit le buffer video).
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
      // Plafond shutter = 1/500s (durci depuis 1/250s pour figer les coureurs
      // jusqu'a ~25 km/h). iOS reste libre d'aller plus vite en plein soleil,
      // mais ne ralentira pas en-dessous de 1/500s. Compromis : en basse
      // lumiere, l'ISO monte plus haut (bruit) au lieu de ralentir.
      let maxDuration = CMTime(value: 1, timescale: 500)
      device.activeMaxExposureDuration = maxDuration
      WillAdaptiveShutter.shared.startMonitor(device: device)
      NSLog("[FastShutter] continuousAutoExposure + cap 1/500s on back camera")
    } else if device.isExposureModeSupported(.continuousAutoExposure) {
      device.exposureMode = .continuousAutoExposure
    }`;

// ─── Patch 2 : photo output HQ (Deep Fusion + iOS 17 optims) ─────────────
// On accroche le patch sur le bloc TODO d'origine de VisionCamera 4.x. Si
// upstream supprime/modifie ces TODOs, le patch fail-loud (souhaite : signal
// fort qu'il faut revoir le hook).
const PHOTO_SEARCH = `      photoOutput.isMirrored = configuration.isMirrored
      // TODO: Enable isResponsiveCaptureEnabled? (iOS 17+)
      // TODO: Enable isFastCapturePrioritizationEnabled? (iOS 17+)

      self.photoOutput = photoOutput`;

const PHOTO_REPLACE = `      photoOutput.isMirrored = configuration.isMirrored
      // ${PHOTO_MARKER} Force quality prioritization (Deep Fusion eligible)
      // + iOS 17 fast capture flags. WillApp single-shot HQ pipeline.
      if #available(iOS 13.0, *) {
        photoOutput.maxPhotoQualityPrioritization = .quality
        NSLog("[Will-Photo] maxPhotoQualityPrioritization=.quality (Deep Fusion eligible)")
      }
      if #available(iOS 17.0, *) {
        if photoOutput.isResponsiveCaptureSupported {
          photoOutput.isResponsiveCaptureEnabled = true
          NSLog("[Will-Photo] responsive capture enabled (iOS 17+)")
          if photoOutput.isFastCapturePrioritizationSupported {
            photoOutput.isFastCapturePrioritizationEnabled = true
            NSLog("[Will-Photo] fast capture prioritization enabled (iOS 17+)")
          }
        }
      }

      self.photoOutput = photoOutput`;

// ─── Helper class (appended fileprivate) ─────────────────────────────────
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
  let changed = false;

  // Patch 1 : shutter cap
  if (content.includes(SHUTTER_MARKER)) {
    console.log('[with-fast-shutter] shutter patch already applied, skipping');
  } else if (!content.includes(SHUTTER_SEARCH)) {
    throw new Error(
      `[with-fast-shutter] Bloc shutter introuvable dans ${SWIFT_REL_PATH}. ` +
        'VisionCamera a peut-etre ete mis a jour - revoir le patch dans plugins/with-fast-shutter.js.'
    );
  } else {
    content = content.replace(SHUTTER_SEARCH, SHUTTER_REPLACE);
    console.log('[with-fast-shutter] shutter cap 1/500s applied');
    changed = true;
  }

  // Patch 2 : photo output HQ
  if (content.includes(PHOTO_MARKER)) {
    console.log('[with-fast-shutter] photo HQ patch already applied, skipping');
  } else if (!content.includes(PHOTO_SEARCH)) {
    throw new Error(
      `[with-fast-shutter] Bloc photo output introuvable dans ${SWIFT_REL_PATH}. ` +
        'VisionCamera a peut-etre ete mis a jour - revoir le patch photo dans plugins/with-fast-shutter.js.'
    );
  } else {
    content = content.replace(PHOTO_SEARCH, PHOTO_REPLACE);
    console.log('[with-fast-shutter] photo HQ (Deep Fusion + iOS 17 optims) applied');
    changed = true;
  }

  // Helper (append en fin de fichier)
  if (!content.includes(HELPER_MARKER)) {
    content = content + HELPER;
    console.log('[with-fast-shutter] helper class appended');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[with-fast-shutter] CameraSession+Configuration.swift updated');
  }
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
