// Ecran "Mon panier" cross-event (agrege via useAllCarts).
// Affiche par event la liste des photos selectionnees + total + bouton
// Commander (disabled : MVP avant Stripe).
//
// Embedded : rendu dans une sheet (parent gere handle/padding) -- on retire
// le topPad et l absolute bottom du footer pour utiliser le flex naturel.

import React, { useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Dimensions, Platform, StatusBar,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { C } from '../constants/colors';
import { s } from '../constants/styles';
import { API_URL, PRICE_PER_PHOTO_EUR } from '../constants/api';
import { formatDateLong } from '../utils/format';
import { useAllCarts } from '../hooks/useAllCarts';

const { width: SCREEN_W } = Dimensions.get('window');

export function PanierScreen({ allEvents = [], onOpenEvent, isActive = true, onClose, embedded = false }) {
  const { carts, total, remove, refresh } = useAllCarts();
  // Re-fetch backend a chaque fois qu on entre dans le panier.
  // Permet de rattraper les ajouts faits depuis un autre device (web).
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive && !wasActiveRef.current) refresh();
    wasActiveRef.current = isActive;
  }, [isActive, refresh]);
  const eventsMap = useMemo(() => {
    const m = new Map();
    for (const ev of allEvents) if (ev && ev.code) m.set(ev.code, ev);
    return m;
  }, [allEvents]);
  const topPad = embedded ? 0 : (Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0) + 12);
  const cellW = (SCREEN_W - 32 - 16) / 3;
  const orderedCodes = useMemo(() => Array.from(carts.keys()), [carts]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header style charte modal (AuthOrganizerModal) : titre AVEstiana
          rose centre + sous-titre textSoft. En embedded la fermeture passe
          par le handle drag + tap backdrop, pas de X. */}
      <View style={{ paddingTop: topPad, paddingHorizontal: 22, paddingBottom: 14, alignItems: 'center' }}>
        <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginTop: 4, marginBottom: 4, textAlign: 'center' }]}>
          Mon panier
        </Text>
        <Text style={{ color: C.textSoft, fontSize: 13, textAlign: 'center' }}>
          {total === 0 ? 'Vide pour le moment.' : `${total} photo${total > 1 ? 's' : ''} dans ton panier.`}
        </Text>
        {!embedded && onClose ? (
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Fermer" style={{ position: 'absolute', right: 16, top: topPad, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke={C.text} strokeWidth={2.6} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {total === 0 ? (
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 36, alignItems: 'center' }}>
            <View style={{
              width: 56, height: 56, borderRadius: 999,
              backgroundColor: '#F2EDFD',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Svg width={30} height={28} viewBox="0 0 18.96 17.61" fill="#7B2FFF">
                <Path d="M9.49,9.19c-.38,0-.68.3-.68.68v3.38c0,.37.31.68.68.68s.68-.3.68-.68v-3.38c0-.37-.31-.68-.68-.68Z" />
                <Path d="M12.94,9.23c-.37-.06-.73.18-.79.55l-.59,3.33c-.07.37.18.72.55.78.37.06.73-.18.79-.55l.59-3.33c.07-.37-.18-.72-.55-.78Z" />
                <Path d="M6.04,9.23c-.37.06-.62.42-.55.78l.59,3.33c.07.37.42.61.79.55.37-.06.62-.42.55-.78l-.59-3.33c-.07-.37-.42-.61-.79-.55Z" />
                <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
              </Svg>
            </View>
            <Text style={{ fontFamily: 'Montserrat', fontSize: 17, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 8 }}>
              Aucune photo dans ton panier
            </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, textAlign: 'center', lineHeight: 18 }}>
              Parcours les galeries de tes événements et ajoute les photos que tu souhaites télécharger.
            </Text>
          </View>
        ) : (
          orderedCodes.map((code) => {
            const keys = carts.get(code) || [];
            const meta = eventsMap.get(code) || { name: code, event_date: '' };
            const dateLabel = meta.event_date ? formatDateLong(meta.event_date, meta.event_date_end) : '';
            return (
              <View key={code} style={{ backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ fontFamily: 'Montserrat', fontSize: 16, fontWeight: '800', color: C.text, letterSpacing: -0.2 }} numberOfLines={2}>
                      {meta.name || code}
                    </Text>
                    <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>
                      {[dateLabel, `${keys.length} photo${keys.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {onOpenEvent ? (
                    <TouchableOpacity onPress={() => onOpenEvent(meta)} activeOpacity={0.7}>
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Voir →</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {keys.map((k) => {
                    const thumbUri = `${API_URL}/photo-thumb/${encodeURIComponent(k)}?v=wm19`;
                    return (
                      <View key={k} style={{ width: cellW, height: cellW, borderRadius: 12, overflow: 'hidden', backgroundColor: C.primaryLight, position: 'relative' }}>
                        <ExpoImage
                          source={{ uri: thumbUri }}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                          transition={100}
                        />
                        <TouchableOpacity
                          onPress={() => remove(code, k)}
                          hitSlop={8}
                          accessibilityLabel="Retirer du panier"
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 26, height: 26, borderRadius: 999,
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />
                          </Svg>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {total > 0 ? (
        <View style={{
          backgroundColor: '#fff',
          borderTopWidth: 1, borderTopColor: '#EFEAFB',
          paddingHorizontal: 20, paddingTop: 14, paddingBottom: embedded ? 18 : 14,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <View>
            <Text style={{ color: C.textSoft, fontSize: 12, fontFamily: 'Montserrat' }}>Total</Text>
            <Text style={{ fontFamily: 'Montserrat', fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 }}>
              {`${total * PRICE_PER_PHOTO_EUR} €`}
            </Text>
          </View>
          <TouchableOpacity
            disabled
            style={{ backgroundColor: '#C9BEEF', paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999 }}
          >
            <Text style={{ color: '#fff', fontFamily: 'Montserrat', fontSize: 14, fontWeight: '700' }}>Commander · bientôt</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
