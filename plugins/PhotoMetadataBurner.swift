//
//  PhotoMetadataBurner.swift
//  WillApp
//
//  Module RCT : pipeline post-capture sur le fichier ecrit par VisionCamera
//    1. Enhance (CIImage.autoAdjustmentFilters)
//    2. Burn d'un badge technique (shutter / ISO / aperture) en bas a droite
//    3. Reencodage HEIC (UIImage HEIC via ImageIO) vers un chemin destination
//
//  Signature out-of-place (depuis le refactor pipeline decouple) : lit
//  srcPath, ecrit dstPath. Le caller (worker JS) gere le move/cleanup du
//  source. Eviter l'ecriture in-place permet au worker de garder la photo
//  brute tant que le burn n'a pas ete confirme cote disque + queue.
//
//  Toutes les operations heavy (load UIImage, autoAdjust, render, encode
//  HEIC) tournent sur une serial DispatchQueue dediee en QoS .utility :
//  une seule photo a la fois en memoire, et la priorite basse evite de
//  voler du CPU au thread capture (VisionCamera + AVCapture).
//
//  burnMetadata(srcPath:dstPath:label:) -> resolve(dstPath) / reject(code, message)
//

import Foundation
import UIKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import AVFoundation
import CoreMedia

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

  // Serial queue dediee : une seule photo a la fois (cap memoire), QoS
  // utility pour ne pas concurrencer la capture VisionCamera.
  private static let burnerQueue = DispatchQueue(
    label: "com.willapp.photometadataburner",
    qos: .utility
  )

  // RN appelle methodQueue() pour decider sur quelle queue invoquer la
  // methode du module. On retourne notre serial queue : meme si le JS
  // appelle burnMetadata 3 fois en rafale, elles s'enchainent sans
  // parallelisme et le pic memoire reste borne a 1 photo.
  @objc func methodQueue() -> DispatchQueue {
    return PhotoMetadataBurner.burnerQueue
  }

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

  // Flags pipeline post-capture. Mis a false 2026-05-20 pour test qualite
  // brute du capteur : on veut le HEIC natif VisionCamera sans enhance ni
  // burn de badge. Repasser les DEUX a true pour restaurer le pipeline
  // historique (enhance + badge EXIF + reencode HEIC). Flags separes pour
  // pouvoir reactiver enhance ou burn independamment quand on testera un
  // suspect a la fois.
  private static let enhanceEnabled = false
  private static let burnEnabled = false

  // Construit un dict de properties CG pour ecriture dans la EXIF box +
  // TIFF box du HEIF (kCGImagePropertyExifDictionary + TIFFDictionary).
  // Distinct du XMP packet (qui etait l'approche du build precedent via
  // CGImageMetadata) : c'est la EXIF box qui est lue par Finder "Get Info"
  // et exiftool. Retourne nil si exifJson vide / non parseable -> caller
  // bascule en copie byte-pour-byte.
  private static func buildExifProperties(fromJson exifJson: String) -> [CFString: Any]? {
    guard let data = exifJson.data(using: .utf8),
          let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          !dict.isEmpty else {
      return nil
    }

    var exifProps: [CFString: Any] = [:]
    var tiffProps: [CFString: Any] = [:]

    // Shutter : EXIF stocke en seconds (Double). AVCapture donne deja en
    // seconds, on passe direct.
    if let exp = dict["ExposureTime"] as? Double, exp > 0 {
      exifProps[kCGImagePropertyExifExposureTime] = NSNumber(value: exp)
    }
    // ISO : EXIF expose typiquement un array d'Int (1 entry).
    if let arr = dict["ISOSpeedRatings"] as? [Int] {
      exifProps[kCGImagePropertyExifISOSpeedRatings] = arr
    } else if let iso = dict["ISOSpeedRatings"] as? Int {
      exifProps[kCGImagePropertyExifISOSpeedRatings] = [iso]
    }
    if let fnum = dict["FNumber"] as? Double {
      exifProps[kCGImagePropertyExifFNumber] = NSNumber(value: fnum)
    }
    if let focal = dict["FocalLength"] as? Double {
      exifProps[kCGImagePropertyExifFocalLength] = NSNumber(value: focal)
    }
    if let focal35 = dict["FocalLenIn35mmFilm"] as? Int {
      exifProps[kCGImagePropertyExifFocalLenIn35mmFilm] = NSNumber(value: focal35)
    }
    if let dateOrig = dict["DateTimeOriginal"] as? String {
      exifProps[kCGImagePropertyExifDateTimeOriginal] = dateOrig as NSString
    }
    if let aperture = dict["ApertureValue"] as? Double {
      exifProps[kCGImagePropertyExifApertureValue] = NSNumber(value: aperture)
    }
    if let shutter = dict["ShutterSpeedValue"] as? Double {
      exifProps[kCGImagePropertyExifShutterSpeedValue] = NSNumber(value: shutter)
    }

    // TIFF : Make affiche par Finder dans "Get Info". Model exact n'est
    // pas dans l'EXIF AVCapture (faudrait mapper hw.machine) -- on laisse
    // Apple seul.
    tiffProps[kCGImagePropertyTIFFMake] = "Apple" as NSString

    return [
      kCGImagePropertyExifDictionary: exifProps,
      kCGImagePropertyTIFFDictionary: tiffProps,
    ]
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

  @objc(burnMetadata:dstPath:label:exifJson:resolver:rejecter:)
  func burnMetadata(_ srcPath: String,
                    dstPath: String,
                    label: String,
                    exifJson: String,
                    resolver: @escaping RCTPromiseResolveBlock,
                    rejecter: @escaping RCTPromiseRejectBlock) {
    // Accepte file:// ou chemin nu sur src ET dst
    let cleanSrc = srcPath.replacingOccurrences(of: "file://", with: "")
    let cleanDst = dstPath.replacingOccurrences(of: "file://", with: "")
    guard FileManager.default.fileExists(atPath: cleanSrc) else {
      rejecter("E_NOT_FOUND", "File not found: \(cleanSrc)", nil)
      return
    }

    // Fast path raw : ni enhance ni burn. Strategie iPhone natif (2026-05) :
    //   - Si la source HEIC contient deja la EXIF box (cas attendu quand
    //     iOS est en .continuousAutoExposure -> AVCapture ecrit shutter/
    //     ISO/aperture reels), copie byte-pour-byte pour preserver les
    //     valeurs natives Apple intactes. Aucune injection.
    //   - Si source nue ET payload JS non-vide, injection via
    //     CGImageDestinationAddImageFromSource (tiles HEVC verbatim, EXIF
    //     box ecrite depuis le payload). Cas legacy / fallback.
    //   - `label` recu du JS est silencieusement ignore.
    if !Self.enhanceEnabled && !Self.burnEnabled {
      let srcURL = URL(fileURLWithPath: cleanSrc)
      let dstURL = URL(fileURLWithPath: cleanDst)

      // Probe source : dimensions + presence EXIF box. Decision d'injection
      // ci-dessous depend de srcHasExif.
      let source = CGImageSourceCreateWithURL(srcURL as CFURL, nil)
      var srcHasExif = false
      if let source,
         let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
        let pw = (props[kCGImagePropertyPixelWidth] as? Int) ?? -1
        let ph = (props[kCGImagePropertyPixelHeight] as? Int) ?? -1
        srcHasExif = (props[kCGImagePropertyExifDictionary] != nil)
        NSLog("[WILL-CAM] photo=%dx%d exif=%@ exifJson len=%d",
              pw, ph, srcHasExif ? "yes" : "no", exifJson.count)
      } else {
        NSLog("[WILL-CAM] photo=?x? exif=? exifJson len=%d (CGImageSource read failed)",
              exifJson.count)
      }

      do {
        let parent = dstURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
          at: parent, withIntermediateDirectories: true, attributes: nil
        )
        if FileManager.default.fileExists(atPath: cleanDst) {
          try FileManager.default.removeItem(at: dstURL)
        }

        // Injection UNIQUEMENT si source nue d'EXIF ET payload non-vide.
        // Sinon byte-copy pour preserver l'EXIF natif Apple intact.
        let trimmedExif = exifJson.trimmingCharacters(in: .whitespacesAndNewlines)
        let shouldInject = !srcHasExif
                       && !trimmedExif.isEmpty
                       && trimmedExif != "{}"
                       && trimmedExif != "null"
        var injected = false

        if shouldInject,
           let source,
           let dest = CGImageDestinationCreateWithURL(dstURL as CFURL, UTType.heic.identifier as CFString, 1, nil),
           let props = Self.buildExifProperties(fromJson: exifJson) {
          CGImageDestinationAddImageFromSource(dest, source, 0, props as CFDictionary)
          if CGImageDestinationFinalize(dest) {
            injected = true
          } else {
            NSLog("[WILL-CAM] CGImageDestinationFinalize failed -- fallback byte-copy")
            if FileManager.default.fileExists(atPath: cleanDst) {
              try? FileManager.default.removeItem(at: dstURL)
            }
          }
        }

        if !injected {
          // Byte-pour-byte : preserve l'EXIF natif Apple intact si present.
          let data = try Data(contentsOf: srcURL)
          try data.write(to: dstURL, options: .atomic)
        }

        // Sanity check dst : dims preservees + EXIF final.
        if let dstSource = CGImageSourceCreateWithURL(dstURL as CFURL, nil),
           let dstProps = CGImageSourceCopyPropertiesAtIndex(dstSource, 0, nil) as? [CFString: Any] {
          let dw = (dstProps[kCGImagePropertyPixelWidth] as? Int) ?? -1
          let dh = (dstProps[kCGImagePropertyPixelHeight] as? Int) ?? -1
          let dstHasExif = (dstProps[kCGImagePropertyExifDictionary] != nil) ? "yes" : "no"
          NSLog("[WILL-CAM] dst photo=%dx%d exif=%@ injected=%@",
                dw, dh, dstHasExif, injected ? "yes" : "no")
        }

        resolver(cleanDst)
      } catch {
        rejecter("E_WRITE", "Could not write HEIC: \(error.localizedDescription)", nil)
      }
      return
    }

    guard let original = UIImage(contentsOfFile: cleanSrc) else {
      rejecter("E_LOAD", "Could not load image at \(cleanSrc)", nil)
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
      // Cree le dossier parent du dst si besoin (le caller JS le fait
      // normalement mais on est defensif : moins couteux que de faire
      // echouer le burn et reprendre toute la pipeline).
      let dstURL = URL(fileURLWithPath: cleanDst)
      let parent = dstURL.deletingLastPathComponent()
      try FileManager.default.createDirectory(
        at: parent, withIntermediateDirectories: true, attributes: nil
      )
      try heicData.write(to: dstURL, options: .atomic)
      resolver(cleanDst)
    } catch {
      rejecter("E_WRITE", "Could not write image: \(error.localizedDescription)", nil)
    }
  }

  // Diagnostic Probleme 1 (ultra-wide GDC) : enumere TOUS les formats de la
  // lentille demandee avec la donnee Apple complete (description, supported
  // MaxPhotoDimensions, FOV, binned, HDR, highRes). Permet d'identifier un
  // format dont la photoDim pre-GDC > 4032x3024 (qui apres crop GDC tomberait
  // pile a 4032x3024, comme l'app Camera native). Appele depuis JS au switch
  // toggle. NSLog only -- pas de retour structure, on lit Console.app.
  @objc(enumerateFormatsForLens:resolver:rejecter:)
  func enumerateFormatsForLens(_ lensName: String,
                                resolver: @escaping RCTPromiseResolveBlock,
                                rejecter: @escaping RCTPromiseRejectBlock) {
    let deviceType: AVCaptureDevice.DeviceType
    switch lensName {
    case "ultra-wide-angle-camera": deviceType = .builtInUltraWideCamera
    case "wide-angle-camera":       deviceType = .builtInWideAngleCamera
    case "telephoto-camera":        deviceType = .builtInTelephotoCamera
    default:
      rejecter("E_UNKNOWN_LENS", "Unknown lens: \(lensName)", nil)
      return
    }
    let session = AVCaptureDevice.DiscoverySession(
      deviceTypes: [deviceType],
      mediaType: .video,
      position: .back
    )
    guard let device = session.devices.first else {
      rejecter("E_DEVICE_NOT_FOUND", "No back \(lensName) found", nil)
      return
    }

    NSLog("[lens-enum] device=%@ name='%@' formats=%d gdcSupported=%@ gdcEnabled=%@",
          lensName, device.localizedName, device.formats.count,
          device.isGeometricDistortionCorrectionSupported ? "Y" : "N",
          device.isGeometricDistortionCorrectionEnabled ? "Y" : "N")

    for (i, fmt) in device.formats.enumerated() {
      let dim = CMVideoFormatDescriptionGetDimensions(fmt.formatDescription)
      var photoDimsStr = "n/a"
      if #available(iOS 16.0, *) {
        photoDimsStr = fmt.supportedMaxPhotoDimensions
          .map { "\($0.width)x\($0.height)" }
          .joined(separator: ",")
      }
      let fov = fmt.videoFieldOfView
      let binned = fmt.isVideoBinned ? "Y" : "N"
      let hdr = fmt.isVideoHDRSupported ? "Y" : "N"
      let highRes = fmt.isHighestPhotoQualitySupported ? "Y" : "N"
      NSLog("[lens-enum] #%d video=%dx%d photoMax=[%@] fov=%.1f binned=%@ hdr=%@ highRes=%@",
            i, dim.width, dim.height, photoDimsStr, fov, binned, hdr, highRes)
      // Description complete Apple : contient les flags style "GDC Supported",
      // "FOV cropped", "supports wide color" -- ce qui nous interesse pour
      // identifier les formats sans crop GDC parasite.
      NSLog("[lens-enum] #%d desc=%@", i, "\(fmt)")
    }
    resolver(NSNumber(value: device.formats.count))
  }
}
