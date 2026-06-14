// Grille de thumbnails photos + cellules associees.
//
// PhotoCell : variante avec shared-element transition (measureInWindow)
//   + states errored + favori toggleable inline. Utilisee dans le viewer
//   et l'overlay full-screen.
//
// PhotoGrid : conteneur layout colonnes adaptatives (1-4 selon photos.length
//   ou prop numColumns), placeholder grid si photos vide.
//
// PhotoGridItem : cellule simple (lecture seule favori, mode selection
//   alternatif avec pastille check). Utilisee dans les galeries de events
//   et profile.

import React, { useState, useRef } from 'react';
import { View, TouchableOpacity, Dimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { C } from '../constants/colors';
import { s } from '../constants/styles';
import { FavStar } from './FavStar';

const { width: SCREEN_W } = Dimensions.get('window');

export const PhotoCell = React.memo(function PhotoCell({ photo, size, onPress, showHeart, isFav, onToggleFav, favIndicator = false }) {
  const [errored, setErrored] = useState(false);
  const cellRef = useRef(null);
  // size optionnel :
  //   - number  -> carre {width: n, height: n}
  //   - object  -> {width, height} explicites (masonry hauteurs variables)
  //   - absent  -> flex: 1 + aspectRatio: 1 (grid carre dans FlatList)
  const sizeStyle = (() => {
    if (size && typeof size === 'object') return { width: size.width, height: size.height };
    if (typeof size === 'number') return { width: size, height: size };
    return { flex: 1, aspectRatio: 1 };
  })();
  // Wrapping ref + measureInWindow pour shared-element : le caller recoit
  // { x, y, w, h } de la thumb tapee et anime la photo viewer depuis cette
  // position vers le plein ecran.
  const handlePress = () => {
    if (!onPress) return;
    if (cellRef.current?.measureInWindow) {
      cellRef.current.measureInWindow((x, y, w, h) => onPress({ x, y, w, h }));
    } else {
      onPress(null);
    }
  };
  return (
    <TouchableOpacity
      ref={cellRef}
      style={sizeStyle}
      activeOpacity={0.85}
      onPress={handlePress}
    >
      {/* Bg gris affiche pendant le chargement et en cas d'erreur (fallback) */}
      <View style={{ flex: 1, borderRadius: 12, backgroundColor: C.primaryLight, overflow: 'hidden' }}>
        {!errored && (
          <ExpoImage
            source={{ uri: photo.uri }}
            style={{ flex: 1 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="low"
            transition={150}
            recyclingKey={photo.id}
            onError={(e) => {
              console.warn('[gallery] image load failed:', photo.uri, e?.error || e);
              setErrored(true);
            }}
          />
        )}
        {errored && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M3 16l5-5 4 4 3-3 6 6M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth={1.5} />
            </Svg>
          </View>
        )}
      </View>
      {showHeart && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onToggleFav?.(); }}
          hitSlop={12}
          style={{ position: 'absolute', top: 6, right: 6 }}
        >
          <FavStar size={18} fill={isFav ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.6} />
        </TouchableOpacity>
      )}
      {favIndicator && !showHeart && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 6, right: 6,
            // Drop shadow noir pour rendre l etoile visible sur photos
            // claires comme sombres (remplace le contour noir).
            shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
            elevation: 3,
          }}
        >
          <FavStar size={18} fill="#fff" stroke="#fff" strokeWidth={1.4} />
        </View>
      )}
    </TouchableOpacity>
  );
});

export function PhotoGrid({ photos = [], onPress, photoFavoritesSet, onToggleFavorite, selectionMode = false, selectedIds, onTogglePhotoSelect, numColumns }) {
  // Colonnes adaptatives : si numColumns fourni, on utilise. Sinon
  // fallback : 1 photo = 1 col (full width), 2 = 2 col, 3 = 3 col, 4+ = 4 col.
  const cols = numColumns != null
    ? Math.max(1, Math.min(numColumns, 4))
    : Math.max(1, Math.min(photos.length || 4, 4));
  const itemSize = (SCREEN_W - 40 - (cols - 1) * 8) / cols;
  const itemStyle = { width: itemSize, height: itemSize, marginBottom: 8 };

  // Si pas de photos : grille de placeholders (cols = 4 par defaut visuel).
  if (photos.length === 0) {
    const phCols = 4;
    const phSize = (SCREEN_W - 40 - (phCols - 1) * 8) / phCols;
    const phStyle = { width: phSize, height: phSize, marginBottom: 8 };
    return (
      <View style={s.grid}>
        {Array.from({ length: 16 }, (_, i) => (
          <View key={`ph-${i}`} style={phStyle}>
            <View style={s.gridPlaceholder} />
          </View>
        ))}
      </View>
    );
  }

  const showHearts = !!onToggleFavorite && !!photoFavoritesSet;

  return (
    <View style={s.grid}>
      {photos.map((p, i) => (
        <PhotoGridItem
          key={p.id || `p-${i}`}
          p={p}
          i={i}
          photos={photos}
          onPress={onPress}
          showHearts={showHearts}
          fav={showHearts && photoFavoritesSet.has(p.id)}
          onToggleFavorite={onToggleFavorite}
          selectionMode={selectionMode}
          selected={!!(selectedIds && selectedIds.has(p.id))}
          onToggleSelect={onTogglePhotoSelect}
          itemStyle={itemStyle}
        />
      ))}
    </View>
  );
}

// Cellule simple, chacune avec sa propre ref pour shared-element transition
// (caller recoit position absolute pour anime depuis cette thumb).
export function PhotoGridItem({ p, i, photos, onPress, showHearts, fav, onToggleFavorite, selectionMode = false, selected = false, onToggleSelect, itemStyle }) {
  const itemRef = useRef(null);
  const handlePress = () => {
    if (selectionMode) {
      onToggleSelect?.(p.id);
      return;
    }
    if (!onPress) return;
    if (itemRef.current?.measureInWindow) {
      itemRef.current.measureInWindow((x, y, w, h) => onPress(p, i, photos, { x, y, w, h }));
    } else {
      onPress(p, i, photos, null);
    }
  };
  return (
    <TouchableOpacity
      ref={itemRef}
      style={itemStyle || s.gridItem}
      activeOpacity={0.85}
      onPress={handlePress}
    >
      <ExpoImage
        source={{ uri: p.uri }}
        style={s.gridImg}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="low"
        transition={100}
        recyclingKey={p.id}
      />
      {/* Etoile favori : indicateur READ-ONLY uniquement pour les photos deja
          mises en favori. Le favoriting se fait uniquement depuis le viewer
          (meme logique que la galerie publique, decision UX 2026-06-03). */}
      {showHearts && fav && !selectionMode && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 6, right: 6 }}>
          <FavStar size={14} fill="#fff" stroke="rgba(0,0,0,0.25)" strokeWidth={1.4} />
        </View>
      )}
      {/* Mode selection : pastille check en haut-GAUCHE (etoile favori garde
          sa place a droite) + voile violet leger si selected. */}
      {selectionMode && (
        <>
          {selected && (
            <View pointerEvents="none" style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              borderRadius: 12,
              backgroundColor: 'rgba(123,47,255,0.18)',
              borderWidth: 2, borderColor: C.primary,
            }} />
          )}
          <View pointerEvents="none" style={{
            position: 'absolute', top: 6, left: 6,
            width: 22, height: 22, borderRadius: 11,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: selected ? C.primary : 'rgba(255,255,255,0.7)',
            borderWidth: selected ? 0 : 1.5, borderColor: '#fff',
          }}>
            {selected && (
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M20 6L9 17l-5-5" />
              </Svg>
            )}
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}
