//
//  ThermalMonitor.m
//  WillApp
//
//  Bridge RCT du module Swift ThermalMonitor.
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ThermalMonitor, RCTEventEmitter)

RCT_EXTERN_METHOD(getThermalState:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
