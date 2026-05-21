//
//  HumanDetectorPlugin.m
//  WillApp
//
//  Enregistre HumanDetectorPlugin (Swift) comme frame processor "detectHumans".
//

#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

#if __has_include("WillApp-Swift.h")
#import "WillApp-Swift.h"
#else
#import <WillApp/WillApp-Swift.h>
#endif

@interface HumanDetectorPlugin (Registration)
@end

@implementation HumanDetectorPlugin (Registration)

+ (void)load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"detectHumans"
                                        withInitializer:^FrameProcessorPlugin* _Nonnull (VisionCameraProxyHolder* _Nonnull proxy,
                                                                                          NSDictionary* _Nullable options) {
    return [[HumanDetectorPlugin alloc] initWithProxy:proxy withOptions:options];
  }];
}

@end
