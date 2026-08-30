//
//  BackgroundUploader.m
//  WillApp
//
//  Background URLSession upload manager : delegue les PUT R2 a iOS via
//  NSURLSessionConfiguration backgroundSession. L'app peut etre minimisee,
//  l'ecran eteint, ou meme suspended par iOS -- l'upload continue.
//  Streaming depuis un fichier (uploadTaskWithRequest:fromFile:) : pas de
//  blob en RAM cote app.
//
//  Implementation ObjC pure (pas de bridging header React requis dans ce
//  projet). Logique conservee de la version Swift initiale.
//
//  Limitations :
//  - Si l'app est explicitement killed (swipe up app switcher), les tasks
//    en cours sont cancelled par iOS. C est un comportement systeme, aucune
//    API ne le contourne — la consigne benevole reste "verrouille, ne ferme
//    pas".
//  - Au cold start, on retrouve les tasks survivantes via getAllTasks et
//    on les reattache au delegate.
//  - V2 (2026-08-30) : handleEventsForBackgroundURLSession est desormais
//    installe a l execution (cf. +load) — un kill SYSTEME en plein transfert
//    n interrompt plus rien, et l app est relancee en arriere-plan pour
//    encaisser les evenements.
//
//  Pattern d'usage cote JS :
//    NativeModules.BackgroundUploader.enqueueUpload(url, filePath, headers,
//                                                    itemId) -> Promise
//    NativeEventEmitter listener sur :
//      - BackgroundUploaderComplete { itemId, success, statusCode, error }
//      - BackgroundUploaderProgress  { itemId, bytesSent, totalBytes }
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

static NSString * const kSessionId    = @"com.geoffreyzigante.will.upload.bg";
static NSString * const kMapFilename  = @"background_uploader_map.json";
static const NSTimeInterval kProgressThrottleS = 0.2;

@interface BackgroundUploader : RCTEventEmitter <RCTBridgeModule, NSURLSessionDataDelegate, NSURLSessionTaskDelegate>

// taskIdentifier (NSNumber) -> itemId (NSString)
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSString *> *taskMap;
@property (nonatomic, strong) dispatch_queue_t mapQueue;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSNumber *> *lastProgressAt;
@property (nonatomic, strong) NSURLSession *session;

@end

// [will-bg-v2] Levee de la "limitation V1" : handleEventsForBackgroundURLSession.
//
// Quand iOS tue l app pendant un transfert (pression memoire), la session
// d arriere-plan SURVIT et va au bout — mais iOS relance ensuite l app pour
// lui remettre les evenements, via cette methode d AppDelegate qui n existait
// pas. On l ajoute au delegate A L EXECUTION (class_addMethod au premier
// lancement) : tout reste dans ce fichier, aucun patch d AppDelegate. Si
// ExpoAppDelegate implemente deja le selecteur, on ne touche a rien.
//
// Le completion handler recu est range ici et rendu a iOS dans
// URLSessionDidFinishEventsForBackgroundURLSession — le contrat exact d Apple.
static void (^gWillBgCompletionHandler)(void) = nil;

static void WillHandleBgSessionEvents(id self, SEL _cmd, UIApplication *app,
                                      NSString *identifier, void (^completionHandler)(void)) {
  if ([identifier isEqualToString:kSessionId]) {
    gWillBgCompletionHandler = [completionHandler copy];
    NSLog(@"[BackgroundUploader] relaunch pour evenements de session background");
  } else {
    completionHandler();
  }
}

// [will-bg-v2] Fenetre protegee : ~30 s garanties par iOS apres la mise en
// veille, pour finir de preparer (convertir) les photos et les remettre a la
// session background AVANT que le JS ne s endorme. Sans elle, tout ce qui
// n etait pas converti au verrouillage attendait une reouverture.
// UIBackgroundTaskInvalid n est PAS une constante de compilation (extern
// const) : interdit comme initialiseur statique. Le BOOL fait foi, la
// valeur du task n est lue que quand il est actif.
static UIBackgroundTaskIdentifier gWillProtectedTask;
static BOOL gWillProtectedActive = NO;

// Classe dediee pour le +load : RCT_EXPORT_MODULE() definit deja +load sur
// BackgroundUploader (enregistrement du module aupres du bridge) — un second
// +load dans la meme classe est un doublon refuse a la compilation.
@interface WillBgSessionInstaller : NSObject
@end

@implementation WillBgSessionInstaller
+ (void)load {
  [[NSNotificationCenter defaultCenter]
    addObserverForName:UIApplicationDidFinishLaunchingNotification
                object:nil
                 queue:[NSOperationQueue mainQueue]
            usingBlock:^(NSNotification * _Nonnull note) {
    id delegate = [UIApplication sharedApplication].delegate;
    if (!delegate) return;
    Class cls = [delegate class];
    SEL sel = @selector(application:handleEventsForBackgroundURLSession:completionHandler:);
    if (!class_respondsToSelector(cls, sel)) {
      class_addMethod(cls, sel, (IMP)WillHandleBgSessionEvents, "v@:@@@?");
      NSLog(@"[BackgroundUploader] handleEventsForBackgroundURLSession installe sur %@", cls);
    }
  }];
}
@end

@implementation BackgroundUploader

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents {
  return @[@"BackgroundUploaderComplete", @"BackgroundUploaderProgress"];
}

- (instancetype)init {
  if (self = [super init]) {
    _taskMap = [NSMutableDictionary dictionary];
    _lastProgressAt = [NSMutableDictionary dictionary];
    _mapQueue = dispatch_queue_create("com.willapp.bguploader.map", DISPATCH_QUEUE_SERIAL);
    [self loadTaskMap];
    // Force creation de la session + reattach delegate aux tasks en cours
    // (iOS conserve les tasks dans la session background entre lancements).
    NSURLSession *s = self.session;
    [self rehydrateActiveTasksOnSession:s];
  }
  return self;
}

// Configuration session background : priorite user-initiated, HTTP/3 via
// URLRequest individuel (iOS 14.5+), 6 connexions max par host.
- (NSURLSession *)session {
  if (_session) return _session;
  NSURLSessionConfiguration *config = [NSURLSessionConfiguration
    backgroundSessionConfigurationWithIdentifier:kSessionId];
  config.discretionary = NO;
  config.sessionSendsLaunchEvents = YES;
  config.allowsCellularAccess = YES;
  config.HTTPMaximumConnectionsPerHost = 6;
  config.waitsForConnectivity = YES;
  _session = [NSURLSession sessionWithConfiguration:config
                                            delegate:self
                                       delegateQueue:nil];
  return _session;
}

- (void)URLSessionDidFinishEventsForBackgroundURLSession:(NSURLSession *)session {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gWillBgCompletionHandler) {
      void (^h)(void) = gWillBgCompletionHandler;
      gWillBgCompletionHandler = nil;
      h();
      NSLog(@"[BackgroundUploader] evenements background livres, handler rendu a iOS");
    }
  });
}

#pragma mark - Persistance taskMap

+ (NSURL *)mapFileURL {
  NSURL *docs = [[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory
                                                         inDomains:NSUserDomainMask] firstObject];
  return [docs URLByAppendingPathComponent:kMapFilename];
}

- (void)loadTaskMap {
  NSURL *url = [[self class] mapFileURL];
  NSData *data = [NSData dataWithContentsOfURL:url];
  if (!data) return;
  NSError *err = nil;
  NSDictionary *raw = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
  if (![raw isKindOfClass:[NSDictionary class]]) return;
  dispatch_sync(self.mapQueue, ^{
    for (NSString *k in raw) {
      id v = raw[k];
      if ([v isKindOfClass:[NSString class]]) {
        NSInteger id_ = [k integerValue];
        self.taskMap[@(id_)] = (NSString *)v;
      }
    }
  });
}

- (void)saveTaskMap {
  dispatch_async(self.mapQueue, ^{
    NSMutableDictionary *raw = [NSMutableDictionary dictionary];
    for (NSNumber *k in self.taskMap) {
      raw[[k stringValue]] = self.taskMap[k];
    }
    NSError *err = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:raw options:0 error:&err];
    if (data) {
      [data writeToURL:[[self class] mapFileURL] atomically:YES];
    }
  });
}

- (void)rehydrateActiveTasksOnSession:(NSURLSession *)session {
  [session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> * _Nonnull tasks) {
    NSMutableSet<NSNumber *> *activeIds = [NSMutableSet set];
    for (NSURLSessionTask *t in tasks) {
      [activeIds addObject:@(t.taskIdentifier)];
    }
    dispatch_async(self.mapQueue, ^{
      NSUInteger before = self.taskMap.count;
      NSMutableArray<NSNumber *> *toRemove = [NSMutableArray array];
      for (NSNumber *k in self.taskMap) {
        if (![activeIds containsObject:k]) [toRemove addObject:k];
      }
      [self.taskMap removeObjectsForKeys:toRemove];
      if (self.taskMap.count != before) {
        [self saveTaskMap];
        NSLog(@"[BackgroundUploader] rehydrate: purged %lu stale entries, %lu active",
              (unsigned long)(before - self.taskMap.count),
              (unsigned long)self.taskMap.count);
      }
    });
  }];
}

#pragma mark - JS API

// enqueueUpload(url, filePath, headers, itemId) : cree une upload task
// PUT streaming depuis filePath. Resolve immediat (task creee). Le resultat
// final est emis via event BackgroundUploaderComplete.
RCT_EXPORT_METHOD(enqueueUpload:(NSString *)urlString
                  filePath:(NSString *)filePath
                  headers:(NSDictionary *)headers
                  itemId:(NSString *)itemId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:urlString];
  if (!url) {
    reject(@"E_BAD_URL", [NSString stringWithFormat:@"Invalid URL: %@", urlString], nil);
    return;
  }
  // Normalise file:// prefix : uploadTask attend un URL local.
  NSURL *fileUrl = nil;
  if ([filePath hasPrefix:@"file://"]) {
    fileUrl = [NSURL URLWithString:filePath];
  } else {
    fileUrl = [NSURL fileURLWithPath:filePath];
  }
  if (!fileUrl || ![[NSFileManager defaultManager] fileExistsAtPath:fileUrl.path]) {
    reject(@"E_FILE_MISSING", [NSString stringWithFormat:@"File not found: %@", fileUrl.path], nil);
    return;
  }
  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
  req.HTTPMethod = @"PUT";
  for (NSString *k in headers) {
    id v = headers[k];
    if ([v isKindOfClass:[NSString class]]) {
      [req setValue:(NSString *)v forHTTPHeaderField:k];
    }
  }
  // HTTP/3 (QUIC) auto-negocie avec Cloudflare R2 qui le supporte.
  // -30 pourcent latency handshake en 4G mauvaise. iOS 14.5+ requis.
  if (@available(iOS 14.5, *)) {
    req.assumesHTTP3Capable = YES;
  }
  NSURLSessionUploadTask *task = [self.session uploadTaskWithRequest:req fromFile:fileUrl];
  // Insertion AVANT resume : sinon didSendBodyData peut arriver avant que
  // le mapping soit en place.
  dispatch_sync(self.mapQueue, ^{
    self.taskMap[@(task.taskIdentifier)] = itemId;
  });
  [self saveTaskMap];
  [task resume];
  NSLog(@"[BackgroundUploader] enqueued task=%lu itemId=%@",
        (unsigned long)task.taskIdentifier, itemId);
  resolve(@{@"taskId": @(task.taskIdentifier)});
}

// Liste les itemId encore actifs cote iOS. Le caller JS peut reconcilier sa
// queue persistante au boot.
RCT_EXPORT_METHOD(getActiveUploads:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> * _Nonnull tasks) {
    dispatch_async(self.mapQueue, ^{
      NSMutableArray<NSString *> *active = [NSMutableArray array];
      for (NSURLSessionTask *t in tasks) {
        if (t.state == NSURLSessionTaskStateRunning || t.state == NSURLSessionTaskStateSuspended) {
          NSString *itemId = self.taskMap[@(t.taskIdentifier)];
          if (itemId) [active addObject:itemId];
        }
      }
      resolve(@{@"activeItemIds": active});
    });
  }];
}

// [will-bg-v2] beginProtectedWindow / endProtectedWindow : cf. commentaire
// de gWillProtectedTask. Idempotent, jamais bloquant.
RCT_EXPORT_METHOD(beginProtectedWindow:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gWillProtectedActive) { resolve(@{@"granted": @YES}); return; }
    gWillProtectedTask = [[UIApplication sharedApplication]
      beginBackgroundTaskWithName:@"will-preparation"
                expirationHandler:^{
      NSLog(@"[BackgroundUploader] fenetre protegee expiree par iOS");
      if (gWillProtectedActive) {
        [[UIApplication sharedApplication] endBackgroundTask:gWillProtectedTask];
        gWillProtectedActive = NO;
      }
    }];
    gWillProtectedActive = (gWillProtectedTask != UIBackgroundTaskInvalid);
    resolve(@{@"granted": @(gWillProtectedActive)});
  });
}

RCT_EXPORT_METHOD(endProtectedWindow:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gWillProtectedActive) {
      [[UIApplication sharedApplication] endBackgroundTask:gWillProtectedTask];
      gWillProtectedActive = NO;
    }
    resolve(nil);
  });
}

RCT_EXPORT_METHOD(cancelUpload:(NSString *)itemId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> * _Nonnull tasks) {
    dispatch_async(self.mapQueue, ^{
      for (NSURLSessionTask *t in tasks) {
        if ([self.taskMap[@(t.taskIdentifier)] isEqualToString:itemId]) {
          [t cancel];
          [self.taskMap removeObjectForKey:@(t.taskIdentifier)];
        }
      }
      [self saveTaskMap];
      resolve(nil);
    });
  }];
}

#pragma mark - NSURLSessionTaskDelegate

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error
{
  NSUInteger taskId = task.taskIdentifier;
  __block NSString *itemId = nil;
  dispatch_sync(self.mapQueue, ^{
    itemId = self.taskMap[@(taskId)];
    [self.taskMap removeObjectForKey:@(taskId)];
    [self.lastProgressAt removeObjectForKey:@(taskId)];
  });
  [self saveTaskMap];
  if (!itemId) {
    NSLog(@"[BackgroundUploader] complete task=%lu UNKNOWN itemId (stale ?)", (unsigned long)taskId);
    return;
  }
  NSInteger status = 0;
  if ([task.response isKindOfClass:[NSHTTPURLResponse class]]) {
    status = [(NSHTTPURLResponse *)task.response statusCode];
  }
  BOOL success = (error == nil) && (status >= 200 && status < 300);
  NSMutableDictionary *body = [@{
    @"itemId": itemId,
    @"success": @(success),
    @"statusCode": @(status),
  } mutableCopy];
  if (error) body[@"error"] = error.localizedDescription ?: @"unknown";
  NSLog(@"[BackgroundUploader] complete task=%lu item=%@ status=%ld err=%@",
        (unsigned long)taskId, itemId, (long)status, error.localizedDescription ?: @"nil");
  [self sendEventWithName:@"BackgroundUploaderComplete" body:body];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
   didSendBodyData:(int64_t)bytesSent
    totalBytesSent:(int64_t)totalBytesSent
totalBytesExpectedToSend:(int64_t)totalBytesExpectedToSend
{
  NSUInteger taskId = task.taskIdentifier;
  __block NSString *itemId = nil;
  __block BOOL emit = NO;
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  dispatch_sync(self.mapQueue, ^{
    itemId = self.taskMap[@(taskId)];
    if (!itemId) return;
    NSNumber *last = self.lastProgressAt[@(taskId)];
    if (!last || (now - last.doubleValue) >= kProgressThrottleS) {
      self.lastProgressAt[@(taskId)] = @(now);
      emit = YES;
    }
  });
  if (!itemId || !emit) return;
  [self sendEventWithName:@"BackgroundUploaderProgress" body:@{
    @"itemId": itemId,
    @"bytesSent": @(totalBytesSent),
    @"totalBytes": @(totalBytesExpectedToSend),
  }];
}

@end
