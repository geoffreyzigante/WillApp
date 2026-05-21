//
//  PhotoMetadataBurner.m
//  WillApp
//
//  Export RCT du module Swift PhotoMetadataBurner.
//
//  Signature out-of-place : srcPath + dstPath separes, le worker JS gere
//  le cleanup du source apres confirmation du write dst.
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PhotoMetadataBurner, NSObject)

RCT_EXTERN_METHOD(burnMetadata:(NSString *)srcPath
                  dstPath:(NSString *)dstPath
                  label:(NSString *)label
                  exifJson:(NSString *)exifJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(enumerateFormatsForLens:(NSString *)lensName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
