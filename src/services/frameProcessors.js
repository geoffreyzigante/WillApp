// Plugins frame processor natifs, initialises UNE SEULE FOIS pour toute
// l app.
//
// VisionCameraProxy.initFrameProcessorPlugin doit etre appele une fois par
// plugin : deux appels sur le meme nom depuis deux ecrans differents sont
// une source de comportements erratiques. App.js les declarait localement ;
// ils vivent desormais ici, et l ecran selfie consomme la meme instance.

import { Platform } from 'react-native';
import { VisionCameraProxy } from 'react-native-vision-camera';

// Detection humaine via Apple Vision (VNDetectFaceRectanglesRequest +
// VNDetectHumanRectanglesRequest). Enregistre par le config plugin
// with-human-detector au build EAS.
// Retourne { count, ts, faces: [{cx, cy, w, h}], humans: [...] }.
export const humanDetectorPlugin = VisionCameraProxy.initFrameProcessorPlugin('detectHumans', {});

export function detectHumans(frame, options) {
  'worklet';
  if (humanDetectorPlugin == null) {
    throw new Error('detectHumans plugin not loaded — rebuild required');
  }
  return humanDetectorPlugin.call(frame, options);
}

// Lecture ISO / shutter / brightness depuis les attachments EXIF du buffer
// de preview, en lecture seule. Retourne { iso, shutter, brightness } ou null.
export const exposureReaderPlugin = VisionCameraProxy.initFrameProcessorPlugin('readExposure', {});

export function readExposure(frame, options) {
  'worklet';
  // Plugin absent : on rend null, on ne leve pas (pas de portage Android).
  if (exposureReaderPlugin == null) return null;
  return options ? exposureReaderPlugin.call(frame, options) : exposureReaderPlugin.call(frame);
}

// La correction d orientation 180 ne s applique qu au plugin iOS.
export const IOS_FLIP = Platform.OS === 'ios';
