//
//  BackgroundUploader.m
//  WillApp
//
//  Bridge RCT du module Swift BackgroundUploader.
//
//  Methodes :
//    - enqueueUpload(url, filePath, headers, itemId) -> Promise
//    - getActiveUploads() -> Promise<[itemId]>
//    - cancelUpload(itemId) -> Promise
//
//  Events emis :
//    - BackgroundUploaderComplete  { itemId, success, statusCode, error }
//    - BackgroundUploaderProgress  { itemId, bytesSent, totalBytes }
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(BackgroundUploader, RCTEventEmitter)

RCT_EXTERN_METHOD(enqueueUpload:(NSString *)url
                  filePath:(NSString *)filePath
                  headers:(NSDictionary *)headers
                  itemId:(NSString *)itemId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getActiveUploads:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelUpload:(NSString *)itemId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
