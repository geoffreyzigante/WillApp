// Header partage entre HomeScreen et PhotosScreen.
// Monte une seule fois dans App.js au-dessus du tab container -> pas de
// re-mount/flash au switch de tab. Mirror exact du bloc qui vivait dans
// HomeScreen avant l'extraction.
//
// Structure : [Logo gauche] <-> [Hello + prenom + burger droite + dot]

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from './Icon';
import { C } from '../constants/colors';
import { s } from '../constants/styles';

export function AppHeader({ runnerFirstName = '', selfieUri = null, selfieUploadState = 'idle', onOpenProfile, onLogoPress, onBack = null }) {
  const selfieOk = !!runnerFirstName && !!selfieUri && selfieUploadState !== 'failed' && selfieUploadState !== 'uploading';
  // Le logo Will ramene a l'accueil (mirror le tap "Accueil" bottom nav).
  // Si onLogoPress non fourni, fallback sur onOpenProfile pour ne rien casser.
  const handleLogoPress = onLogoPress || onOpenProfile;
  return (
    <View style={{ position: 'relative' }}>
      {/* BlurView : contenu qui passe dessous est floute (iOS classique). */}
      {Platform.OS === 'ios' ? (
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFillObject} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(245,243,255,0.85)' }]} />
      )}
      {/* Overlay degrade : violet leger #F5F3FF 100% en haut (couvre le notch
          / safe area en plein) -> fade vers 40% en bas pour laisser le BlurView
          ressortir au-dessus du contenu qui scroll. */}
      <LinearGradient
        colors={['rgba(245,243,255,1)', 'rgba(245,243,255,0.4)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        pointerEvents="none"
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[s.headerRow, { paddingHorizontal: 20, paddingBottom: 8 }]}>
      {/* Sur une page event, le logo cede la place au retour (user
          2026-10-26) : on y arrive depuis une liste, la sortie prime sur le
          rappel de marque. Meme geometrie que son frere de droite, le
          burger — 36 x 36, rayon 12, fond transparent — pour que les deux
          extremites du header pesent pareil. */}
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          style={{
            width: 36, height: 36, borderRadius: 12,
            alignItems: 'center', justifyContent: 'center',
            marginLeft: -8,
          }}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M15 5l-7 7 7 7" stroke={C.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={handleLogoPress} activeOpacity={0.7} hitSlop={8}>
          <Icon.Logo width={72} color={C.primary} />
        </TouchableOpacity>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
        {runnerFirstName ? (
          <TouchableOpacity onPress={onOpenProfile} activeOpacity={0.7} hitSlop={6} style={{ alignItems: 'flex-end', flexShrink: 1 }}>
            <Text style={[s.welcome, { color: '#c9beed', fontSize: 15, lineHeight: 17 }]} numberOfLines={1}>Hello</Text>
            <Text style={[s.welcome, { color: '#c9beed', fontSize: 17, lineHeight: 19 }]} numberOfLines={1}>{runnerFirstName}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onOpenProfile}
          activeOpacity={0.7}
          hitSlop={8}
          style={{
            width: 36, height: 36, borderRadius: 12,
            backgroundColor: 'transparent',
            alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}
          accessibilityLabel="Menu"
        >
          <Svg width={18} height={14} viewBox="0 0 18 14" fill="none">
            <Path d="M1 1h16M1 7h16M1 13h16" stroke={C.primary} strokeWidth={2} strokeLinecap="round" />
          </Svg>
          {selfieOk ? (
            <View style={{
              position: 'absolute',
              top: 3, right: 3,
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: '#10B981',
              borderWidth: 2, borderColor: '#fff',
            }} />
          ) : null}
        </TouchableOpacity>
      </View>
      </View>
    </View>
  );
}
