// Ecran "Photos" quand le coureur n'est pas authentifie. Explique la valeur
// avant de proposer l'inscription. Les CTA pointent vers AuthRunnerModal en
// mode register ou login selon le bouton.
//
// Refonte 2026-09-01 (maquettes user) : illustration pleine largeur
// (Illu_Photos.svg inline), 3 etapes en ACCORDEON (titre + chevron, texte
// deplie au tap, une seule ouverte a la fois), CTA au gabarit du menu
// (Inscription plein + Connexion en aplat leger).

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
// Voir App.js : SafeAreaView de react-native est inerte sur Android.
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants/colors';
import { lh } from '../constants/typo';
import { CtaWill } from '../components/CtaWill';
import { GrainViolet } from '../components/GrainViolet';

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

// Pile de cartes numerotees (user 2026-11-23, proposition 5) : une couleur de la
// charte par etape, qui se chevauchent legerement.
const COULEURS = [
  { bg: '#E8DEFF', fg: '#7B2FFF' },
  { bg: '#F4A6FF', fg: '#3B0A96' },
  { bg: '#7B2FFF', fg: '#FFFFFF' },
];

export function PhotosUnauthScreen({ onSignup, onLogin }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.fondApp }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-start', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Une Text par ligne : sur Android, une Text a deux lignes dont le
            lineHeight est sous la hauteur de la police coupe la derniere
            (cf. HotOnesCarousel, lh()). */}
        <View style={{ marginBottom: 20, alignItems: 'flex-start' }}>
          {['Tes photos', 'avant même', "la ligne d'arrivée"].map((ligne, i) => (
            <Text key={ligne} style={{
              fontSize: 26, fontFamily: 'AVEstiana', fontStyle: 'normal', color: C.primary,
              textAlign: 'left', lineHeight: lh(26, 30), marginTop: i === 0 ? 0 : (Platform.OS === 'android' ? -4 : 0),
            }}>
              {ligne}
            </Text>
          ))}
        </View>

        <View style={{ alignSelf: 'stretch', marginBottom: 28 }}>
          {ETAPES.map(({ label, titre, texte }, i) => {
            const { bg, fg } = COULEURS[i];
            return (
              <GrainViolet key={label} color={bg} grain={0.45} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18, marginTop: i === 0 ? 0 : 12 }}>
                <Text style={{ color: fg, fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 36, lineHeight: lh(36, 40), minWidth: 26 }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: fg, opacity: 0.85, fontFamily: 'Montserrat-SemiBold', fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
                  <Text style={{ color: fg, fontFamily: 'Montserrat-SemiBold', fontSize: 15, marginTop: 2 }}>{titre}</Text>
                  <Text style={{ color: fg, opacity: 0.85, fontFamily: 'Montserrat-Medium', fontSize: 12.5, lineHeight: 17, marginTop: 2 }}>{texte}</Text>
                </View>
              </GrainViolet>
            );
          })}
        </View>

        {/* CTA de la charte + Connexion en simple lien (comme la carte d'accueil). */}
        <View style={{ alignItems: 'center', gap: 14 }}>
          <CtaWill label="S’inscrire" onPress={onSignup} variante="violet" style={{ alignSelf: 'center' }} />
          <TouchableOpacity onPress={onLogin} hitSlop={10}>
            <Text style={{ color: C.primary, fontFamily: 'Montserrat-Medium', fontSize: 15 }}>Connexion</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
