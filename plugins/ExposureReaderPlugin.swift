//
//  ExposureReaderPlugin.swift
//  WillApp
//
//  VisionCamera frame processor plugin : lit les donnees d'exposition LIVE
//  (ISO, shutter, brightness) directement depuis le CMSampleBuffer en cours,
//  AVANT la moindre capture. Sert au voyant "lumiere OK/moyenne/faible" en
//  surimpression dans la vue photographe.
//
//  Source des donnees : CMCopyDictionaryOfAttachments(...kCMAttachmentMode_ShouldPropagate)
//  expose le dict {Exif} que AVCaptureSession remplit en continu sur chaque
//  frame de preview (pas seulement a la capture). Lecture O(1), pas de CPU.
//
//  LECTURE SEULE : le mode capture reste auto, on ne touche a aucune propriete
//  de AVCaptureDevice. C'est juste un sniff des metadonnees deja produites.
//
//  Cohabite sans conflit avec HumanDetectorPlugin : les deux sont des classes
//  Swift independantes enregistrees sous deux noms JS (detectHumans /
//  readExposure). Le frame processor JS les appelle sequentiellement sur la
//  meme Frame ; pattern standard VisionCamera 4.x.
//
//  Appel JS (worklet) :
//      const r = readExposure(frame)
//      r?.iso         -> Number (ex 320)
//      r?.shutter     -> Number (secondes, ex 0.008 = 1/125)
//      r?.brightness  -> Number (EV, peut etre negatif)
//      r = null si la frame n'a pas ces metadonnees (Android, ou edge case)
//
//  Throttle : le call cote JS est deja throttle (1Hz). Cote natif, on lit
//  systematiquement, pas la peine de skip — le dict lookup est presque gratuit.
//

import Foundation
import VisionCamera
import CoreMedia

@objc(ExposureReaderPlugin)
public class ExposureReaderPlugin: FrameProcessorPlugin {
  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]? = nil) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments args: [AnyHashable: Any]?) -> Any? {
    // SETTER PATH : si l app pousse un cap shutter dynamique (decide cote JS
    // d apres le voyant luminosite), applique-le sur le device en passant
    // par WillShutterController (helper public exposé par le plugin Expo
    // with-shutter-lock). Operation no-op si meme (cap, label) que le dernier
    // appel — dedupe interne au controller.
    if let args = args,
       let capSec = (args["setCapSeconds"] as? NSNumber)?.doubleValue,
       let label = args["brightnessLabel"] as? String {
      WillShutterController.shared.setMaxExposureDuration(capSec, brightness: label)
    }

    let buffer = frame.buffer
    guard CMSampleBufferIsValid(buffer) else { return nil }

    guard let attachments = CMCopyDictionaryOfAttachments(
      allocator: kCFAllocatorDefault,
      target: buffer,
      attachmentMode: kCMAttachmentMode_ShouldPropagate
    ) as? [String: Any] else {
      return nil
    }

    guard let exif = attachments["{Exif}"] as? [String: Any] else {
      return nil
    }

    var result: [String: Any] = [:]

    // ISOSpeedRatings : soit [NSNumber] (cas standard EXIF), soit NSNumber direct.
    if let arr = exif["ISOSpeedRatings"] as? [NSNumber], let first = arr.first {
      result["iso"] = first.doubleValue
    } else if let n = exif["ISOSpeedRatings"] as? NSNumber {
      result["iso"] = n.doubleValue
    }

    if let n = exif["ExposureTime"] as? NSNumber {
      result["shutter"] = n.doubleValue
    }

    if let n = exif["BrightnessValue"] as? NSNumber {
      result["brightness"] = n.doubleValue
    }

    return result.isEmpty ? nil : result
  }
}
