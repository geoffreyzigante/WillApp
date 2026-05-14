/**
 * Expo Config Plugin: with-fast-shutter
 *
 * Patches react-native-vision-camera (iOS) to force a strict
 * exposureDuration of 1/1000s with auto ISO when configuring the
 * capture device. The default behavior uses .continuousAutoExposure
 * which lets the system pick a slow shutter, producing motion blur on
 * runners. We swap that branch for .custom with a fixed CMTime, while
 * keeping the continuousAutoExposure path as a fallback for devices
 * that do not support custom exposure.
 *
 * Notes:
 *  - Idempotent: re-running prebuild does not double-patch (marker check).
 *  - Fail-loud: if the upstream block changes (vision-camera update),
 *    we throw rather than apply a silently-broken patch.
 *  - configureExposure (setExposureTargetBias) is untouched: the EV
 *    bias slider from the dashboard keeps working on top of the fixed
 *    shutter.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_REL_PATH =
  'node_modules/react-native-vision-camera/ios/Core/CameraSession+Configuration.swift';
const MARKER = '[will-fast-shutter]';

const SEARCH = `    if device.isExposureModeSupported(.continuousAutoExposure) {
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
      }
      device.exposureMode = .continuousAutoExposure
    }`;

const REPLACE = `    // ${MARKER} Force exposureDuration to 1/1000s strict, ISO auto.
    // VisionCamera 4.x patched at prebuild to freeze action shots.
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
    }
    if device.isExposureModeSupported(.custom) {
      device.exposureMode = .custom
      let fastShutter = CMTime(value: 1, timescale: 1000)
      device.setExposureModeCustom(duration: fastShutter, iso: AVCaptureDevice.currentISO) { _ in }
      print("[FastShutter] exposureDuration forced to 1/1000s")
    } else if device.isExposureModeSupported(.continuousAutoExposure) {
      device.exposureMode = .continuousAutoExposure
    }`;

function patchSwift(projectRoot) {
  const filePath = path.join(projectRoot, SWIFT_REL_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[with-fast-shutter] Fichier introuvable : ${filePath}. ` +
        'react-native-vision-camera est-il installe ?'
    );
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(MARKER)) {
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
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[with-fast-shutter] Patched CameraSession+Configuration.swift');
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
