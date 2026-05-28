/**
 * Expo Config Plugin: with-shutter-lock
 *
 * 2026-05 v2 — Réactive un cap shutter ADAPTATIF en gardant le mode natif
 * .continuousAutoExposure (donc Deep Fusion + Smart HDR preservés). La
 * difference avec le v1 : on ne sort PAS du mode auto. On set juste
 * device.activeMaxExposureDuration depuis JS via le frame processor.
 *
 *   - Pleine lumiere (voyant OK)   -> cap 1/1000s
 *   - Lumiere moyenne / faible     -> cap 1/500s
 *
 * Si la scene est trop sombre, iOS pousse l'ISO (jusqu'a activeMaxISO) ;
 * passe ce plafond la photo est sous-exposee mais nette (compromis assume
 * pour un sujet rapide comme un coureur).
 *
 * Architecture :
 *   1. Hook dans CameraSession+Configuration.swift : appelle
 *      WillShutterController.shared.attachDevice(device) apres setup
 *      exposure -> garde le ref AVCaptureDevice.
 *   2. Helper `public final class WillShutterController` (singleton)
 *      expose `setMaxExposureDuration(_:brightness:)` callable depuis
 *      l'app target (ExposureReaderPlugin) via `import VisionCamera`.
 *      Cache last-applied (cap + label) -> NSLog [WILL-CAM] sur change
 *      uniquement, pas de spam au tick 1Hz du worklet.
 *
 * Marqueurs :
 *   - HOOK_MARKER inline pour le call attachDevice (inchange depuis v1).
 *   - HELPER_BEGIN / HELPER_END encadrent le bloc helper -> rewriting
 *     idempotent sur builds successifs (le bloc est purge + re-injecte
 *     a chaque prebuild iOS, donc plus de v1 a stripper).
 *
 * Fail-loud : throws si le bloc exposure VisionCamera est modifie upstream.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_REL_PATH =
  'node_modules/react-native-vision-camera/ios/Core/CameraSession+Configuration.swift';

const HOOK_MARKER = '[will-shutter-lock-hook]';
const HELPER_BEGIN = '// [will-shutter-lock-helper-v2] BEGIN';
const HELPER_END = '// [will-shutter-lock-helper-v2] END';
const HELPER_OLD_MARKER = '// [will-shutter-lock-helper]'; // v1 single-line marker

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
    // ${HOOK_MARKER} Attache le device au controller WillShutterController.
    // Le mode reste .continuousAutoExposure -> Deep Fusion + Smart HDR
    // preserves. Le cap shutter eventuellement applique apres via
    // setMaxExposureDuration n'altere PAS le mode (juste un plafond max).
    WillShutterController.shared.attachDevice(device)`;

const HELPER_BODY = `// Hook NSLog [WILL-CAM] + setter shutter cap adaptatif. Public pour etre
// appelable depuis l app target (ExposureReaderPlugin -> import VisionCamera
// -> WillShutterController.shared.setMaxExposureDuration(...)). Le mode
// d exposition reste .continuousAutoExposure : on plafonne juste la duree
// d expo max, iOS reste libre de choisir une duree plus rapide.

public final class WillShutterController {
  public static let shared = WillShutterController()

  private weak var device: AVCaptureDevice?
  private var lastAppliedCapSec: Double = -1
  private var lastAppliedLabel: String = ""
  private let lock = NSLock()

  private init() {}

  public func attachDevice(_ d: AVCaptureDevice) {
    Self.logCameraInfo(d)
    lock.lock()
    self.device = d
    // Reset cache au reattach (nouvelle session = nouveau device).
    self.lastAppliedCapSec = -1
    self.lastAppliedLabel = ""
    lock.unlock()
  }

  public func setMaxExposureDuration(_ durationSec: Double, brightness label: String) {
    guard durationSec.isFinite else { return }
    lock.lock()
    defer { lock.unlock() }
    guard let d = device else { return }
    // Dedupe : meme cap + meme label -> no-op (evite spam NSLog + lockForConfig
    // alors qu on call ce setter 1 fois par seconde depuis le worklet).
    if abs(durationSec - lastAppliedCapSec) < 1e-7 && label == lastAppliedLabel { return }

    // durationSec <= 0 = RELEASE : pas de plafond, iOS choisit librement
    // (utilise en lumiere OK ou pour desactiver tout cap).
    let release = (durationSec <= 0)
    let fmtMax = d.activeFormat.maxExposureDuration
    let fmtMin = d.activeFormat.minExposureDuration
    let bounded: CMTime = release
      ? fmtMax
      : CMTimeMaximum(fmtMin, CMTimeMinimum(CMTimeMakeWithSeconds(durationSec, preferredTimescale: 1_000_000), fmtMax))

    do {
      try d.lockForConfiguration()
      d.activeMaxExposureDuration = bounded
      d.unlockForConfiguration()
      lastAppliedCapSec = durationSec
      lastAppliedLabel = label
      if release {
        NSLog("[WILL-CAM] shutter cap RELEASED (no plafond, iOS libre) brightness=%@", label)
      } else {
        let appliedSec = CMTimeGetSeconds(bounded)
        NSLog("[WILL-CAM] shutter cap applied: requested=1/%.0fs effective=1/%.0fs brightness=%@",
              1.0 / durationSec, 1.0 / max(appliedSec, 1e-7), label)
      }
    } catch {
      NSLog("[WILL-CAM] shutter cap lockForConfiguration failed: %@", error.localizedDescription)
    }
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
}`;

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

  // 1. Hook inline (attachDevice call) — identique a v1, sans modification.
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

  // 2. Strip ancien helper v1 si present (single-line marker, body jusqu a EOF).
  if (!content.includes(HELPER_BEGIN)) {
    const oldIdx = content.indexOf(HELPER_OLD_MARKER);
    if (oldIdx !== -1) {
      content = content.slice(0, oldIdx).trimEnd() + '\n';
      console.log('[with-shutter-lock] stripped v1 helper block (body to EOF)');
      changed = true;
    }
  }

  // 3. v2 helper : strip ancien bloc v2 (BEGIN..END) puis re-injecte.
  const v2Start = content.indexOf(HELPER_BEGIN);
  if (v2Start !== -1) {
    const v2End = content.indexOf(HELPER_END, v2Start);
    if (v2End !== -1) {
      content = content.slice(0, v2Start) + content.slice(v2End + HELPER_END.length);
      console.log('[with-shutter-lock] replaced existing v2 helper block');
      changed = true;
    } else {
      throw new Error(
        '[with-shutter-lock] HELPER_BEGIN present mais HELPER_END manquant — fichier corrompu, vider node_modules.'
      );
    }
  }
  content = content.trimEnd() + '\n\n' + HELPER_BEGIN + '\n' + HELPER_BODY + '\n' + HELPER_END + '\n';
  changed = true;
  console.log('[with-shutter-lock] v2 helper injected (public WillShutterController + setter)');

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
