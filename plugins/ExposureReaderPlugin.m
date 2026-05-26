//
//  ExposureReaderPlugin.m
//  WillApp
//
//  Enregistre ExposureReaderPlugin (Swift) comme frame processor "readExposure".
//

#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

#if __has_include("WillApp-Swift.h")
#import "WillApp-Swift.h"
#else
#import <WillApp/WillApp-Swift.h>
#endif

@interface ExposureReaderPlugin (Registration)
@end

@implementation ExposureReaderPlugin (Registration)

+ (void)load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"readExposure"
                                        withInitializer:^FrameProcessorPlugin* _Nonnull (VisionCameraProxyHolder* _Nonnull proxy,
                                                                                          NSDictionary* _Nullable options) {
    return [[ExposureReaderPlugin alloc] initWithProxy:proxy withOptions:options];
  }];
}

@end
