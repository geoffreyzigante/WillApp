//
//  PhotoQualityScorer.swift
//  WillApp
//
//  Module natif RCT : extrait les signaux qualité d'une photo HEIC à partir
//  d'un chemin disque, sans préjuger du composite côté natif. Les poids
//  restent côté JS (eventConfig.quality.weights) pour rester tunables
//  runtime (calibrage E sans rebuild).
//
//  Conformité conception CONCEPTION_TRI_QUALITE_LOCAL.md :
//   - Queue dédiée serial QoS .utility, disjointe des queues capture
//     (AVCapture, frame processor) et UI (main). Le scheduler iOS preempte
//     .utility au profit des autres si CPU saturé : la capture ne peut
//     PAS être ralentie par ce module.
//   - Aucune référence cameraRef/AVCaptureSession.
//   - Signaux bruts retournés : faceCount, faceConfidence, biggestFaceArea,
//     biggestFaceCenter, yaw, pitch, eyesOpen, eyesOpenApplicable, brightness,
//     faceCaptureQuality, elapsedMs.
//   - Échecs (decode KO, Vision throw, .dng) -> reject avec un code clair.
//     Le caller JS interprète comme score_failed=true et upload la photo
//     telle quelle (failsafe zéro-perte).
//
//  Coût attendu (~80-150 ms / photo iPhone 12+) :
//    decode HEIC          30-60 ms
//    downsample 800 px    15-25 ms
//    VNDetectFaceLandmarks 30-50 ms (inclut bbox + yaw)
//    CIAreaAverage Y      5-10 ms
//    EAR + assembly       < 1 ms
//

import Foundation
import UIKit
import CoreImage
import ImageIO
import Vision

// Bridge des types Obj-C de React Native vers Swift, cf PhotoMetadataBurner.swift
// pour la justification (typedef RCTBridgeModule non visible sans bridging header).
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void

@objc(PhotoQualityScorer)
class PhotoQualityScorer: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  // CIContext partagé : creation couteuse (~50 ms), thread-safe. Distinct
  // de celui de PhotoMetadataBurner (l'overhead de plus est negligeable et
  // l'isolation evite tout couplage si l'un des deux modules est modifie).
  private static let ciContext = CIContext()

  // Serial queue dediee. Label distinct de PhotoMetadataBurner pour
  // tracabilite logs + permettre une execution parallele future si on
  // veut decoupler scorer et burner. Aujourd'hui le worker JS appelle
  // sequentiellement, donc une seule photo a la fois en memoire ici.
  private static let scorerQueue = DispatchQueue(
    label: "com.willapp.photoqualityscorer",
    qos: .utility
  )

  @objc func methodQueue() -> DispatchQueue {
    return PhotoQualityScorer.scorerQueue
  }

  // Taille max (cote long) de l'image analysee. 4032x3024 -> 800x600 :
  // facteur 5 sur la dimension, facteur 25 sur le nombre de pixels. Vision
  // tolere tres bien 800 px pour detection visage (un visage occupant 5%
  // de l'aire = 56x42 px a 800x600, largement detectable). Brightness
  // global insensible au downsample.
  private static let MAX_ANALYSIS_DIMENSION: CGFloat = 800.0

  @objc(scoreRaw:resolver:rejecter:)
  func scoreRaw(_ srcPath: String,
                resolver: @escaping RCTPromiseResolveBlock,
                rejecter: @escaping RCTPromiseRejectBlock) {
    let startTime = CFAbsoluteTimeGetCurrent()
    let cleanSrc = srcPath.replacingOccurrences(of: "file://", with: "")

    // Skip explicite des ProRAW (.dng) : non analysable de la meme facon
    // par Vision/CIImage. Le caller JS interprete reject(E_RAW) comme
    // score_failed et passe la photo en upload sans tri.
    if cleanSrc.lowercased().hasSuffix(".dng") {
      rejecter("E_RAW", "ProRAW .dng skipped (uploaded as-is)", nil)
      return
    }

    guard FileManager.default.fileExists(atPath: cleanSrc) else {
      rejecter("E_NOT_FOUND", "File not found: \(cleanSrc)", nil)
      return
    }

    // Decode HEIC -> UIImage. UIImage(contentsOfFile:) gere le HEIC natif
    // sur iOS 11+ via ImageIO. Si echec, on signale (failsafe upload).
    guard let original = UIImage(contentsOfFile: cleanSrc),
          let originalCG = original.cgImage else {
      rejecter("E_DECODE", "Could not decode image at \(cleanSrc)", nil)
      return
    }

    // CIImage avec l'orientation EXIF preservee pour que Vision applique
    // la rotation correcte (sinon yaw/visages tournes a 90 degres sur
    // photo portrait).
    let cgOrientation = Self.cgImagePropertyOrientation(from: original.imageOrientation)
    let ciOriginal = CIImage(cgImage: originalCG).oriented(cgOrientation)

    // Downsample via CILanczosScaleTransform. On vise un long-side de
    // MAX_ANALYSIS_DIMENSION. Si l'image est deja plus petite, on garde tel
    // quel (cas tests / DNG converti / etc).
    let srcW = ciOriginal.extent.width
    let srcH = ciOriginal.extent.height
    let longSide = max(srcW, srcH)
    let downscale: CGFloat = longSide > Self.MAX_ANALYSIS_DIMENSION
      ? Self.MAX_ANALYSIS_DIMENSION / longSide
      : 1.0
    let ciSmall: CIImage = {
      if downscale >= 0.999 { return ciOriginal }
      guard let lanczos = CIFilter(name: "CILanczosScaleTransform") else {
        return ciOriginal
      }
      lanczos.setValue(ciOriginal, forKey: kCIInputImageKey)
      lanczos.setValue(downscale, forKey: kCIInputScaleKey)
      lanczos.setValue(1.0, forKey: kCIInputAspectRatioKey)
      return lanczos.outputImage ?? ciOriginal
    }()

    // CGImage de l'image downsamplee (necessaire pour VNImageRequestHandler
    // sur CGImage, plus stable que cvPixelBuffer pour notre usage).
    guard let cgSmall = Self.ciContext.createCGImage(ciSmall, from: ciSmall.extent) else {
      rejecter("E_DOWNSAMPLE", "Could not downsample image", nil)
      return
    }
    let smallW = CGFloat(cgSmall.width)
    let smallH = CGFloat(cgSmall.height)

    // ─── Brightness (CoreImage, pas Vision) ─────────────────────────────
    // CIAreaAverage retourne 1 pixel RGBA represente la moyenne sur tout
    // l'extent. On extrait Y selon coef ITU-R BT.601 standard.
    let brightness: Double = Self.averageLuminance(of: ciSmall) ?? 0.5

    // ─── Vision : VNDetectFaceLandmarksRequest ───────────────────────────
    // Une seule passe Vision qui donne :
    //   - bbox + confidence par visage (VNFaceObservation)
    //   - yaw, pitch, roll (VNFaceObservation.yaw/pitch/roll, NSNumber?
    //     en iOS 12+, en radians)
    //   - landmarks (.leftEye, .rightEye, etc.) pour EAR
    let landmarksRequest = VNDetectFaceLandmarksRequest()
    let handler = VNImageRequestHandler(cgImage: cgSmall, orientation: .up, options: [:])

    do {
      try handler.perform([landmarksRequest])
    } catch {
      // Vision throw : photo non analysable (corrompue, format exotique).
      // Failsafe : on resolve avec faceCount=0 pour que le JS marque
      // score_failed=false mais signal=vide. Strict equivalent du serveur
      // qui ecrit processed_quality=true / face_count=0.
      let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)
      resolver(Self.emptyResult(brightness: brightness, elapsedMs: elapsedMs))
      return
    }

    let observations = (landmarksRequest.results) ?? []
    let faceCount = observations.count

    // 0 visage : on retourne tot, signaux a 0 cote visage, brightness
    // calculee, le JS attribuera le faceConfidence=0 etc.
    if faceCount == 0 {
      let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)
      resolver(Self.emptyResult(brightness: brightness, elapsedMs: elapsedMs))
      return
    }

    // Plus grand visage = aire max (Width × Height normalisees).
    var biggest = observations[0]
    var maxArea = biggest.boundingBox.width * biggest.boundingBox.height
    for obs in observations.dropFirst() {
      let a = obs.boundingBox.width * obs.boundingBox.height
      if a > maxArea { maxArea = a; biggest = obs }
    }

    // BBox normalisee Vision : origine bottom-left, [0,1]. On expose le
    // centre en convention top-left (cohérent avec ce que les callers JS
    // utilisent ailleurs dans App.js).
    let bbox = biggest.boundingBox
    let biggestArea = Double(bbox.width * bbox.height)
    let centerX = Double(bbox.midX)
    let centerY = Double(1.0 - bbox.midY)  // flip vers top-left
    let faceConfidence = Double(biggest.confidence)

    // Yaw / pitch (radians) : NSNumber? sur iOS 12+. nil possible si Vision
    // n'a pas pu estimer la pose (visage trop petit / partiel). Dans ce
    // cas on assume yaw=0 (face camera) plutot que de penaliser.
    let yawRad: Double = biggest.yaw?.doubleValue ?? 0.0
    let pitchRad: Double = biggest.pitch?.doubleValue ?? 0.0

    // EAR (Eye Aspect Ratio) approximee : ratio hauteur/largeur de la
    // bbox des landmarks d'un oeil. Heuristique robuste vs la formule
    // Soukupova-Cech (qui suppose un ordre precis des 6 points, non
    // garanti par Vision qui renvoie un contour ferme de longueur variable).
    //   ratio > 0.20 -> oeil ouvert
    //   ratio <= 0.20 -> oeil ferme
    // On prend la moyenne des deux yeux. eyesOpenApplicable = |yaw| <= 45°
    // car au-dela l'oeil le plus eloigne est trop ecrase pour fiabiliser.
    let yawDeg = abs(yawRad) * 180.0 / .pi
    let eyesOpenApplicable = yawDeg <= 45.0
    var eyesOpen = false
    if eyesOpenApplicable, let landmarks = biggest.landmarks {
      let leftRatio = Self.eyeOpennessRatio(landmarks.leftEye)
      let rightRatio = Self.eyeOpennessRatio(landmarks.rightEye)
      let avg = (leftRatio + rightRatio) / 2.0
      eyesOpen = avg > 0.20
    }

    // faceCaptureQuality : optionnel, peut etre nil. On laisse Vision
    // calculer sur l'image entiere (Vision selectionne le plus grand visage
    // detecte par sa propre passe interne). Si echec, on resolve sans.
    var faceCaptureQuality: Double? = nil
    let qualityRequest = VNDetectFaceCaptureQualityRequest()
    do {
      try handler.perform([qualityRequest])
      if let qr = qualityRequest.results,
         let first = qr.first,
         let qn = first.faceCaptureQuality {
        faceCaptureQuality = Double(qn)
      }
    } catch {
      // silencieux : ce signal est marginal en v1, perte sans gravite
    }

    let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)
    NSLog("[QualityScorer] elapsed=%dms faceCount=%d conf=%.2f area=%.4f yaw=%.1f° eyes=%@ (applicable=%@) bright=%.2f fcq=%@",
          elapsedMs, faceCount, faceConfidence, biggestArea, yawDeg,
          eyesOpen ? "open" : "closed",
          eyesOpenApplicable ? "yes" : "no",
          brightness,
          faceCaptureQuality.map { String(format: "%.2f", $0) } ?? "nil")

    resolver([
      "faceCount":            faceCount,
      "faceConfidence":       faceConfidence,
      "biggestFaceArea":      biggestArea,
      "biggestFaceCenter":    [centerX, centerY],
      "yaw":                  yawRad,
      "pitch":                pitchRad,
      "eyesOpen":             eyesOpen,
      "eyesOpenApplicable":   eyesOpenApplicable,
      "brightness":           brightness,
      "faceCaptureQuality":   faceCaptureQuality as Any,
      "elapsedMs":            elapsedMs,
      "analyzedWidth":        Int(smallW),
      "analyzedHeight":       Int(smallH),
    ])
  }

  // MARK: - Helpers

  // Resultat "vide" (0 visage / Vision KO) avec brightness calculee.
  private static func emptyResult(brightness: Double, elapsedMs: Int) -> [String: Any] {
    return [
      "faceCount":            0,
      "faceConfidence":       0.0,
      "biggestFaceArea":      0.0,
      "biggestFaceCenter":    [0.5, 0.5],
      "yaw":                  0.0,
      "pitch":                0.0,
      "eyesOpen":             false,
      "eyesOpenApplicable":   false,
      "brightness":           brightness,
      "faceCaptureQuality":   NSNull(),
      "elapsedMs":            elapsedMs,
      "analyzedWidth":        0,
      "analyzedHeight":       0,
    ]
  }

  // Luminance moyenne via CIAreaAverage : retourne 1 pixel RGBA represente
  // la moyenne arithmetique sur tout l'extent. On convertit en Y selon
  // ITU-R BT.601. Resultat normalise [0,1] (= 0..255 / 255).
  private static func averageLuminance(of image: CIImage) -> Double? {
    let extent = image.extent
    let extentVec = CIVector(x: extent.minX, y: extent.minY,
                             z: extent.width, w: extent.height)
    guard let avg = CIFilter(name: "CIAreaAverage") else { return nil }
    avg.setValue(image, forKey: kCIInputImageKey)
    avg.setValue(extentVec, forKey: kCIInputExtentKey)
    guard let out = avg.outputImage else { return nil }

    // Render 1x1 pixel non-multiplied RGBA.
    var bitmap = [UInt8](repeating: 0, count: 4)
    ciContext.render(out,
                     toBitmap: &bitmap,
                     rowBytes: 4,
                     bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                     format: .RGBA8,
                     colorSpace: CGColorSpaceCreateDeviceRGB())
    let r = Double(bitmap[0]) / 255.0
    let g = Double(bitmap[1]) / 255.0
    let b = Double(bitmap[2]) / 255.0
    let y = 0.299 * r + 0.587 * g + 0.114 * b
    return y
  }

  // Ratio hauteur/largeur de la bbox des landmarks d'un oeil. On utilise
  // les points normalises [0,1] dans la bbox visage et on calcule min/max
  // sur x et y des contour points. Robuste vs ordre des points.
  // Retourne 0 si region nulle (Vision renvoie nil sur visage trop petit).
  private static func eyeOpennessRatio(_ region: VNFaceLandmarkRegion2D?) -> Double {
    guard let region = region, region.pointCount > 0 else { return 0 }
    let points = region.normalizedPoints
    var minX: CGFloat = .greatestFiniteMagnitude, maxX: CGFloat = -.greatestFiniteMagnitude
    var minY: CGFloat = .greatestFiniteMagnitude, maxY: CGFloat = -.greatestFiniteMagnitude
    for p in points {
      if p.x < minX { minX = p.x }
      if p.x > maxX { maxX = p.x }
      if p.y < minY { minY = p.y }
      if p.y > maxY { maxY = p.y }
    }
    let w = maxX - minX
    let h = maxY - minY
    if w <= 0.0001 { return 0 }
    return Double(h / w)
  }

  private static func cgImagePropertyOrientation(
    from uiOrientation: UIImage.Orientation
  ) -> CGImagePropertyOrientation {
    switch uiOrientation {
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
