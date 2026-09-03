// Molette verticale a defilement infini — panneaux de la vue photographe.
//
// Meme mecanique que OverlayWheel (liste repetee, snap-back silencieux vers
// le bloc central, haptique a chaque cran) mais habillee selon le handoff
// design : items de 40 px, fenetre de 140 px, bande de selection posee au
// centre, estompes blanches en haut et en bas.
//
// Deux differences de comportement, toutes deux voulues par le handoff :
//
//   1. La valeur AFFICHEE suit le doigt, cran par cran : il n y a pas de
//      bouton « Valider », ce que le benevole voit dans la bande est ce qu il
//      obtiendra. Elle n est en revanche REMONTEE au parent qu au repos.
//      Ecart assume avec le handoff, qui demande une remontee en direct :
//      chaque remontee rejoue tout PhotographerScreen et rediffe l element
//      VisionCamera. A 60 Hz pendant une inertie, avec la camera et le
//      detecteur de visages actifs, c est du temps pris a la capture — donc
//      des photos en moins. Le rendu est identique a l oeil ; seul le moment
//      ou la photo change d etiquette differe, de quelques centaines de ms.
//
//   2. Fond blanc opaque, aucun flou. Le panneau se pose sur le flux camera
//      et doit rester lisible sur un ciel blanc comme sur un sous-bois.
//
// OverlayWheel n a pas ete parametre : il est cale sur le fond noir de
// l ancienne vue et reste utilise ailleurs. Deux composants courts valent
// mieux qu un composant a huit props de style.

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { P } from '../constants/photographerTheme';
import { Haptics } from '../services/haptics';

export const WHEEL_ITEM_H = 40;
export const WHEEL_WINDOW_H = 140;
// (140 - 40) / 2 = 50 : un demi-item visible au-dessus et au-dessous du cran
// selectionne, exactement la fenetre decrite dans le handoff.
const PAD_V = Math.round((WHEEL_WINDOW_H - WHEEL_ITEM_H) / 2);
const REPEAT = 9;
const SAFE = 2;

export function PanelWheel({ items, selectedIndex, onChange }) {
  const N = items.length;
  const middleStart = Math.floor(REPEAT / 2) * N;
  const safeSelected = Math.min(Math.max(selectedIndex, 0), Math.max(0, N - 1));
  const initialGi = middleStart + safeSelected;
  const totalCount = REPEAT * N;

  const scrollRef = useRef(null);
  const lastGiRef = useRef(initialGi);
  // Position de depart FIGEE. contentOffset n est pas une prop « initiale » :
  // iOS comme Android la reappliquent a chaque changement de valeur, y compris
  // en plein geste. Comme initialGi depend de selectedIndex, la molette
  // sautait en arriere d un cycle entier des qu on depassait la premiere
  // boucle — l « infini » ne depassait donc jamais un tour.
  const offsetInitialRef = useRef(initialGi * WHEEL_ITEM_H);
  // Index affiche dans la bande, suivi pendant le geste. Resynchronise si la
  // valeur change depuis l exterieur (reset, changement d epreuve).
  const [visualIndex, setVisualIndex] = useState(safeSelected);
  useEffect(() => { setVisualIndex(safeSelected); }, [safeSelected]);

  // Recale la molette quand la selection bouge hors du composant : on vise la
  // copie la plus proche de la position courante pour eviter un long
  // defilement visuel.
  useEffect(() => {
    const cur = lastGiRef.current;
    const curBlock = Math.floor(cur / N);
    const candidates = [
      curBlock * N + safeSelected,
      (curBlock - 1) * N + safeSelected,
      (curBlock + 1) * N + safeSelected,
    ].filter((gi) => gi >= 0 && gi < totalCount);
    if (candidates.length === 0) return;
    const target = candidates.reduce(
      (best, gi) => (Math.abs(gi - cur) < Math.abs(best - cur) ? gi : best),
      candidates[0],
    );
    if (target !== cur) {
      lastGiRef.current = target;
      scrollRef.current?.scrollTo({ y: target * WHEEL_ITEM_H, animated: true });
    }
  }, [safeSelected, N, totalCount]);

  return (
    <View style={{ height: WHEEL_WINDOW_H, alignSelf: 'stretch', position: 'relative' }}>
      {/* Bande de selection, sous les items. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 12, right: 12, top: PAD_V,
          height: WHEEL_ITEM_H, borderRadius: 10, backgroundColor: P.wheelBand,
        }}
      />

      <ScrollView
        ref={scrollRef}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: offsetInitialRef.current }}
        contentContainerStyle={{ paddingTop: PAD_V, paddingBottom: PAD_V }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const gi = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
          lastGiRef.current = gi;
          const idx = ((gi % N) + N) % N;
          if (idx !== visualIndex) {
            try { Haptics?.selectionAsync?.(); } catch {}
            // La valeur AFFICHEE dans la bande suit le doigt — c est ce que
            // demande le handoff, et c est purement local a ce composant.
            //
            // En revanche on ne remonte PAS a chaque cran : onChange appelle
            // setSelectedRace/setSelectedKm sur PhotographerScreen, qui
            // rejoue ~600 lignes de JSX et rediffe l element VisionCamera.
            // A 60 Hz pendant une inertie, pendant que la camera et le
            // detecteur de visages tournent, c est du temps pris a la capture
            // — donc des photos en moins. La valeur est validee au repos.
            setVisualIndex(idx);
          }
        }}
        onMomentumScrollEnd={(e) => {
          let gi = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
          const block = Math.floor(gi / N);
          // Saut silencieux vers le bloc central quand on approche d un bord :
          // c est ce qui rend le defilement sans fin dans les deux sens.
          if (block < SAFE || block >= REPEAT - SAFE) {
            const offsetWithinBlock = gi - block * N;
            gi = middleStart + offsetWithinBlock;
            scrollRef.current?.scrollTo({ y: gi * WHEEL_ITEM_H, animated: false });
          }
          lastGiRef.current = gi;
          const idx = ((gi % N) + N) % N;
          if (idx !== safeSelected) onChange(idx);
        }}
      >
        {Array.from({ length: totalCount }, (_, gi) => {
          const it = items[gi % N];
          return (
            <View
              key={gi}
              style={{ height: WHEEL_ITEM_H, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  color: P.ink, fontSize: 17, 
                  fontFamily: 'Montserrat', maxWidth: '100%',
                }}
              >
                {it.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Estompes : le blanc opaque du panneau vers transparent, 50 px. */}
      <LinearGradient
        pointerEvents="none"
        colors={[P.surface, 'rgba(255,255,255,0)']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: PAD_V }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', P.surface]}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: PAD_V }}
      />
    </View>
  );
}
