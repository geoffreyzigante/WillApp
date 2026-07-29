//
//  HumanDetectorPlugin.swift
//  WillApp
//
//  VisionCamera frame processor plugin : detecte les VISAGES (face / profil)
//  via Apple Vision VNDetectFaceRectanglesRequest. Retourne uniquement le
//  compte ; pas de bbox, pas de tracking.
//
//  2026-05-20 : switch volontaire de VNDetectHumanRectanglesRequest vers
//  VNDetectFaceRectanglesRequest. L'ancienne request declenchait sur les
//  silhouettes pleines, y compris les dos -> photos inexploitables (numero
//  de dossard non visible, visage absent). Le face detector n'identifie un
//  match QUE si les patterns de visage (yeux/nez/bouche) sont visibles, donc
//  jamais sur un dos. Trade-off accepte : on peut rater des coureurs lointains
//  dont le visage fait <30px ou un peloton vu d'en haut. Si terrain montre
//  trop de loupes, evolution v2 = mode hybride face OU silhouette filtree.
//
//  La nom JS reste "detectHumans" (cf. HumanDetectorPlugin.m) -- changement
//  purement interne, le code RN ne bouge pas.
//
//  Appel JS (worklet) :
//      const { count, ts, faces } = detectHumans(frame, { zoneWidthPercent: 0.3 })
//
//  2026-07-29 — v2 : exposition des bounding box (cf.
//  CONCEPTION_DECLENCHEMENT_LIGNES.md §1.1). Elles etaient DEJA calculees pour
//  le filtrage de zone puis jetees ; on les renvoie desormais. Aucun travail
//  Vision supplementaire, seul le cout de serialisation s'ajoute (<= ~10 petits
//  dicts a 10 fps : negligeable).
//
//    count : INCHANGE — visages dans la zone. Compat onHumansDetectedJS.
//    ts    : presentation timestamp du buffer, en secondes. Base monotone
//            propre a la session : seules les DIFFERENCES ont un sens
//            (estimation de vitesse). Ne pas comparer a Date.now().
//    faces : TOUS les visages, pas seulement ceux en zone — le tracker doit
//            voir un coureur approcher AVANT qu'il entre dans la zone, sinon
//            il n'a aucune vitesse au franchissement de la premiere ligne.
//            Coordonnees normalisees [0,1] dans le repere image apres rotation
//            cgOrientation. cx/cy = centre, w/h = taille.
//
//  Performance : ~3-5 ms par frame sur iPhone 12+ (face detector plus leger
//  que human detector). Tourne sur la queue VisionCamera (background).
//
//  DEBUG TEMPORAIRE : log NSLog quand le count change (brut + filtre zone).
//  A retirer en v2 si terrain valide la detection face-only.
//

import Foundation
import Vision
import VisionCamera
import CoreMedia
import UIKit

@objc(HumanDetectorPlugin)
public class HumanDetectorPlugin: FrameProcessorPlugin {
  private let request = VNDetectFaceRectanglesRequest()

  // Memoise le dernier count logge pour ne logguer qu'aux transitions
  // (sinon 10 fps de spam). A retirer en v2 (debug temporaire).
  private var lastLoggedRaw: Int = -1
  private var lastLoggedFiltered: Int = -1

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]? = nil) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard CMSampleBufferIsValid(frame.buffer),
          let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer)
    else {
      return ["count": 0, "ts": 0.0, "faces": [[String: Any]]()]
    }

    // Horloge du buffer, pas l'horloge murale : monotone, sans gigue de
    // dispatch. Le tracker n'en utilise que les differences.
    let pts = CMSampleBufferGetPresentationTimeStamp(frame.buffer)
    let ts = CMTimeGetSeconds(pts)

    let orientation = cgOrientation(from: frame.orientation)
    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer,
      orientation: orientation,
      options: [:]
    )

    // Axe de filtrage configurable par lentille via JS args : ultra-wide a
    // empiriquement donne midY (cf historique), mais sur wide 1x la zone
    // visuelle ne match plus. JS passe axis='midX'|'midY' explicit. Default
    // 'midY' pour preserver le comportement ultra-wide existant.
    // Bbox normalisees [0,1] dans le repere image apres rotation cgOrientation.
    let axis: String = (arguments?["axis"] as? String) ?? "midY"
    var zoneWidth: Double = 1.0
    if let z = arguments?["zoneWidthPercent"] as? Double {
      zoneWidth = z
    } else if let z = arguments?["zoneWidthPercent"] as? NSNumber {
      zoneWidth = z.doubleValue
    }
    zoneWidth = max(0.0, min(1.0, zoneWidth))
    let half = zoneWidth / 2.0
    let zMin = 0.5 - half
    let zMax = 0.5 + half

    do {
      try handler.perform([request])
      let results = (request.results as? [VNFaceObservation]) ?? []
      let raw = results.count
      let filtered = results.filter { obs in
        let c: Double = (axis == "midX")
          ? Double(obs.boundingBox.midX)
          : Double(obs.boundingBox.midY)
        return c >= zMin && c <= zMax
      }.count

      // v2 : TOUS les visages, zone comprise ou non (cf. en-tete). Vision
      // renvoie ses bbox avec l'origine en BAS a gauche ; on bascule cy en
      // repere image (origine en haut) pour coller aux conventions JS/RN et
      // eviter une inversion silencieuse cote tracker.
      let faces: [[String: Any]] = results.map { obs in
        let b = obs.boundingBox
        return [
          "cx": Double(b.midX),
          "cy": 1.0 - Double(b.midY),
          "w":  Double(b.width),
          "h":  Double(b.height),
        ]
      }

      // DEBUG : log enrichi aux transitions du count. Dump des DEUX axes
      // par bbox pour pouvoir trancher quel axe matche la bande visuelle
      // sur chaque lentille. orient = hint VisionCamera applique pour la
      // rotation (1=up, 6=right, ...). A retirer en v2.
      if raw != lastLoggedRaw || filtered != lastLoggedFiltered {
        let bboxLog = results.map { obs -> String in
          String(format: "(x=%.2f,y=%.2f)", obs.boundingBox.midX, obs.boundingBox.midY)
        }.joined(separator: " ")
        NSLog("[FaceDetector] raw=%d filtered=%d axis=%@ zone=%.2f orient=%d bboxes=%@",
              raw, filtered, axis, zoneWidth, orientation.rawValue, bboxLog)
        lastLoggedRaw = raw
        lastLoggedFiltered = filtered
      }

      return ["count": filtered, "ts": ts, "faces": faces]
    } catch {
      NSLog("[FaceDetector] perform failed: \(error.localizedDescription)")
      return ["count": 0, "ts": ts, "faces": [[String: Any]]()]
    }
  }

  private func cgOrientation(from frameOrientation: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch frameOrientation {
    case .up:            return .up
    case .down:          return .down
    case .left:          return .left
    case .right:         return .right
    case .upMirrored:    return .upMirrored
    case .downMirrored:  return .downMirrored
    case .leftMirrored:  return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default:    return .up
    }
  }
}
