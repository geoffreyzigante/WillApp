// Etat vide PhotosScreen quand le runner est authentifie mais ne suit
// aucun event encore. CTA "Trouver un event" + pedagogie 3 etapes.
//
// Step 1 est marquee done si selfieUri present.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { PhotosStepRow } from './PhotosStepRow';

export function PhotosEmptyState({ selfieUri, onFindEvent }) {
  return (
    <View style={{ paddingVertical: 24, paddingHorizontal: 16 }}>
      {/* Badge violet avec coeur */}
      <View style={{
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: '#7B2FFF',
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'center', marginBottom: 18,
        shadowColor: '#7B2FFF', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
      }}>
        <Svg width={34} height={30} viewBox="-1 -1.5 22.78 20.61" fill="#fff">
          <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
        </Svg>
      </View>

      <Text style={{
        fontSize: 22, fontWeight: '800', color: '#1A1426',
        textAlign: 'center', letterSpacing: -0.3, marginBottom: 10,
      }}>
        Suis un event pour{'\n'}recevoir tes photos
      </Text>
      <Text style={{
        fontSize: 14, color: 'rgba(123,47,255,0.3)', lineHeight: 20,
        textAlign: 'center', marginBottom: 22,
        paddingHorizontal: 12,
      }}>
        Will reconnaît ton visage sur les photos de tous les events Will. Ajoute un event en favoris pour recevoir tes notifs dès qu'elles arrivent.
      </Text>

      {onFindEvent && (
        <TouchableOpacity
          onPress={onFindEvent}
          activeOpacity={0.85}
          style={{
            backgroundColor: '#7B2FFF', borderRadius: 999,
            paddingVertical: 13, paddingHorizontal: 22,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 8,
            alignSelf: 'center', marginBottom: 26,
            shadowColor: '#7B2FFF', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
          }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="11" cy="11" r="8" />
            <Path d="M21 21l-4-4" />
          </Svg>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Trouver un event</Text>
        </TouchableOpacity>
      )}

      {/* 3 etapes pedagogiques */}
      <View style={{ paddingHorizontal: 8 }}>
        <PhotosStepRow num={1} text={selfieUri ? "Ton selfie est déjà enregistré ✓" : "Ajoute ton selfie"} done={!!selfieUri} />
        <PhotosStepRow num={2} text="Tu suis l'event de ta course" />
        <PhotosStepRow num={3} text="Tes photos arrivent automatiquement" />
      </View>
    </View>
  );
}
