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
//  Limitations V1 :
//  - Si l'app est explicitement killed (swipe up app switcher), les tasks
//    en cours sont cancelled par iOS. Pas de relaunch via AppDelegate
//    handleEventsForBackgroundURLSession pour cette V1.
//  - Au cold start, on retrouve les tasks survivantes via getAllTasks et
//    on les reattache au delegate.
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
