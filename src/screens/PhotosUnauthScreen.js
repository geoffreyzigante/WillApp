// Ecran "Photos" quand le coureur n'est pas authentifie. Explique la valeur
// avant de proposer l'inscription. Les CTA pointent vers AuthRunnerModal en
// mode register ou login selon le bouton.
//
// Refonte 2026-09-01 (maquettes user) : illustration pleine largeur
// (Illu_Photos.svg inline), 3 etapes en ACCORDEON (titre + chevron, texte
// deplie au tap, une seule ouverte a la fois), CTA au gabarit du menu
// (Inscription plein + Connexion en aplat leger).

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
// Voir App.js : SafeAreaView de react-native est inerte sur Android.
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { C } from '../constants/colors';

// Illu_Photos.svg (fourni par le user) : rangee de polaroids inclines,
// rose au centre. Inline : net partout, livrable en OTA.
function IlluPhotos() {
  return (
    <View style={{ width: '100%', aspectRatio: 589.5 / 158.44 }}>
      <Svg width="100%" height="100%" viewBox="0 0 589.5 158.44">
        <Path fill="#f4a6ff" d="M341.27,17.8l-107.86,12.46c-5.61.65-9.64,5.72-8.99,11.33l12.46,107.86c.65,5.61,5.72,9.63,11.34,8.99l107.86-12.46c5.61-.65,9.63-5.72,8.99-11.33l-12.46-107.86c-.65-5.61-5.72-9.63-11.33-8.99ZM347.74,103.58c.65,5.61-3.38,10.69-8.99,11.34l-7.37.85c-5.03-16.23-20.06-27.16-36.36-25.27-16.3,1.88-28.45,15.95-29.64,32.9l-7.37.85c-5.61.65-10.69-3.38-11.33-8.99l-7.11-61.52c-.65-5.61,3.37-10.69,8.99-11.33l80.74-9.33c5.61-.65,10.69,3.37,11.34,8.99l7.11,61.52Z" />
        <Path fill="#f4a6ff" d="M289.46,42.36c-10.51,1.21-17.97,11.38-16.66,22.72,1.31,11.33,10.89,19.53,21.4,18.32,10.51-1.21,17.97-11.38,16.66-22.72-1.31-11.33-10.89-19.53-21.4-18.32Z" />
        <Path fill="#7234f5" d="M200.59,55.61l-75.22-20.17c-3.91-1.05-7.94,1.27-8.99,5.19l-20.17,75.22c-1.05,3.91,1.27,7.94,5.19,8.99l75.22,20.17c3.91,1.05,7.94-1.27,8.99-5.19l20.17-75.22c1.05-3.91-1.27-7.94-5.19-8.99ZM182.25,114.52c-1.05,3.91-5.07,6.24-8.99,5.19l-5.14-1.38c.94-12.15-6.2-23.41-17.57-26.46-11.37-3.05-23.19,3.12-28.46,14.11l-5.14-1.38c-3.91-1.05-6.23-5.07-5.19-8.99l11.51-42.9c1.05-3.91,5.07-6.24,8.99-5.19l56.31,15.1c3.91,1.05,6.24,5.07,5.19,8.99l-11.51,42.9Z" />
        <Path fill="#7234f5" d="M159.55,58.3c-7.33-1.97-14.99,2.85-17.11,10.75s2.1,15.9,9.43,17.87,14.99-2.85,17.11-10.75-2.1-15.9-9.43-17.87Z" />
        <Path fill="#7234f5" d="M599.97,55.61l-75.22-20.17c-3.91-1.05-7.94,1.27-8.99,5.19l-20.17,75.22c-1.05,3.91,1.27,7.94,5.19,8.99l75.22,20.17c3.91,1.05,7.94-1.27,8.99-5.19l20.17-75.22c1.05-3.91-1.27-7.94-5.19-8.99ZM581.63,114.52c-1.05,3.91-5.07,6.24-8.99,5.19l-5.14-1.38c.94-12.15-6.2-23.41-17.57-26.46-11.37-3.05-23.19,3.12-28.46,14.11l-5.14-1.38c-3.91-1.05-6.23-5.07-5.19-8.99l11.51-42.9c1.05-3.91,5.07-6.24,8.99-5.19l56.31,15.1c3.91,1.05,6.24,5.07,5.19,8.99l-11.51,42.9Z" />
        <Path fill="#7234f5" d="M558.93,58.3c-7.33-1.97-14.99,2.85-17.11,10.75s2.1,15.9,9.43,17.87,14.99-2.85,17.11-10.75-2.1-15.9-9.43-17.87Z" />
        <Path fill="#7234f5" d="M70.45,0L-6.8,9.87c-4.02.51-6.86,4.19-6.35,8.21L-3.28,95.33c.51,4.02,4.19,6.86,8.21,6.35l77.25-9.87c4.02-.51,6.86-4.19,6.35-8.21L78.65,6.35c-.51-4.02-4.19-6.86-8.21-6.35ZM75.83,61.47c.51,4.02-2.33,7.69-6.35,8.21l-5.28.67c-3.74-11.6-14.62-19.3-26.3-17.81-11.68,1.49-20.27,11.69-20.97,23.85l-5.28.67c-4.02.51-7.69-2.33-8.21-6.35L-2.19,26.66c-.51-4.02,2.33-7.69,6.35-8.21l57.83-7.39c4.02-.51,7.69,2.33,8.21,6.35l5.63,44.06Z" />
        <Path fill="#7234f5" d="M33.5,18.07c-7.53.96-12.79,8.32-11.75,16.44s7.98,13.91,15.51,12.95,12.79-8.32,11.75-16.44-7.98-13.92-15.51-12.95Z" />
        <Path fill="#7234f5" d="M467.13,0l-77.25,9.87c-4.02.51-6.86,4.19-6.35,8.21l9.87,77.25c.51,4.02,4.19,6.86,8.21,6.35l77.25-9.87c4.02-.51,6.86-4.19,6.35-8.21l-9.87-77.25c-.51-4.02-4.19-6.86-8.21-6.35ZM472.51,61.47c.51,4.02-2.33,7.69-6.35,8.21l-5.28.67c-3.74-11.6-14.62-19.3-26.3-17.81-11.68,1.49-20.27,11.69-20.97,23.85l-5.28.67c-4.02.51-7.69-2.33-8.21-6.35l-5.63-44.06c-.51-4.02,2.33-7.69,6.35-8.21l57.83-7.39c4.02-.51,7.69,2.33,8.21,6.35l5.63,44.06Z" />
        <Path fill="#7234f5" d="M430.18,18.07c-7.53.96-12.79,8.32-11.75,16.44s7.98,13.91,15.51,12.95,12.79-8.32,11.75-16.44-7.98-13.92-15.51-12.95Z" />
      </Svg>
    </View>
  );
}

const ETAPES = [
  {
    label: 'Avant',
    titre: 'Tu fais un selfie',
    texte: "Une fois, à l'inscription. Valable partout.",
  },
  {
    label: 'Pendant',
    titre: 'Tu participes',
    texte: "Will capture, tu ne penses à rien.",
  },
  {
    label: 'Après',
    titre: 'Tu reçois tout',
    texte: "Photos triées, notification envoyée.",
  },
];

export function PhotosUnauthScreen({ onSignup, onLogin }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F3FF' }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-start', alignItems: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ marginBottom: 20, marginHorizontal: -24, alignSelf: 'stretch' }}>
          <IlluPhotos />
        </View>
        <Text style={{
          fontSize: 26, fontFamily: 'AVEstiana', fontStyle: 'normal', color: C.primary,
          textAlign: 'center', marginBottom: 22, lineHeight: 30,
        }}>
          Tes photos avant même{'\n'}la ligne d'arrivée
        </Text>

        {/* Les 3 etapes : a plat, separees par de courts filets centres. */}
        <View style={{ alignSelf: 'stretch', marginBottom: 24 }}>
          {ETAPES.map(({ label, titre, texte }, i) => (
            <View key={label} style={{ paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' }}>
              {i > 0 ? (
                <View style={{ position: 'absolute', top: 0, left: '50%', marginLeft: -22, width: 44, height: 1, backgroundColor: 'rgba(26,10,62,0.12)' }} />
              ) : null}
              {/* Le moment (AVANT / PENDANT / APRES) coiffe l etape, il n est
                  plus accole au titre : chaque bloc se lit de haut en bas. */}
              <Text style={{ color: C.primary, fontFamily: 'Montserrat-SemiBold', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center', marginBottom: 5 }}>
                {label}
              </Text>
              <Text style={{ color: C.text, fontFamily: 'Montserrat-SemiBold', fontSize: 14, textAlign: 'center' }}>{titre}</Text>
              <Text style={{ color: C.textSoft, fontFamily: 'Montserrat-Medium', fontSize: 12.5, lineHeight: 18, marginTop: 5, textAlign: 'center' }}>
                {texte}
              </Text>
            </View>
          ))}
        </View>

        {/* CTA au gabarit du menu (ctaPrimary / ctaSecondary). */}
        <TouchableOpacity
          onPress={onSignup}
          activeOpacity={0.88}
          style={{ paddingVertical: 14, paddingHorizontal: 48, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', alignSelf: 'center' }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Inscription</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onLogin}
          activeOpacity={0.85}
          style={{ marginTop: 10, paddingVertical: 13, paddingHorizontal: 40, borderRadius: 14, backgroundColor: 'rgba(123,47,255,0.08)', alignItems: 'center', alignSelf: 'center' }}
        >
          <Text style={{ color: C.primary, fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Connexion</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
