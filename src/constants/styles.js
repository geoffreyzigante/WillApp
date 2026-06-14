// StyleSheet centralise -- reference par les composants via `s.xxx`.
//
// Le StyleSheet.create() est cree au module load, partage entre tous les
// imports (les composants reutilisent la meme reference -> RN optimise
// le diff styles cote natif).
//
// Utilise C (couleurs design tokens) et SCREEN_W (largeur ecran) en deps.

import { StyleSheet, Dimensions } from 'react-native';
import { C } from './colors';

const { width: SCREEN_W } = Dimensions.get('window');

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 20 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orgToggle: {
    flexDirection: 'row',
    backgroundColor: C.pinkPill,
    borderRadius: 14,
    alignItems: 'center',
  },
  orgToggleBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgToggleDivider: {
    width: 1,
    height: 20,
    // Separateur translucide clair, valeur independante (pas couplee a pinkPillFg).
    backgroundColor: 'rgba(255, 245, 255, 0.5)',
  },

  welcome: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 18, color: C.text, fontWeight: '700' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 18 },

  selfieDoneBanner: { backgroundColor: C.white, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8, borderWidth: 1, borderColor: C.primaryLight },
  selfieCheckCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.pinkPill, alignItems: 'center', justifyContent: 'center' },
  selfieDoneTitle: { fontWeight: '700', fontSize: 15, color: C.primary, fontFamily: 'AVEstiana', fontStyle: 'normal' },
  selfieDoneSub: { fontSize: 12, color: C.textSoft, marginTop: 2, lineHeight: 16 },
  selfieDelete: { padding: 6 },

  selfieCard: { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', minHeight: 110, marginBottom: 8 },
  // Utilise le nom PostScript natif 'AVEstiana-Bold' (vs alias 'AVEstiana')
  // pour que iOS resolve le font sans ambiguite weight / style.
  selfieTitle: { color: '#fff', fontSize: 24, fontFamily: 'AVEstiana-Bold', lineHeight: 28 },
  selfieSub: { color: 'rgba(255,255,255,0.85)', marginTop: 6, fontSize: 12.5, lineHeight: 17 },
  selfieAvatar: { width: 68, height: 68, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },

  eventPick: { backgroundColor: C.white, borderRadius: 14, padding: 14, marginTop: 8 },
  eventPickName: { fontWeight: '700', fontSize: 15, color: C.text },
  eventPickDate: { fontSize: 12, color: C.textSoft, marginTop: 2 },

  sectionTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text },
  pill: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 12 },
  pillActive: { backgroundColor: C.primary },
  pillText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  pillTextActive: { color: '#fff' },

  empty: { textAlign: 'center', color: C.textSoft, marginTop: 24, fontSize: 14 },

  eventCard: { height: 110, borderRadius: 16, overflow: 'hidden', marginBottom: 10, backgroundColor: '#222', justifyContent: 'center' },
  eventCardCenter: { paddingHorizontal: 16, zIndex: 2 },
  eventDate: { color: '#fff', fontFamily: 'Montserrat', fontSize: 11, fontWeight: '600', opacity: 0.9, marginBottom: 6, textTransform: 'none' },
  eventName: { color: '#fff', fontSize: 20, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal', marginBottom: 2 },
  eventLocation: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Montserrat', fontSize: 13, fontWeight: '500', marginTop: 2 },

  pageTitleCenter: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 26, fontWeight: '700', color: C.primary, textAlign: 'center', marginVertical: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: (SCREEN_W - 40 - 24) / 4, height: (SCREEN_W - 40 - 24) / 4, marginBottom: 8 },
  gridPlaceholder: { flex: 1, backgroundColor: C.primaryLight, borderRadius: 12 },
  gridImg: { flex: 1, borderRadius: 12 },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'transparent', flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 60, paddingTop: 12, paddingHorizontal: 12, zIndex: 6 },
  navBtn: { alignItems: 'center', justifyContent: 'flex-start', gap: 4, minWidth: 60 },
  navIconWrap: { height: 26, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 12, color: C.text, marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D0CCE3', alignSelf: 'center', marginBottom: 18 },
  modalTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 6 },
  modalSub: { color: C.textSoft, textAlign: 'center', marginBottom: 18, fontSize: 13 },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 12 },
  modalCancelText: { color: C.textSoft, fontWeight: '600' },

  btnPrimary: { backgroundColor: C.primary, padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: { backgroundColor: C.white, padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  btnSecondaryText: { color: C.primary, fontWeight: '600', fontSize: 14 },

  selfiePreviewWrap: { alignItems: 'center', marginVertical: 16 },
  selfiePreview: { width: 160, height: 160, borderRadius: 80 },

  typePill: { backgroundColor: C.white, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  typePillActive: { backgroundColor: C.primary },
  typePillText: { fontSize: 12, color: C.text, fontWeight: '600' },
});
