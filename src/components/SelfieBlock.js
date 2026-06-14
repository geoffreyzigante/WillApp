// SelfieBlock : etat selfie du runner sur PhotosScreen / HomeScreen.
// Trois variantes visuelles :
//   - selfieUri present  -> banniere "Selfie enregistre" + bouton delete +
//                            etats uploadState 'failed' / 'uploading' / 'idle'
//   - selfieUri absent + missing=true  -> CTA renforce orange ("Selfie manquant")
//   - default            -> CTA gradient violet "Un selfie suffit"

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Icon } from './Icon';
import { C } from '../constants/colors';
import { s } from '../constants/styles';

export function SelfieBlock({ selfieUri, onPress, onDelete, missing = false, uploadState = 'idle', onRetryUpload }) {
  if (selfieUri) {
    return (
      <View style={s.selfieDoneBanner}>
        <ExpoImage
          source={{ uri: selfieUri }}
          style={{ width: 44, height: 44, borderRadius: 999 }}
          contentFit="cover"
        />
        <View style={{ flex: 1 }}>
          {uploadState === 'failed' ? (
            <>
              <Text style={[s.selfieDoneTitle, { color: C.error }]}>Envoi du selfie échoué</Text>
              <TouchableOpacity onPress={onRetryUpload} hitSlop={6}>
                <Text style={[s.selfieDoneSub, { color: C.error, fontWeight: '700' }]}>
                  Réessayer l'envoi (ou supprimer pour reprendre)
                </Text>
              </TouchableOpacity>
            </>
          ) : uploadState === 'uploading' ? (
            <>
              <Text style={s.selfieDoneTitle}>Envoi en cours…</Text>
              <Text style={s.selfieDoneSub}>Confirmation serveur…</Text>
            </>
          ) : (
            <>
              <Text style={s.selfieDoneTitle}>Selfie enregistré</Text>
              <Text style={s.selfieDoneSub}>Will t'envoie tes photos automatiquement</Text>
            </>
          )}
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={10} style={s.selfieDelete}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M6 6l12 12M18 6l-12 12" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>
    );
  }
  // Etat renforce "selfie manquant" : encadre orange + CTA explicite. Active
  // quand le coureur a explicitement skippe l'etape 2 du signup wizard.
  if (missing) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        <LinearGradient
          colors={['#8B3FFF', '#5A1FCC']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.selfieCard, { borderWidth: 2, borderColor: C.warning, flexDirection: 'column', alignItems: 'stretch' }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[s.selfieAvatar, { width: 56, height: 56, borderRadius: 14 }]}>
              <Icon.User size={32} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFD89B', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
                Selfie manquant
              </Text>
              <Text style={[s.selfieSub, { marginTop: 0, fontSize: 13, lineHeight: 17 }]}>
                Prends ton selfie pour récupérer tes photos
              </Text>
            </View>
          </View>
          <View style={{ marginTop: 12, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: C.primary, fontWeight: '700', fontSize: 14 }}>Faire mon selfie maintenant</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <LinearGradient colors={['#8B3FFF', '#5A1FCC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.selfieCard}>
        <View style={{ flex: 1 }}>
          <Text style={s.selfieTitle}>Un selfie suffit</Text>
          <Text style={s.selfieSub}>Un selfie suffit pour recevoir tes photos automatiquement sur tous tes events Will.</Text>
        </View>
        <View style={[s.selfieAvatar, { backgroundColor: 'transparent' }]}>
          {/* Icone ScanCoeur (source ~/WILL/ScanCoeur.svg) : cadres FaceID
              + coeur central, langage visuel = scan biometrique pour favoris. */}
          <Svg width={48} height={47} viewBox="0 0 17.61 17.25" fill="#fff">
            <Path d="M15.73,0h-3.75v1.22h2.91c.81,0,1.47.66,1.47,1.47v2.76h1.24v1.72h-3.54s.01-.09.01-.13c0-1.59-1.29-2.88-2.88-2.88-1,0-1.88.51-2.4,1.28-.52-.77-1.4-1.28-2.4-1.28-1.59,0-2.88,1.29-2.88,2.88,0,.04,0,.09.01.13H0v1.45h4.01s13.6,0,13.6,0v3.19h-1.24v2.76c0,.81-.66,1.47-1.47,1.47h-2.91v1.22h3.75c1.04,0,1.87-.84,1.87-1.87V1.87C17.61.84,16.77,0,15.73,0Z" />
            <Path d="M1.24,2.68c0-.81.66-1.47,1.47-1.47h2.91V0H1.87C.84,0,0,.84,0,1.87v3.56h1.24v-2.76Z" />
            <Path d="M1.24,14.57v-2.76H0v3.56C0,16.41.84,17.25,1.87,17.25h3.74v-1.22h-2.91c-.81,0-1.47-.66-1.47-1.47Z" />
            <Path d="M4.47,9.36c.85,1.23,2.11,2.43,3.06,3.26.73.64,1.82.64,2.55,0,.94-.82,2.21-2.03,3.06-3.26H4.47Z" />
          </Svg>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}
