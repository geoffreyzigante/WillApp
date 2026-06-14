//
//  ThermalMonitor.m
//  WillApp
//
//  Wrapper RCT autour de NSProcessInfo.thermalState (iOS 11+). Expose l'etat
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
//  prefere garder la cadence capture meme si l'upload ralentit.
//
//  Implementation ObjC pure (pas de bridging header React requis).
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface ThermalMonitor : RCTEventEmitter <RCTBridgeModule>
@end

@implementation ThermalMonitor

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents {
  return @[@"ThermalStateChanged"];
}

- (instancetype)init {
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(thermalStateChanged:)
             name:NSProcessInfoThermalStateDidChangeNotification
           object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

// Mapping NSProcessInfoThermalState -> chaine lisible. On expose en string
// (pas en int) pour eviter qu'un upgrade iOS ajoutant une valeur casse
// silencieusement la logique JS.
+ (NSString *)stateStringFromState:(NSProcessInfoThermalState)st {
  switch (st) {
    case NSProcessInfoThermalStateNominal:  return @"nominal";
    case NSProcessInfoThermalStateFair:     return @"fair";
    case NSProcessInfoThermalStateSerious:  return @"serious";
    case NSProcessInfoThermalStateCritical: return @"critical";
    default: return @"unknown";
  }
}

RCT_EXPORT_METHOD(getThermalState:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSProcessInfoThermalState st = [[NSProcessInfo processInfo] thermalState];
  resolve(@{
    @"state": [ThermalMonitor stateStringFromState:st],
    @"ts": @([[NSDate date] timeIntervalSince1970]),
  });
}

- (void)thermalStateChanged:(NSNotification *)notif {
  NSProcessInfoThermalState st = [[NSProcessInfo processInfo] thermalState];
  NSString *s = [ThermalMonitor stateStringFromState:st];
  NSLog(@"[ThermalMonitor] state changed -> %@", s);
  [self sendEventWithName:@"ThermalStateChanged" body:@{@"state": s}];
}

@end
