//
//  PhotoMetadataBurner.swift
//  WillApp
//
//  Module RCT : pipeline post-capture sur le fichier ecrit par VisionCamera
//    1. Enhance (CIImage.autoAdjustmentFilters)
//    2. Burn d'un badge technique (shutter / ISO / aperture) en bas a droite
//    3. Reencodage HEIC in-place (UIImage HEIC via ImageIO)
//
//  burnMetadata(path:label:) -> resolve(path) / reject(code, message)
//

import Foundation
import UIKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers

// Bridge des types Obj-C de React Native vers Swift. RCTPromiseResolveBlock
// et RCTPromiseRejectBlock sont des typedef Obj-C de RCTBridgeModule.h qui
// ne sont pas visibles depuis Swift sans bridging header. On les redeclare
// avec la signature equivalente : le runtime Obj-C reconcilie les blocks
// et closures Swift de meme arite/types automatiquement.
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void

@objc(PhotoMetadataBurner)
class PhotoMetadataBurner: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  // CIContext partage : creation couteuse (~50 ms), thread-safe a l'usage.
  // Pas un hot path mais inutile de payer le cout repete.
  private static let ciContext = CIContext()

  // Encode un UIImage en HEIC via ImageIO (iOS 14+ pour UTType.heic).
  // Quality 0.88 ≈ JPEG q95 visuellement, ~2x plus petit en taille.
  private static func encodeHEIC(_ image: UIImage, quality: CGFloat) -> Data? {
    guard let cgImage = image.cgImage else { return nil }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(
      data, UTType.heic.identifier as CFString, 1, nil
    ) else { return nil }
    CGImageDestinationAddImage(dest, cgImage, [
      kCGImageDestinationLossyCompressionQuality: quality
    ] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
  }

  // Applique la chaine de filtres autoAdjustmentFilters (equivalent du
  // bouton "auto enhance" de Photos.app : balance expo + contraste + tone
  // curve + saturation selon ce que CoreImage detecte). Retourne nil si
  // l'image ne peut pas etre convertie en CIImage.
  private static func applyAutoEnhance(_ uiImage: UIImage) -> UIImage? {
    guard let ciImage = CIImage(image: uiImage) else { return nil }
    let filters = ciImage.autoAdjustmentFilters()
    if filters.isEmpty {
      NSLog("[enhance] no filters suggested, returning original")
      return uiImage
    }
    var current: CIImage = ciImage
    for filter in filters {
      filter.setValue(current, forKey: kCIInputImageKey)
      guard let out = filter.outputImage else { continue }
      current = out
    }
    guard let cg = ciContext.createCGImage(current, from: current.extent) else {
      return nil
    }
    NSLog("[enhance] applied: %d filters", filters.count)
    return UIImage(cgImage: cg, scale: uiImage.scale, orientation: uiImage.imageOrientation)
  }

  @objc(burnMetadata:label:resolver:rejecter:)
  func burnMetadata(_ path: String,
                    label: String,
                    resolver: @escaping RCTPromiseResolveBlock,
                    rejecter: @escaping RCTPromiseRejectBlock) {
    // Accepte file:// ou chemin nu
    let cleanPath = path.replacingOccurrences(of: "file://", with: "")
    guard FileManager.default.fileExists(atPath: cleanPath) else {
      rejecter("E_NOT_FOUND", "File not found: \(cleanPath)", nil)
      return
    }
    guard let original = UIImage(contentsOfFile: cleanPath) else {
      rejecter("E_LOAD", "Could not load image at \(cleanPath)", nil)
      return
    }

    // 1. Enhance (auto-adjust). Si la chaine echoue, on burn sur l'original
    // (pas un bloqueur fonctionnel — un photographe prefere une photo non
    // enhanced a une erreur de capture).
    let enhanced = Self.applyAutoEnhance(original) ?? original

    // 2. Burn badge. Taille proportionnelle a l'image : sur photo 4032 wide
    // → ~52 px de font, badge lisible sans dominer la photo (perçu ~12 pt
    // a l'ecran sur phone).
    let imageW = enhanced.size.width
    let fontSize = max(20.0, imageW * 0.013)
    let padding = max(6.0, imageW * 0.0085)
    let margin = max(16.0, imageW * 0.020)
    let cornerRadius = max(4.0, padding * 0.8)

    let font = UIFont.systemFont(ofSize: fontSize, weight: .medium)
    let attrs: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: UIColor.white,
    ]
    let attrText = NSAttributedString(string: label, attributes: attrs)
    let textSize = attrText.size()

    let badgeW = textSize.width + 2 * padding
    let badgeH = textSize.height + 2 * padding
    let badgeX = enhanced.size.width - badgeW - margin
    let badgeY = enhanced.size.height - badgeH - margin
    let badgeRect = CGRect(x: badgeX, y: badgeY, width: badgeW, height: badgeH)

    let renderer = UIGraphicsImageRenderer(size: enhanced.size)
    let burned = renderer.image { _ in
      enhanced.draw(at: .zero)
      let bgPath = UIBezierPath(roundedRect: badgeRect, cornerRadius: cornerRadius)
      UIColor.black.withAlphaComponent(0.5).setFill()
      bgPath.fill()
      attrText.draw(at: CGPoint(x: badgeX + padding, y: badgeY + padding))
    }
    NSLog("[burn] applied: %@", label)

    // 3. Reencodage HEIC. Pas de fallback JPEG : avec un deploymentTarget
    // iOS 16, HEIC est garanti disponible — un echec ici est un signal a
    // remonter (fail-loud) plutot qu'a masquer avec un .jpg silencieux.
    guard let heicData = Self.encodeHEIC(burned, quality: 0.88) else {
      rejecter("E_ENCODE", "Could not encode burned image as HEIC", nil)
      return
    }
    do {
      try heicData.write(to: URL(fileURLWithPath: cleanPath), options: .atomic)
      resolver(path)
    } catch {
      rejecter("E_WRITE", "Could not write image: \(error.localizedDescription)", nil)
    }
  }
}
