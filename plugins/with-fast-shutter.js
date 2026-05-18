/**
 * Expo Config Plugin: with-fast-shutter
 *
 * Patches react-native-vision-camera (iOS) to use an ADAPTIVE shutter on the
 * back camera. The control loop reads `exposureTargetOffset` every 500ms and
 * picks a rung on a 4-step shutter ladder (1/2000, 1/1000, 1/500, 1/250) to
 * keep the exposure roughly centered without crushing motion. ISO is capped
 * at min(activeFormat.maxISO, 6400) to give headroom in low light.
 *
 * The current rung is mirrored to <Caches>/will_shutter.json so the JS side
 * (PhotographerScreen) can poll it and render a light indicator (green /
 * yellow / red) + the live shutter speed. Front camera keeps the auto
 * exposure path (selfies need slow shutter indoors).
 *
 * IMPORTANT: this patch ships native Swift, so it requires a new EAS BUILD
 * (eas build --profile preview --platform ios) — NOT an OTA update.
 *
 * Implementation notes:
 *  - Idempotent: marker check skips re-patching.
 *  - Fail-loud: throws if the upstream block has moved (vision-camera bump),
 *    so the regression surfaces in CI rather than producing a silent broken
 *    binary.
 *  - The adaptive controller is appended at the end of the same file as a
 *    fileprivate class — avoids creating new build inputs in node_modules.
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

const REPLACE = `    // ${MARKER} Adaptive shutter on BACK camera: ladder 1/2000 → 1/250 driven
    // by exposureTargetOffset. Front camera keeps continuousAutoExposure
    // because forcing fast shutter indoors makes selfies unusable.
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
    }
    if device.position == .back && device.isExposureModeSupported(.custom) {
      device.exposureMode = .custom
      let initialShutter = CMTime(value: 1, timescale: 1000)
      let isoCap = min(device.activeFormat.maxISO, 6400)
      let initialIso = max(device.activeFormat.minISO, min(isoCap, AVCaptureDevice.currentISO))
      device.setExposureModeCustom(duration: initialShutter, iso: initialIso) { _ in }
      WillAdaptiveShutter.shared.start(device: device, isoCap: isoCap)
      print("[FastShutter] adaptive shutter started on back camera (iso cap=\\(isoCap))")
    } else if device.isExposureModeSupported(.continuousAutoExposure) {
      device.exposureMode = .continuousAutoExposure
    }`;

const HELPER = `

${HELPER_MARKER}
// Adaptive shutter controller for the WillApp photographer mode.
// Reads exposureTargetOffset every 500ms and maps it directly to a rung on
// the shutter ladder. iOS convention: positive offset = scene BRIGHTER than
// the current custom exposure (faster shutter is OK), negative offset =
// scene DARKER (need to slow shutter down to let more light in).
// Mirrors current state to <Caches>/will_shutter.json so JS can render a
// light indicator. Singleton to survive across configureExposure calls.
// (Foundation + AVFoundation are already imported at the top of this file.)

fileprivate final class WillAdaptiveShutter {
  static let shared = WillAdaptiveShutter()

  // Direct offset → shutter mapping (no step/hysteresis state to avoid the
  // direction-confusion bug we hit before). Thresholds aligned with the
  // user's spec : >=+1.5 EV = bright outdoor, -1.5 to +0.5 = normal/low,
  // <=-1.5 = very dark.
  private static func rungFor(offset: Float) -> (CMTime, String, String) {
    if offset >= 1.5  { return (CMTime(value: 1, timescale: 2000), "1/2000s", "green") }
    if offset >= 0.5  { return (CMTime(value: 1, timescale: 1000), "1/1000s", "green") }
    if offset >= -1.5 { return (CMTime(value: 1, timescale: 500),  "1/500s",  "yellow") }
    return (CMTime(value: 1, timescale: 250), "1/250s", "red")
  }

  private var timer: DispatchSourceTimer?
  private weak var device: AVCaptureDevice?
  private var isoCap: Float = 6400
  private var lastTimescale: Int32 = 0 // pour ne re-appliquer la config que sur changement de rung

  func start(device: AVCaptureDevice, isoCap: Float) {
    self.device = device
    self.isoCap = isoCap
    self.lastTimescale = 0
    timer?.cancel()
    let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
    t.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(500))
    t.setEventHandler { [weak self] in self?.tick() }
    t.resume()
    timer = t
  }

  private func tick() {
    guard let device = device else { return }
    let offset = device.exposureTargetOffset
    let rung = WillAdaptiveShutter.rungFor(offset: offset)
    NSLog("[Will-Shutter] offset=%.2f shutter=%@", offset, rung.1)
    if rung.0.timescale != lastTimescale {
      lastTimescale = rung.0.timescale
      apply(duration: rung.0)
    }
    writeState(label: rung.1, level: rung.2)
  }

  private func apply(duration: CMTime) {
    guard let device = device else { return }
    do {
      try device.lockForConfiguration()
      let minIso = device.activeFormat.minISO
      let targetIso = max(minIso, min(isoCap, AVCaptureDevice.currentISO))
      device.setExposureModeCustom(duration: duration, iso: targetIso) { _ in }
      device.unlockForConfiguration()
    } catch {
      NSLog("[Will-Shutter] lockForConfiguration failed: %@", String(describing: error))
    }
  }

  private func writeState(label: String, level: String) {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    let json = "{\\"shutter\\":\\"\\(label)\\",\\"level\\":\\"\\(level)\\",\\"ts\\":\\(ts)}"
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
