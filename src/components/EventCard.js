// Card event 110px de hauteur. Layout layer-cake :
//   Layer 0 : aplat tint (colorForType) pleine carte = fallback + base
//   Layer 1 : cover image sur la moitie droite seulement (left:50%)
//   Layer 2 : gradient pleine largeur, tint -> tint 10% (fade horizontale)
//   Texte (date / nom / lieu) en pointerEvents:none
//   Pastille type_event en bas droite
//   Bouton Suivre (etoile pleine si suivi, contour sinon)
//
// Convention seam x=0.5 alignee sur le hero de EventDetailScreen et le
// dashboard orga. Toute modif ici doit etre repercutee.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { formatDateLong, cityLabel, displayEventType } from '../utils/format';

export function EventCard({ event, onPress, isFollowing, onToggleFollow, style }) {
  const tint = colorForType(event.event_type);

  return (
    <View style={[s.eventCard, style]}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
      {event.cover_image ? (
        <ExpoImage
          source={{ uri: event.cover_image }}
          style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', right: 0 }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      ) : null}
      {event.cover_image ? (
        <LinearGradient
          colors={[tint, tint + '1A']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0.5, 1]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
      ) : null}
      <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={StyleSheet.absoluteFillObject} />
      <View style={s.eventCardCenter} pointerEvents="none">
        <Text style={s.eventDate}>{formatDateLong(event.event_date, event.event_date_end)}</Text>
        <Text style={[s.eventName, { lineHeight: 22 }]} numberOfLines={2} ellipsizeMode="tail">{event.name}</Text>
        <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
      </View>
      {event.event_type ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            backgroundColor: '#fff',
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            zIndex: 3,
          }}
        >
          <Text style={{ color: tint, fontSize: 10, fontWeight: '700' }}>
            {displayEventType(event.event_type)}
          </Text>
        </View>
      ) : null}
      {onToggleFollow && (
        <TouchableOpacity
          onPress={onToggleFollow}
          hitSlop={10}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <Svg width={22} height={20} viewBox="-1 -1.5 22.78 20.61" fill={isFollowing ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}>
            <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
          </Svg>
        </TouchableOpacity>
      )}
    </View>
  );
}
