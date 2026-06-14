//
//  ThermalMonitor.swift
//  WillApp
//
//  Wrapper RCT autour de ProcessInfo.thermalState (iOS 11+). Expose l'etat
//  thermique courant et notifie le JS sur les transitions via event
//  ThermalStateChanged.
//
//  iOS expose 4 niveaux :
//    nominal  -> normal
//    fair     -> chauffe legere, performance pas encore impactee
//    serious  -> CPU/GPU throttling actif, batterie chauffe
//    critical -> iOS peut shutdown la camera, l'app, voire l'iPhone
//
//  Cote app : on baisse CONCURRENCY upload (3 -> 2 a serious, 1 a critical)
//  pour soulager le NPU/CPU/baseband. Capture continue normalement -- on
//  prefere garder la cadence capture meme si l'upload ralentit, sinon on
//  rate des coureurs en peloton dense.
//
//  Le NotificationCenter observer est attache au init et detache au deinit.
//

import Foundation
import React

@objc(ThermalMonitor)
class ThermalMonitor: RCTEventEmitter {

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(thermalStateChanged),
      name: ProcessInfo.thermalStateDidChangeNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override class func requiresMainQueueSetup() -> Bool { return false }

  override func supportedEvents() -> [String]! {
    return ["ThermalStateChanged"]
  }

  // Mapping ProcessInfo.ThermalState -> chaine lisible. On expose en string
  // (pas en int) pour eviter qu'un upgrade iOS ajoutant une valeur casse
  // silencieusement la logique JS.
  private static func stateString(_ st: ProcessInfo.ThermalState) -> String {
    switch st {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  // Synchronous-style read pour init JS. Retourne aussi le timestamp pour
  // que le caller sache si l'info est fraiche.
  @objc(getThermalState:rejecter:)
  func getThermalState(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    let st = ProcessInfo.processInfo.thermalState
    resolver([
      "state": ThermalMonitor.stateString(st),
      "ts": Date().timeIntervalSince1970,
    ])
  }

  @objc func thermalStateChanged() {
    let st = ProcessInfo.processInfo.thermalState
    let s = ThermalMonitor.stateString(st)
    NSLog("[ThermalMonitor] state changed -> \(s)")
    sendEvent(withName: "ThermalStateChanged", body: ["state": s])
  }
}

// Bridge types -- cf PhotoMetadataBurner.swift / BackgroundUploader.swift
private typealias RCTPromiseResolveBlock = (Any?) -> Void
private typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
