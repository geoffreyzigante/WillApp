// Repère de cadrage superposé à la preview (§1.8).
//
// Un seul point : celui où le coureur est censé passer. Le bénévole le place
// au milieu du chemin, et le cadrage est réglé. Il n'a aucune distance à
// comprendre ni aucune consigne à lire.
//
// Fonctionne sur parcours vide, sans sujet de référence — c'est la contrainte
// qui a écarté la méthode par taille de visage pour le réglage.
//
// Géométrie de la preview reprise de l'overlay « zone de capture » existant
// dans App.js (CAMERA_TOP / previewH / PREVIEW_MARGIN_H) : les deux doivent
// rester alignés au pixel près, sinon le point ment.

import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { groundPointInImage } from '../services/framingGuide';

const DOT = 18;
const COLOR = '#3DDC84';

/**
 * @param {number} targetDistance  distance cible en m (TARGET_DISTANCE_M)
 * @param {number} height          hauteur de pose en m (MOUNT_HEIGHT_M)
 * @param {number} pitch,roll      radians, depuis useDeviceTilt()
 * @param {number} halfFovH,halfFovV  radians, depuis fovFromFormat()
 * @param {object} rect            {top,height,marginH} de la preview
 */
export default function FramingGuide({
  targetDistance,
  height,
  pitch,
  roll = 0,
  halfFovH,
  halfFovV,
  rect,
  showLabel = true,
  visible = true,
}) {
  const point = useMemo(
    () => groundPointInImage(targetDistance, { height, pitch, roll, halfFovH, halfFovV }),
    [targetDistance, height, pitch, roll, halfFovH, halfFovV],
  );

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: rect.top,
        height: rect.height,
        left: rect.marginH,
        right: rect.marginH,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {point ? (
        <View
          style={{
            position: 'absolute',
            left: `${point.x * 100}%`,
            top: `${point.y * 100}%`,
            marginLeft: -DOT / 2,
            marginTop: -DOT / 2,
          }}
        >
          {/* Halo : garde le point lisible sur gravier clair comme sur bitume. */}
          <View
            style={{
              width: DOT, height: DOT, borderRadius: DOT / 2,
              borderWidth: 2, borderColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: DOT - 8, height: DOT - 8, borderRadius: (DOT - 8) / 2,
                backgroundColor: COLOR,
              }}
            />
          </View>
          {showLabel && (
            <Text
              style={{
                position: 'absolute', left: DOT + 6, top: 1,
                color: COLOR, fontSize: 12, fontWeight: '700',
                textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3,
              }}
            >
              {targetDistance.toFixed(1).replace('.', ',')} m
            </Text>
          )}
        </View>
      ) : (
        // Hors cadre : sans ce message le bénévole ne voit rien et ne sait pas
        // qu'il doit bouger l'appareil.
        <View
          style={{
            position: 'absolute', left: 12, right: 12, bottom: 12,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: '#FFB020', fontSize: 14, fontWeight: '700' }}>
            Incline le téléphone vers le sol
          </Text>
        </View>
      )}

    </View>
  );
}
