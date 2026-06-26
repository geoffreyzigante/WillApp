//
//  PhotoQualityScorer.m
//  WillApp
//
//  Export RCT du module Swift PhotoQualityScorer.
//
//  Signature : scoreRaw(srcPath) -> promise<{ signaux bruts }>.
//  Voir PhotoQualityScorer.swift pour le détail du dictionnaire retourné
//  et la philosophie (signaux bruts cote natif, composite cote JS).
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PhotoQualityScorer, NSObject)

RCT_EXTERN_METHOD(scoreRaw:(NSString *)srcPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
