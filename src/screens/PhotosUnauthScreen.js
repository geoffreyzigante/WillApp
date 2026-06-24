// Ecran "Photos" quand le coureur n'est pas authentifie. Explique la valeur
// (un selfie suffit, valable 12 mois renouvelables) avant de proposer
// l'inscription. Les CTA pointent vers AuthRunnerModal en mode register ou
// login selon le bouton.

import React from 'react';
import { SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import { SelfieIllustration } from '../components/SelfieIllustration';
import { C } from '../constants/colors';

export function PhotosUnauthScreen({ onSignup, onLogin }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F3FF' }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <SelfieIllustration size={96} />
        </View>
        <Text style={{
          fontSize: 26, fontFamily: 'AVEstiana', color: C.text,
          textAlign: 'center', marginBottom: 10, lineHeight: 30,
        }}>
          Tes photos avant même{'\n'}la ligne d'arrivée
        </Text>
        <Text style={{
          fontSize: 14, color: C.textSoft, textAlign: 'center',
          lineHeight: 20, marginBottom: 24, paddingHorizontal: 8,
        }}>
          Ajoute tes events en favoris pour les suivre. Un selfie suffit pour être reconnu sur toutes les photos publiées (valable 12 mois renouvelables).
        </Text>
        <View style={{ alignSelf: 'stretch', gap: 10, marginBottom: 24 }}>
          {[
            { n: 1, t: 'Crée ton compte et prends ton selfie' },
            { n: 2, t: 'Ajoute tes events en favoris pour les suivre' },
            { n: 3, t: "Profite, Will s'occupe du reste" },
          ].map(({ n, t }) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FAF7FF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{n}</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }}>{t}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          onPress={onSignup}
          activeOpacity={0.88}
          style={{
            backgroundColor: C.primary,
            paddingVertical: 14,
            borderRadius: 14, alignSelf: 'stretch', alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Créer mon compte</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogin} style={{ marginTop: 12, paddingVertical: 6, alignItems: 'center' }} activeOpacity={0.7}>
          <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>J'ai déjà un compte</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
