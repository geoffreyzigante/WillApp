// Ecran detail event organisateur — aligne sur la carte event du dashboard
// web (/orga) : bandeau cover avec statut + facturation en pastilles, bloc de
// completion (jauge, champs manquants, "Compléter" / "Soumettre mon event"),
// puis photos, code PIN en clair, visibilite publique et suppression.
//
// Les champs requis et le calcul du pourcentage vivent dans
// utils/eventCompletion.js, miroir de EventCompletionPanel.js cote web.
//
// Countdown : "J-3" avant l event, "GO !" pendant (event_date -> event_date_end),
// "J+5" apres. End absent -> single-day.

import React, { useState, useEffect } from 'react';
import {
  Modal, SafeAreaView, View, Text, TouchableOpacity, ScrollView,
  Alert, Share, Switch,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { C, colorForType } from '../constants/colors';
import { displayEventType } from '../utils/format';
import { isValidPin } from '../utils/pin';
import { PinDisplay } from '../components/PinDisplay';
import { completionOf, billingLabel } from '../utils/eventCompletion';

export function OrganizerEventDetailScreen({ session, organizerApiFetch, event, succes, onClose, onEdit, onOpenPhotos, onDeleted, onRefresh }) {
  const tint = colorForType(event.event_type);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listed, setListed] = useState(event?.listed !== false);
  const [savingListed, setSavingListed] = useState(false);
  const [copied, setCopied] = useState(false);
  const photographerPwd = event?.photographer_password || '';
  const isReady = !!event?.active;
  const dotColor = isReady ? '#34D399' : '#FBBF24';
  const statusLabel = isReady ? 'Prêt à démarrer' : 'En attente';
  const isDraft = event?.is_draft === true;

  // Visibilite publique : /organizer/my-events ne renvoie "listed" que pour
  // les events sortis du brouillon (branche _auth/<slug>/event.json). Sur un
  // brouillon ou un event en attente de validation le champ est absent, et
  // "event?.listed !== false" afficherait alors "Visible" par defaut, c est a
  // dire une information fausse. La visibilite publique n a de toute facon
  // aucun sens avant validation : on masque le bloc dans ces cas.
  const visibiliteConnue = event?.listed !== undefined && event?.listed !== null;
  const afficheVisibilite = visibiliteConnue
    && !isDraft
    && event?.status !== 'pending'
    && event?.status !== 'rejected';

  // L ecran peut recevoir un event rafraichi apres le PUT : on resynchronise
  // l etat local sur la valeur serveur, sauf pendant l enregistrement (sinon
  // on ecraserait la valeur optimiste en cours d envoi).
  useEffect(() => {
    if (savingListed) return;
    if (!visibiliteConnue) return;
    setListed(event.listed !== false);
  }, [event?.listed, event?.code]);

  const { missing, percent, isComplete } = completionOf(event, session?.profile);
  const facturation = billingLabel(event);

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

  // Pas de expo-clipboard dans le projet : l ajouter serait un module natif
  // de plus a rebuilder sur les deux plateformes. La feuille de partage fait
  // le travail et propose "Copier" nativement.
  // Le libelle disait « Copier » alors que c est une feuille de partage, et
  // « Partagé » s affichait meme quand l utilisateur annulait : Share.share
  // resout aussi sur dismissedAction.
  const copyPin = async () => {
    if (!isValidPin(photographerPwd)) return;
    try {
      const res = await Share.share({ message: photographerPwd });
      if (res?.action === Share.sharedAction) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch (e) {
      console.warn('[event] partage PIN :', e?.message || e);
    }
  };

  const sharePublicLink = async () => {
    try { await Share.share({ message: `https://will-app.com/event/${event.code}` }); }
    catch (e) { console.warn('[event] partage lien :', e?.message || e); }
  };

  const toggleListed = async (value) => {
    setSavingListed(true);
    const previous = listed;
    setListed(value);
    try {
      const r = await organizerApiFetch(`/organizer/event/${event.code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listed: value }),
      });
      if (!r.ok) throw new Error('Modification impossible');
      onRefresh?.();
    } catch (e) {
      setListed(previous);
      Alert.alert('Erreur', e.message || 'Modification impossible');
    } finally {
      setSavingListed(false);
    }
  };

  const submitEvent = () => {
    Alert.alert(
      'Tu es sûr ?',
      'Une fois soumis, ton event sera revu par notre équipe et publié rapidement.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            setSubmitting(true);
            try {
              const r = await organizerApiFetch(`/organizer/event/${event.code}/submit`, { method: 'POST' });
              if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                throw new Error(data.error || 'Soumission impossible');
              }
              Alert.alert('Envoyé', 'Ton event est en cours de validation, on revient vers toi sous 24h');
              onRefresh?.();
              onClose?.();
            } catch (e) {
              Alert.alert('Erreur', e.message || 'Soumission impossible');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
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
            <Text style={{ color: C.primary, fontSize: 16, fontFamily: 'Montserrat-Medium' }}>‹ Fermer</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Arrivee depuis la creation : le bandeau remplace l ecran de
              confirmation, qui disait ce que cette page dit deja. */}
          {succes ? (
            <View style={{ marginHorizontal: 16, marginBottom: 14, borderRadius: 14, backgroundColor: succes.brouillon ? '#F3EBFF' : '#E7F8F0', paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 15, color: succes.brouillon ? C.primary : '#047857' }}>
                {succes.brouillon ? 'Ton event est créé' : 'Ton event est parti en validation'}
              </Text>
              <Text style={{ fontFamily: 'Montserrat', fontSize: 13, lineHeight: 19, color: 'rgba(10,10,10,0.65)', marginTop: 4 }}>
                {succes.brouillon
                  ? "Il est dans ton espace, personne ne le voit encore. Complète-le, puis envoie-le."
                  : "L'équipe Will le vérifie sous 24 h. Tu recevras un email dès que c'est bon."}
              </Text>
              {succes.coverFailed ? (
                <Text style={{ fontFamily: 'Montserrat', fontSize: 12, lineHeight: 17, color: '#b45309', marginTop: 8 }}>
                  L'image de couverture n'a pas pu être envoyée. Tu peux la recharger ci-dessous.
                </Text>
              ) : null}
            </View>
          ) : null}
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
              <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12, fontFamily: 'Montserrat-SemiBold', letterSpacing: 1.2, marginBottom: 6 }}>
                {dateStr}
              </Text>
              <Text style={{ color: '#fff', fontSize: 24, fontFamily: 'Montserrat-SemiBold' }} numberOfLines={1}>
                {event.name}
              </Text>
              {sub ? (
                <Text style={{ fontFamily: 'Montserrat', color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 4 }} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
              {/* Statut + facturation : deux pastilles, comme le bandeau web. */}
              <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dotColor }} />
                  <Text style={{ color: '#1A1A1A', fontSize: 12, fontFamily: 'Montserrat-Medium' }}>{statusLabel}</Text>
                </View>
                {facturation ? (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Montserrat-Medium' }}>{facturation}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            {countdown ? (
              <Text style={{ position: 'absolute', right: 14, bottom: 10, color: '#fff', fontSize: 32, fontWeight: '700', fontStyle: 'italic', letterSpacing: -1 }}>
                {countdown}
              </Text>
            ) : null}
          </View>

          {/* Completion — brouillons uniquement, comme sur le web */}
          {isDraft ? (
            <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#fff', borderRadius: 18, padding: 18 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Montserrat-SemiBold', color: C.text }}>
                Ton event est complet à {percent}%
              </Text>
              <View style={{ height: 8, borderRadius: 999, backgroundColor: '#EDE7FF', marginTop: 10, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${percent}%`, borderRadius: 999, backgroundColor: C.primary }} />
              </View>

              {missing.length > 0 ? (
                <>
                  <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: 'rgba(10,10,10,0.6)', marginTop: 14, marginBottom: 8 }}>
                    Il te manque encore :
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {missing.map(f => (
                      <TouchableOpacity
                        key={f.id}
                        onPress={onEdit}
                        hitSlop={10}
                        style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, backgroundColor: '#EDE7FF' }}
                      >
                        <Text style={{ color: C.primary, fontSize: 13, fontFamily: 'Montserrat-Medium' }}>+ {f.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={{ fontSize: 13, color: C.success, marginTop: 14, fontFamily: 'Montserrat-SemiBold' }}>
                  Tout est prêt — tu peux soumettre ton event.
                </Text>
              )}

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
                {isComplete ? (
                  <>
                    <TouchableOpacity onPress={onEdit} style={{ flex: 1, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
                      <Text style={{ color: C.primary, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Modifier les infos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={submitEvent}
                      disabled={submitting}
                      style={{ flex: 1, backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 12, alignItems: 'center', opacity: submitting ? 0.6 : 1 }}
                    >
                      <Text style={{ color: C.pinkPillText, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>
                        {submitting ? 'Envoi…' : 'Soumettre mon event'}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity onPress={onEdit} style={{ flex: 1, backgroundColor: C.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Compléter mon event</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : null}

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 16 }}>
            <TouchableOpacity onPress={onOpenPhotos} style={{ flex: 2, backgroundColor: C.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Voir les photos</Text>
            </TouchableOpacity>
            {!isDraft ? (
              <TouchableOpacity onPress={onEdit} style={{ flex: 2, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
                <Text style={{ color: C.primary, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Modifier les infos</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={sharePublicLink} style={{ flex: 1, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: C.primary, fontSize: 18, fontFamily: 'Montserrat-SemiBold' }}>↗</Text>
            </TouchableOpacity>
          </View>

          {/* Code PIN photographe — en clair, comme sur le web */}
          <View style={{ marginHorizontal: 16, marginTop: 28 }}>
            <Text style={{ fontSize: 16, fontFamily: 'Montserrat-SemiBold', color: C.text }}>Code PIN photographe</Text>
            <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: C.textSoft, marginTop: 2 }}>À transmettre à tes photographes le jour J</Text>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              {isValidPin(photographerPwd) ? (
                <TouchableOpacity onPress={onEdit} activeOpacity={0.6}>
                  <PinDisplay pin={photographerPwd} masked={false} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={onEdit} hitSlop={8}>
                  <Text style={{ color: C.primary, fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Définir</Text>
                </TouchableOpacity>
              )}
              {isValidPin(photographerPwd) ? (
                <TouchableOpacity onPress={copyPin} hitSlop={8} style={{ marginTop: 12 }}>
                  <Text style={{ color: C.primary, fontSize: 13, fontFamily: 'Montserrat-Medium' }}>
                    {copied ? 'Partagé' : 'Partager le code'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Visibilite publique — masquee tant que l event n est pas valide
              (cf afficheVisibilite plus haut). */}
          {afficheVisibilite ? (
          <View style={{ marginHorizontal: 16, marginTop: 28 }}>
            <Text style={{ fontSize: 16, fontFamily: 'Montserrat-SemiBold', color: C.text }}>Visibilité</Text>
            <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: 'rgba(10,10,10,0.5)', marginTop: 2 }}>
              {listed
                ? 'Visible dans la liste publique Will.'
                : 'Masqué de la liste publique, accessible par lien direct.'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
              <Switch
                value={listed}
                onValueChange={toggleListed}
                disabled={savingListed}
                trackColor={{ false: '#D4D4D8', true: C.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
          ) : null}

          {/* Lien Supprimer */}
          <View style={{ marginTop: 36, alignItems: 'center' }}>
            <TouchableOpacity onPress={confirmDelete} disabled={deleting} hitSlop={12}>
              <Text style={{ color: deleting ? C.textSoft : C.error, fontSize: 14, fontFamily: 'Montserrat-Medium' }}>
                {deleting ? 'Suppression…' : 'Supprimer cet événement'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
