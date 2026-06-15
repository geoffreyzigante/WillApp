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
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Icon } from '../components/Icon';
import { EventCard } from '../components/EventCard';
import { RefreshableScrollView } from '../components/loaders';
import { C } from '../constants/colors';
import { s } from '../constants/styles';

export function OrganizerDashboardScreen({ session, organizerApiFetch, onLogout, onCreateEvent, onEditEvent, onOpenProfile, onOpenEventPhotos, onOpenEventDetail, onOpenOrgRole, refreshKey = 0 }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);

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

  const pay = async (slug) => {
    setPaying(slug);
    try {
      const r = await organizerApiFetch(`/organizer/pay-event/${slug}`, {
        method: 'POST',
      });
      if (r.ok) {
        Alert.alert('Paiement réussi', 'Ton événement est maintenant en ligne !');
        reload();
      } else {
        const data = await r.json();
        Alert.alert('Erreur', data.error || 'Échec du paiement');
      }
    } finally { setPaying(null); }
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
    return { label: st, color: C.textSoft, bg: '#f5f3ff' };
  };

  return (
    <RefreshableScrollView onRefresh={reload} style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      {/* Header (avatar gauche | bloc orga/photo droit) avec titre centre
          en absolute pour ne pas etre decale par la difference de largeur
          entre l avatar (40x40) et le bloc orga/photo (~92). Structure et
          dimensions strictement identiques au header de PhotosScreen pour
          que l avatar reste aligne Y/X au pixel pres entre les 2 onglets. */}
      <View style={[s.headerRow, { position: 'relative' }]}>
        <View style={s.headerLeft}>
          <TouchableOpacity
            hitSlop={10}
            onPress={onOpenProfile}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' }}
          >
            <Icon.User size={30} color={C.pinkPill} />
          </TouchableOpacity>
        </View>
        <View style={s.orgToggle}>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole?.('organizer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.GearOrg size={22} color={C.pinkPillFg} />
          </TouchableOpacity>
          <View style={s.orgToggleDivider} />
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole?.('photographer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.CamOrg size={24} color={C.pinkPillFg} />
          </TouchableOpacity>
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0, right: 0,
            top: 12, bottom: 4,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={[s.welcome, { color: C.primary, fontSize: 17 }]}>Mes events</Text>
        </View>
      </View>

      <View style={{ height: 14 }} />

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
      ) : events.length === 0 ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
            Tu n'as pas encore créé d'événement.{'\n'}Clique sur le bouton ci-dessous pour démarrer.
          </Text>
        </View>
      ) : (
        events.map((e, i) => {
          const info = statusInfo(e.status);
          return (
            <View key={i} style={{ marginBottom: 14 }}>
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
                  <Text style={{ color: info.color, fontSize: 11, fontWeight: '700' }}>{info.label}</Text>
                </View>
              </View>

              <View style={{ backgroundColor: '#faf9ff', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, marginTop: -10, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 12 }}>
                {e.status === 'pending_payment' && (
                  <TouchableOpacity
                    onPress={() => pay(e.code)}
                    disabled={paying === e.code}
                    style={{ backgroundColor: C.primary, paddingVertical: 11, borderRadius: 10, alignItems: 'center', marginBottom: 8, opacity: paying === e.code ? 0.6 : 1 }}
                  >
                    {paying === e.code ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Mettre en ligne</Text>
                    )}
                  </TouchableOpacity>
                )}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => onEditEvent?.(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: C.primary, borderWidth: 1, borderColor: C.primary }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onOpenEventPhotos?.(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary }}
                  >
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Photos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => deleteEvent(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.error }}
                  >
                    <Text style={{ color: C.error, fontSize: 13, fontWeight: '600' }}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })
      )}

      <TouchableOpacity
        onPress={onCreateEvent}
        style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 4 }}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>+ Créer un événement</Text>
      </TouchableOpacity>
    </RefreshableScrollView>
  );
}
