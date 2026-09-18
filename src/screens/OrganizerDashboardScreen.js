// Dashboard organisateur : header avec avatar + toggle orga/photo,
// liste des events (EventCard + badge statut + actions Modifier/Photos/
// Supprimer), bouton + Creer un evenement en bas.
//
// Status workflow worker :
//   pending -> en cours de validation admin
//   validated -> admin a valide, en attente decision billing
//   pending_payment -> admin a fixe un montant, en attente reglement orga
//   free -> active en mode gratuit, en ligne
//   paid -> regle, en ligne
//   rejected -> refuse par admin

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking, AppState } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EventCard } from '../components/EventCard';
import { RefreshableScrollView } from '../components/loaders';
import { C } from '../constants/colors';
import { s } from '../constants/styles';

export function OrganizerDashboardScreen({ session, organizerApiFetch, onLogout, onCreateEvent, onEditEvent, onOpenProfile, onOpenEventPhotos, onOpenEventDetail, onOpenOrgRole, refreshKey = 0, headerH = 0 }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);
  const [checkoutOuvert, setCheckoutOuvert] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await organizerApiFetch(`/organizer/my-events`);
      const data = await r.json();
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''))
        : [];
      setEvents(sorted);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [refreshKey]);

  // Retour de Stripe Checkout : l event n est actif qu une fois le webhook
  // passe. On recharge donc la liste au retour au premier plan, l etat reel
  // renvoye par le worker fait foi (aucune promesse cote app).
  useEffect(() => {
    if (!checkoutOuvert) return undefined;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { setCheckoutOuvert(false); reload(); }
    });
    return () => sub?.remove?.();
  }, [checkoutOuvert]);

  // POST /organizer/pay-event/:code ne debite RIEN et n active RIEN : il cree
  // une Stripe Checkout Session et renvoie { checkout_url }. C est le webhook
  // Stripe qui bascule event.active apres reglement reel. On ouvre donc
  // l URL et on n annonce aucun succes a ce stade.
  //
  // estimated_photos : le web calcule coureurs x (postes + photographes
  // externes). L app mobile n a que estimated_participants — aucun champ
  // "postes" ni "photographes externes" n existe sur cet ecran. On envoie
  // donc coureurs x 1 poste, qui est exactement le reglage par defaut du
  // modal web (postes=1, externes=0). Sans nombre de coureurs on ne devine
  // pas : un corps vide ferait tomber le worker sur tierForPhotos(0), soit
  // le plancher 39 EUR, un montant faux sur une vraie carte.
  const lancerCheckout = async (e, estimatedPhotos) => {
    setPaying(e.code);
    try {
      const r = await organizerApiFetch(`/organizer/pay-event/${e.code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimated_photos: estimatedPhotos, photos_payantes: false }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Erreur', data.error || "Activation impossible pour l'instant");
        return;
      }
      if (data.checkout_url) {
        setCheckoutOuvert(true);
        try {
          await Linking.openURL(data.checkout_url);
        } catch (err) {
          setCheckoutOuvert(false);
          Alert.alert('Erreur', "La page de paiement n'a pas pu s'ouvrir. Réessaie, ou active ton event depuis will-app.com/orga.");
        }
        return;
      }
      // Pas de checkout_url : le worker est en mode legacy (dev sans cle
      // Stripe). On ne promet rien, on recharge et le statut renvoye fait foi.
      reload();
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Erreur réseau');
    } finally { setPaying(null); }
  };

  const pay = (e) => {
    const coureurs = Number(e?.estimated_participants);
    if (!Number.isFinite(coureurs) || coureurs <= 0) {
      Alert.alert(
        'Estimation manquante',
        "Le montant dépend du nombre de photos attendues. Renseigne le nombre de coureurs dans « Modifier », ou active ton event depuis will-app.com/orga pour estimer précisément (postes photo, photographes externes).",
        [{ text: 'OK' }]
      );
      return;
    }
    const photos = Math.round(coureurs);
    Alert.alert(
      'Mettre en ligne',
      `Estimation : ${photos} photos (${photos} coureurs × 1 poste photo). Tu vas être redirigé vers la page de paiement sécurisée, où le montant s'affiche avant validation. Le prix définitif est régularisé après l'event sur le nombre réel de photos.\n\nPlusieurs postes ou des photographes externes ? Estime depuis will-app.com/orga.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Continuer', onPress: () => lancerCheckout(e, photos) },
      ]
    );
  };

  const deleteEvent = (e) => {
    Alert.alert(
      'Supprimer cet événement ?',
      `"${e.name}" sera définitivement supprimé, ainsi que toutes ses photos. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await organizerApiFetch(`/organizer/event/${e.code}`, {
                method: 'DELETE',
              });
              if (r.ok) reload();
              else {
                const data = await r.json();
                Alert.alert('Erreur', data.error || 'Échec de la suppression');
              }
            } catch (err) {
              Alert.alert('Erreur', err.message);
            }
          },
        },
      ]
    );
  };

  const statusInfo = (st) => {
    if (st === 'pending') return { label: 'En cours de validation', color: C.warning, bg: '#FEF3C7' };
    if (st === 'validated') return { label: 'En cours d\'activation', color: '#8B5CF6', bg: '#EDE9FE' };
    if (st === 'pending_payment') return { label: 'À régler', color: '#EC4899', bg: '#FCE7F3' };
    if (st === 'free') return { label: 'En ligne · gratuit', color: C.success, bg: '#D1FAE5' };
    if (st === 'paid') return { label: 'En ligne', color: C.success, bg: '#D1FAE5' };
    if (st === 'rejected') return { label: 'Refusé', color: C.error, bg: '#FEE2E2' };
    // Repli : jamais le slug technique brut dans le badge.
    return { label: 'En cours', color: C.textSoft, bg: '#f5f3ff' };
  };

  return (
    <RefreshableScrollView onRefresh={reload} style={s.scroll} contentContainerStyle={{ paddingTop: headerH, paddingBottom: 100 }} showsVerticalScrollIndicator={false} topOffset={headerH}>
      {/* Un seul menu par ecran : l entete Will (logo, prenom, burger) est
          deja pose au-dessus par App.js. La barre avatar + bascule
          orga/photo faisait doublon — l avatar ouvrait le compte que le
          burger ouvre deja, et le changement d espace vit maintenant dans
          "Autres espaces" du menu. Il ne reste que le titre. */}
      <View style={{ paddingTop: 4, paddingBottom: 6, alignItems: 'center' }}>
        <Text style={[s.welcome, { color: C.primary, fontSize: 17 }]}>Mes events</Text>
      </View>

      <View style={{ height: 14 }} />

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
      ) : events.length === 0 ? (
        <View style={{ paddingVertical: 36, paddingHorizontal: 24, alignItems: 'center' }}>
          <Text style={{ color: '#1a0a3e', fontSize: 16, fontFamily: 'Montserrat-SemiBold', marginBottom: 6 }}>
            Aucun event pour l'instant
          </Text>
          <Text style={{ fontFamily: 'Montserrat', color: 'rgba(26,10,62,0.5)', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Crée ton premier event pour que Will envoie leurs photos à tes participants.
          </Text>
        </View>
      ) : (
        events.map((e, i) => {
          const info = statusInfo(e.status);
          return (
            <View key={i} style={{ marginBottom: 16 }}>
              <View style={{ position: 'relative' }}>
                <EventCard event={e} onPress={() => (onOpenEventDetail || onOpenEventPhotos)?.(e)} />
                <View style={{
                  position: 'absolute',
                  top: 10, right: 10,
                  backgroundColor: info.bg,
                  paddingHorizontal: 10, paddingVertical: 5,
                  borderRadius: 8,
                  zIndex: 10,
                }}>
                  <Text style={{ color: info.color, fontSize: 11, fontFamily: 'Montserrat-SemiBold' }}>{info.label}</Text>
                </View>
              </View>

              <View style={{ backgroundColor: '#FFFFFF', borderBottomLeftRadius: 18, borderBottomRightRadius: 18, marginTop: -12, paddingTop: 18, paddingHorizontal: 12, paddingBottom: 12 }}>
                {/* Un refus sans explication est pire qu un refus : le motif
                    saisi par l admin est affiche ici, sous l event. */}
                {e.status === 'rejected' && (
                  <View style={{ backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginBottom: 8 }}>
                    <Text style={{ color: C.error, fontSize: 13, fontFamily: 'Montserrat-SemiBold', marginBottom: e.rejected_motif ? 4 : 0 }}>
                      Demande non retenue
                    </Text>
                    {e.rejected_motif ? (
                      <Text style={{ color: '#7f1d1d', fontSize: 13, fontFamily: 'Montserrat', lineHeight: 18 }}>
                        {e.rejected_motif}
                      </Text>
                    ) : null}
                  </View>
                )}
                {e.status === 'pending' && (
                  <Text style={{ color: C.textSoft, fontSize: 12, fontFamily: 'Montserrat', marginBottom: 8, textAlign: 'center' }}>
                    L'équipe Will revient vers toi sous 24 h.
                  </Text>
                )}
                {e.status === 'pending_payment' && (
                  <TouchableOpacity
                    onPress={() => pay(e)}
                    disabled={paying === e.code}
                    style={{ backgroundColor: C.pinkPill, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8, opacity: paying === e.code ? 0.6 : 1 }}
                  >
                    {paying === e.code ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Mettre en ligne</Text>
                    )}
                  </TouchableOpacity>
                )}

                {/* Deux actions de meme rang, a plat : trois boutons cernes
                    d un filet dont un rouge donnaient autant de poids a
                    "Supprimer" qu au reste. La suppression passe en icone
                    discrete a droite — elle est deja protegee par une
                    confirmation. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => onEditEvent?.(e)}
                    style={{ flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EBFF' }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: C.primary, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onOpenEventPhotos?.(e)}
                    style={{ flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EBFF' }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: C.primary, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Photos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => deleteEvent(e)}
                    style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
                    hitSlop={6}
                    activeOpacity={0.7}
                    accessibilityLabel="Supprimer l'événement"
                  >
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"
                        stroke="rgba(26,10,62,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })
      )}

      <TouchableOpacity
        onPress={onCreateEvent}
        style={{ backgroundColor: C.primary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
        activeOpacity={0.85}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>+ Créer un événement</Text>
      </TouchableOpacity>
    </RefreshableScrollView>
  );
}
