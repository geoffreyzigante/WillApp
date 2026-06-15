// Ecran detail event organisateur : bandeau cover + actions (voir photos,
// modifier, share lien public) + code PIN photographe (avec masque/reveal/
// copy/modify) + facturation + suppression.
//
// Countdown : "J-3" avant l event, "GO !" pendant (event_date -> event_date_end),
// "J+5" apres. End absent -> single-day.

import React, { useState } from 'react';
import {
  Modal, SafeAreaView, View, Text, TouchableOpacity, ScrollView,
  Alert, Share,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { C, colorForType } from '../constants/colors';
import { displayEventType } from '../utils/format';
import { isValidPin } from '../utils/pin';
import { PinDisplay } from '../components/PinDisplay';

export function OrganizerEventDetailScreen({ session, organizerApiFetch, event, onClose, onEdit, onOpenPhotos, onDeleted }) {
  const tint = colorForType(event.event_type);
  const [revealPwd, setRevealPwd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const photographerPwd = event?.photographer_password || '';
  const isReady = !!event?.active;
  const dotColor = isReady ? '#34D399' : '#FBBF24';
  const statusLabel = isReady ? 'Prêt à démarrer' : 'En attente';

  const dateStr = event.event_date
    ? new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '').toUpperCase()
    : 'Date à définir';

  const countdown = (() => {
    if (!event.event_date) return null;
    const start = new Date(event.event_date);
    if (isNaN(start.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    const end = event.event_date_end ? new Date(event.event_date_end) : new Date(event.event_date);
    if (isNaN(end.getTime())) end.setTime(start.getTime());
    end.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (t < start) return `J-${Math.round((start - t) / 86400000)}`;
    if (t <= end) return 'GO !';
    return `J+${Math.round((t - end) / 86400000)}`;
  })();

  const copyPwd = async () => {
    if (!photographerPwd) return;
    try { await Share.share({ message: photographerPwd }); } catch {}
  };

  const sharePublicLink = async () => {
    try { await Share.share({ message: `https://will-app.com/event/${event.code}` }); } catch {}
  };

  const confirmDelete = () => {
    Alert.alert(
      'Supprimer cet événement ?',
      'Cette action est définitive et irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const r = await organizerApiFetch(`/organizer/event/${event.code}`, {
                method: 'DELETE',
              });
              if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                Alert.alert('Erreur', data.error || 'Suppression impossible');
                setDeleting(false);
                return;
              }
              onDeleted?.();
            } catch (e) {
              Alert.alert('Erreur', e.message || 'Erreur réseau');
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const sub = [event.location, event.event_type ? displayEventType(event.event_type) : null].filter(Boolean).join(' · ');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 }}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={{ color: C.primary, fontSize: 16, fontWeight: '500' }}>‹ Fermer</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Bandeau colore */}
          <View style={{ height: 180, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: tint, position: 'relative' }}>
            {event.cover_image ? (
              <ExpoImage source={{ uri: event.cover_image }} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="cover" />
            ) : null}
            <LinearGradient
              colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <View style={{ flex: 1, padding: 18, justifyContent: 'flex-end' }}>
              <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '600', letterSpacing: 1.2, marginBottom: 6 }}>
                {dateStr}
              </Text>
              <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }} numberOfLines={1}>
                {event.name}
              </Text>
              {sub ? (
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 4 }} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
              <View style={{ marginTop: 10, flexDirection: 'row' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dotColor }} />
                  <Text style={{ color: '#1A1A1A', fontSize: 12, fontWeight: '500' }}>{statusLabel}</Text>
                </View>
              </View>
            </View>
            {countdown ? (
              <Text style={{ position: 'absolute', right: 14, bottom: 10, color: '#fff', fontSize: 32, fontWeight: '700', fontStyle: 'italic', letterSpacing: -1 }}>
                {countdown}
              </Text>
            ) : null}
          </View>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 16 }}>
            <TouchableOpacity onPress={onOpenPhotos} style={{ flex: 2, backgroundColor: C.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Voir les photos</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onEdit} style={{ flex: 2, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Modifier</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={sharePublicLink} style={{ flex: 1, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: C.primary, fontSize: 18, fontWeight: '600' }}>↗</Text>
            </TouchableOpacity>
          </View>

          {/* Code PIN photographe */}
          <View style={{ marginHorizontal: 16, marginTop: 28 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Code PIN photographe</Text>
            <Text style={{ fontSize: 13, color: C.textSoft, marginTop: 2 }}>À transmettre à tes photographes le jour J</Text>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              {isValidPin(photographerPwd) ? (
                <PinDisplay pin={photographerPwd} masked={!revealPwd} />
              ) : (
                <Text style={{ color: C.textSoft, fontSize: 14 }}>Non défini</Text>
              )}
              <View style={{ flexDirection: 'row', gap: 18, marginTop: 14 }}>
                {isValidPin(photographerPwd) ? (
                  <>
                    <TouchableOpacity onPress={() => setRevealPwd(v => !v)} hitSlop={8}>
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>{revealPwd ? 'Masquer' : 'Afficher'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={copyPwd} hitSlop={8}>
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>Copier</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onEdit} hitSlop={8}>
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>Modifier</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity onPress={onEdit} hitSlop={8}>
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>Définir</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {/* Facturation */}
          <View style={{ marginHorizontal: 16, marginTop: 28 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Facturation</Text>
            <Text style={{ fontSize: 14, color: C.text, marginTop: 8 }}>Offre partenaire gratuite</Text>
          </View>

          {/* Lien Supprimer */}
          <View style={{ marginTop: 36, alignItems: 'center' }}>
            <TouchableOpacity onPress={confirmDelete} disabled={deleting} hitSlop={12}>
              <Text style={{ color: deleting ? C.textSoft : C.error, fontSize: 14, fontWeight: '500' }}>
                {deleting ? 'Suppression…' : 'Supprimer cet événement'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
