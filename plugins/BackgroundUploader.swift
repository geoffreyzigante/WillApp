//
//  BackgroundUploader.swift
//  WillApp
//
//  Background URLSession upload manager : delegue les PUT R2 a iOS via
//  URLSessionConfiguration.background. L'app peut etre minimisee, l'ecran
//  eteint, ou meme suspended par iOS -- l'upload continue. Streaming depuis
//  un fichier (uploadTask(with:fromFile:)) : pas de blob en RAM cote app.
//
//  Limitations connues (V1) :
//  - Si l'app est explicitement killed (swipe up dans app switcher), les
//    tasks en cours seront cancelled. Pas de relaunch iOS pour completion
//    handler (skip de handleEventsForBackgroundURLSession AppDelegate pour
//    cette V1, ajout futur si necessaire).
//  - Au cold start, on retrouve les tasks survivantes via getAllTasks et
//    on les reattache au delegate (pas de perte d'info).
//
//  Pattern d'usage cote JS :
//    NativeModules.BackgroundUploader.enqueueUpload(url, filePath, headers,
//                                                    itemId) -> Promise<void>
//    NativeEventEmitter listener sur :
//      - BackgroundUploaderComplete { itemId, success, statusCode, error }
//      - BackgroundUploaderProgress  { itemId, bytesSent, totalBytes }
//
//  Persistance taskMap : sauve [taskId -> itemId] en JSON sur disque
//  (Documents/background_uploader_map.json) pour survivre cold start
//  / crash. iOS conserve les tasks elles-memes dans la session background.
//

import Foundation
import React

@objc(BackgroundUploader)
class BackgroundUploader: RCTEventEmitter, URLSessionDataDelegate, URLSessionTaskDelegate {

  // Identifiant de la session background. iOS persiste cette session
  // entre lancements de l'app : meme apres cold start on retrouve les
  // tasks en cours via getAllTasks.
  static let SESSION_ID = "com.geoffreyzigante.will.upload.bg"

  // Singleton : RN cree une instance via le bridge, mais on garde une ref
  // partagee pour que l'AppDelegate (futur) puisse appeler handleEvents.
  @objc static var sharedInstance: BackgroundUploader?

  // Lazy : la session est creee a la 1ere ref. Configurer apres init evite
  // les soucis d'ordre d'initialisation singleton + delegate.
  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: BackgroundUploader.SESSION_ID)
    // Priorite user-initiated : iOS ne defere pas l'upload meme en battery saver
    config.isDiscretionary = false
    // Si l'app est killed, iOS doit pouvoir la relancer pour les completion
    // handlers. (Effet limite sans le forwarding AppDelegate, mais on l'active
    // au cas ou un futur build le branche.)
    config.sessionSendsLaunchEvents = true
    config.allowsCellularAccess = true
    // 6 connexions par host : double le CONCURRENCY JS actuel (3). iOS
    // multiplexe HTTP/2 et HTTP/3 sur 1 connexion sur Cloudflare R2, donc
    // 6 = marge confortable sans peser sur l'OS.
    config.httpMaximumConnectionsPerHost = 6
    // Si pas de reseau au moment du enqueue, iOS attend qu'il revienne au
    // lieu de fail. Combine au backoff JS = recovery quasi automatique.
    config.waitsForConnectivity = true
    // HTTP/3 (QUIC) : iOS 15+ auto-negocie avec Cloudflare R2 qui le
    // supporte. -30 pourcent latency handshake en 4G mauvaise.
    if #available(iOS 15.0, *) {
      config.assumesHTTP3Capable = true
    }
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  // Mapping taskIdentifier (Int donne par URLSession) -> itemId (String
  // generated cote JS). Necessaire car la task iOS ne porte pas notre id
  // metier. Persiste sur disque pour resister au cold start.
  private var taskMap: [Int: String] = [:]
  private let mapQueue = DispatchQueue(label: "com.willapp.bguploader.map")

  // Throttle des events progress : on cap a ~5 hz pour ne pas saturer
  // le bridge JS (1 photo = 5 Mo = ~1000 events sinon).
  private var lastProgressEmitAt: [Int: TimeInterval] = [:]
  private let PROGRESS_THROTTLE_S: TimeInterval = 0.2

  override init() {
    super.init()
    BackgroundUploader.sharedInstance = self
    // Restore mapping du disque (survit cold start)
    loadTaskMap()
    // Reattache notre delegate aux tasks en cours (iOS les conserve dans
    // la session background entre lancements). Force la creation de la
    // session lazy.
    let _ = session
    rehydrateActiveTasks()
  }

  override class func requiresMainQueueSetup() -> Bool { return false }

  override func supportedEvents() -> [String]! {
    return ["BackgroundUploaderComplete", "BackgroundUploaderProgress"]
  }

  // MARK: - Persistance taskMap

  private static func mapFileURL() -> URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return docs.appendingPathComponent("background_uploader_map.json")
  }

  private func loadTaskMap() {
    let url = BackgroundUploader.mapFileURL()
    guard let data = try? Data(contentsOf: url),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
      return
    }
    mapQueue.sync {
      // JSON cle = String (Int converti). Reconvert en Int.
      for (k, v) in raw {
        if let id = Int(k) { self.taskMap[id] = v }
      }
    }
  }

  private func saveTaskMap() {
    mapQueue.async {
      var raw: [String: String] = [:]
      for (k, v) in self.taskMap { raw[String(k)] = v }
      let url = BackgroundUploader.mapFileURL()
      if let data = try? JSONSerialization.data(withJSONObject: raw) {
        try? data.write(to: url, options: .atomic)
      }
    }
  }

  private func rehydrateActiveTasks() {
    session.getAllTasks { tasks in
      // Purge du map les tasks qui ne sont plus dans la session iOS
      // (completed pendant qu'on etait dead, cancelled, etc.).
      let activeIds = Set(tasks.map { $0.taskIdentifier })
      self.mapQueue.async {
        let beforeCount = self.taskMap.count
        self.taskMap = self.taskMap.filter { activeIds.contains($0.key) }
        if self.taskMap.count != beforeCount {
          self.saveTaskMap()
          NSLog("[BackgroundUploader] rehydrate: purged \(beforeCount - self.taskMap.count) stale entries, \(self.taskMap.count) active")
        }
      }
    }
  }

  // MARK: - JS API

  // enqueueUpload(url, filePath, headers, itemId) : cree une URLSessionUploadTask
  // PUT streaming depuis filePath. Resolve immediat (task creee). Le resultat
  // final est emis via event BackgroundUploaderComplete.
  @objc(enqueueUpload:filePath:headers:itemId:resolver:rejecter:)
  func enqueueUpload(
    _ urlString: String,
    filePath: String,
    headers: [String: String],
    itemId: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: urlString) else {
      rejecter("E_BAD_URL", "Invalid URL: \(urlString)", nil)
      return
    }
    // Normalise file:// prefix : URLSession.uploadTask(fromFile:) attend
    // un URL local. Si le caller donne "file://..." on parse comme URL,
    // sinon on construit un fileURL.
    let fileUrl: URL
    if filePath.hasPrefix("file://") {
      guard let u = URL(string: filePath) else {
        rejecter("E_BAD_FILE", "Invalid file URL: \(filePath)", nil)
        return
      }
      fileUrl = u
    } else {
      fileUrl = URL(fileURLWithPath: filePath)
    }
    // Sanity check : le fichier existe ?
    if !FileManager.default.fileExists(atPath: fileUrl.path) {
      rejecter("E_FILE_MISSING", "File not found: \(fileUrl.path)", nil)
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    let task = session.uploadTask(with: req, fromFile: fileUrl)
    // Insertion AVANT resume() : sinon didSendBodyData peut arriver avant que
    // le mapping soit en place (delegate sur queue distincte cote URLSession).
    mapQueue.sync {
      self.taskMap[task.taskIdentifier] = itemId
    }
    saveTaskMap()
    task.resume()
    NSLog("[BackgroundUploader] enqueued task=\(task.taskIdentifier) itemId=\(itemId)")
    resolver(["taskId": task.taskIdentifier])
  }

  // Liste les itemId encore actifs (PUT en cours cote iOS). Le caller JS
  // peut reconcilier sa queue persistante au boot : tout itemId present
  // ici est deja en upload, pas besoin de re-enqueuer.
  @objc(getActiveUploads:rejecter:)
  func getActiveUploads(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    session.getAllTasks { tasks in
      self.mapQueue.async {
        let active: [String] = tasks.compactMap { t in
          // Seules les tasks running / suspended sont actives. completed /
          // canceling ne devraient pas etre la mais on filtre par safety.
          guard t.state == .running || t.state == .suspended else { return nil }
          return self.taskMap[t.taskIdentifier]
        }
        resolver(["activeItemIds": active])
      }
    }
  }

  // Cancel un upload par itemId. Cherche la task correspondante et cancel().
  @objc(cancelUpload:resolver:rejecter:)
  func cancelUpload(
    _ itemId: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    session.getAllTasks { tasks in
      self.mapQueue.async {
        for t in tasks {
          if self.taskMap[t.taskIdentifier] == itemId {
            t.cancel()
            self.taskMap.removeValue(forKey: t.taskIdentifier)
          }
        }
        self.saveTaskMap()
        resolver(nil)
      }
    }
  }

  // MARK: - URLSessionTaskDelegate

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    let taskId = task.taskIdentifier
    var itemId: String? = nil
    mapQueue.sync {
      itemId = self.taskMap[taskId]
      self.taskMap.removeValue(forKey: taskId)
      self.lastProgressEmitAt.removeValue(forKey: taskId)
    }
    saveTaskMap()
    guard let id = itemId else {
      NSLog("[BackgroundUploader] complete task=\(taskId) UNKNOWN itemId (stale ?)")
      return
    }
    let status: Int = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    let success = (error == nil) && (200..<300).contains(status)
    var body: [String: Any] = [
      "itemId": id,
      "success": success,
      "statusCode": status,
    ]
    if let e = error { body["error"] = e.localizedDescription }
    NSLog("[BackgroundUploader] complete task=\(taskId) item=\(id) status=\(status) err=\(error?.localizedDescription ?? "nil")")
    // sendEvent est safe meme si le listener JS n'est pas encore attache --
    // RCTEventEmitter buffer jusqu'a 64 events si bridgeIsReady = false.
    self.sendEvent(withName: "BackgroundUploaderComplete", body: body)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didSendBodyData bytesSent: Int64,
    totalBytesSent: Int64,
    totalBytesExpectedToSend: Int64
  ) {
    let taskId = task.taskIdentifier
    var itemId: String? = nil
    mapQueue.sync { itemId = self.taskMap[taskId] }
    guard let id = itemId else { return }
    // Throttle ~5 Hz
    let now = Date().timeIntervalSince1970
    var emit = false
    mapQueue.sync {
      let last = self.lastProgressEmitAt[taskId] ?? 0
      if now - last >= PROGRESS_THROTTLE_S {
        self.lastProgressEmitAt[taskId] = now
        emit = true
      }
    }
    if emit {
      self.sendEvent(withName: "BackgroundUploaderProgress", body: [
        "itemId": id,
        "bytesSent": totalBytesSent,
        "totalBytes": totalBytesExpectedToSend,
      ])
    }
  }
}

// Bridge des types RN -- redeclaration locale (cf PhotoMetadataBurner.swift)
// pour eviter le bridging header.
private typealias RCTPromiseResolveBlock = (Any?) -> Void
private typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
