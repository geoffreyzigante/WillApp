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
import { EventCard } from '../components/EventCard';
import { CtaWill, CtaWill2 } from '../components/CtaWill';
import { isUpcoming } from '../utils/format';
import { T } from '../constants/tokens';
import { RefreshableScrollView } from '../components/loaders';
import { C } from '../constants/colors';
import { s } from '../constants/styles';


// Ordre de la liste, sans onglets : les a venir (le plus proche en tete), puis
// les passes (le plus recent en tete), puis les events sans date. Meme regle
// que /public-events.
const cleDate = (e) => e.event_date_end || e.event_date || '';
const groupe = (e) => {
  const d = cleDate(e);
  if (!d) return 2;
  return isUpcoming(e.event_date, e.event_date_end) ? 0 : 1;
};
const comparerEvents = (a, b) => {
  const ga = groupe(a); const gb = groupe(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0) return (a.event_date || '').localeCompare(b.event_date || '');
  if (ga === 1) return cleDate(b).localeCompare(cleDate(a));
  return String(a.name || '').localeCompare(String(b.name || ''));
};

// Decompte : memes trois etats que la hero de la fiche event (J-X, GO !,
// rien apres l event).
const decompte = (e) => {
  if (!e.event_date) return null;
  const start = new Date(e.event_date);
  if (isNaN(start.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  const end = e.event_date_end ? new Date(e.event_date_end) : new Date(e.event_date);
  if (isNaN(end.getTime())) end.setTime(start.getTime());
  end.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (t < start) return `J-${Math.round((start - t) / 86400000)}`;
  if (t <= end) return 'GO !';
  return null;
};

// Barre de progression : 4 segments (cree, valide, en ligne, photos).
function Segments({ n, couleur }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginBottom: 14 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < n ? couleur : T.couleur.filet }} />
      ))}
    </View>
  );
}

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
      const sorted = Array.isArray(data) ? [...data].sort(comparerEvents) : [];
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
        "Le montant dépend du nombre de photos attendues. Renseigne le nombre de participants dans « Modifier », ou active ton event depuis will-app.com/orga pour estimer précisément (postes photo, photographes externes).",
        [{ text: 'OK' }]
      );
      return;
    }
    const photos = Math.round(coureurs);
    Alert.alert(
      'Mettre en ligne',
      `Estimation : ${photos} photos (${photos} participants × 1 poste photo). Tu vas être redirigé vers la page de paiement sécurisée, où le montant s'affiche avant validation. Le prix définitif est régularisé après l'event sur le nombre réel de photos.\n\nPlusieurs postes ou des photographes externes ? Estime depuis will-app.com/orga.`,
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

  // Etat affiche sous la card : phrase de statut, nombre de segments, couleur,
  // detail eventuel. Un event en ligne dont la date est passee est « Terminé ».
  const etatEvent = (e) => {
    const st = e.status;
    const passe = !!cleDate(e) && !isUpcoming(e.event_date, e.event_date_end);
    if (st === 'pending') return { label: 'En validation', n: 1, couleur: T.couleur.attente.texte, detail: "L'équipe Will revient vers toi sous 24 h." };
    if (st === 'validated') return { label: "En cours d'activation", n: 2, couleur: C.primary };
    if (st === 'pending_payment') return { label: 'À régler', n: 2, couleur: C.primary };
    if (st === 'rejected') return { label: 'Demande non retenue', n: 1, couleur: T.couleur.erreur, erreur: true, detail: e.rejected_motif || '' };
    if (st === 'free' || st === 'paid') {
      if (passe) return { label: 'Terminé', n: 4, couleur: C.primary, passe: true };
      const cd = decompte(e);
      return { label: st === 'free' ? 'En ligne · gratuit' : 'En ligne', n: 3, couleur: C.primary, detail: cd === 'GO !' ? '' : 'Les photos arrivent le jour J', enCours: cd === 'GO !' };
    }
    return { label: 'En cours', n: 1, couleur: C.primary };
  };

  return (
    <RefreshableScrollView onRefresh={reload} style={s.scroll} contentContainerStyle={{ paddingTop: headerH, paddingBottom: 100 }} showsVerticalScrollIndicator={false} topOffset={headerH}>
      {/* Un seul menu par ecran : l entete Will (logo, prenom, burger) est
          deja pose au-dessus par App.js. La barre avatar + bascule
          orga/photo faisait doublon — l avatar ouvrait le compte que le
          burger ouvre deja, et le changement d espace vit maintenant dans
          "Autres espaces" du menu. Il ne reste que le titre. */}
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
          const etat = etatEvent(e);
          const cd = decompte(e);
          const photosEnPremier = !!etat.passe || !!etat.enCours;
          return (
            /* Un event = un bloc : la card et sa bande de statut sont reunies
               dans une meme carte blanche a bord arrondi et filet, avec 24 de
               vide entre deux events. Avant, la bande blanche se confondait
               avec le fond et l on ne voyait plus ou un event s arretait. */
            <View key={e.code || i} style={{ marginBottom: 24, borderRadius: 18, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: T.couleur.filet }}>
              <View style={{ position: 'relative' }}>
                <EventCard
                  event={e}
                  onPress={() => (onOpenEventDetail || onOpenEventPhotos)?.(e)}
                  style={{ borderRadius: 0, marginBottom: 0 }}
                />
                {cd ? (
                  /* Meme decompte que la hero de la fiche event, a 16 du bas
                     de la card. */
                  <View pointerEvents="none" style={{ position: 'absolute', bottom: 16, right: 16 }}>
                    <Text style={{ color: '#fff', fontFamily: 'Montserrat-Bold', fontSize: 28, lineHeight: 28, includeFontPadding: false, textAlignVertical: 'center', letterSpacing: -0.8, transform: [{ skewX: '-14deg' }] }}>
                      {cd}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={{ paddingTop: 16, paddingHorizontal: 16, paddingBottom: 16 }}>
                <Segments n={etat.n} couleur={etat.couleur} />
                {/* 1 nom + date (la card) · 2 statut en mots · 3 action. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: etat.erreur ? T.couleur.erreur : etat.couleur === T.couleur.attente.texte ? T.couleur.attente.texte : (etat.passe || etat.n >= 3) ? C.success : etat.couleur }} />
                  <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 14, color: etat.erreur ? T.couleur.erreur : T.couleur.texte }}>{etat.label}</Text>
                </View>
                {etat.detail ? (
                  <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: T.couleur.texteDoux, marginTop: 4, marginLeft: 16, lineHeight: 18 }}>{etat.detail}</Text>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
                  {e.status === 'pending_payment' ? (
                    <>
                      {paying === e.code ? (
                        <ActivityIndicator color={C.primary} />
                      ) : (
                        <CtaWill label="Mettre en ligne" variante="violet" onPress={() => pay(e)} />
                      )}
                      <CtaWill2 label="Modifier" onPress={() => onEditEvent?.(e)} />
                    </>
                  ) : photosEnPremier ? (
                    <>
                      <CtaWill label="Photos" variante="violet" onPress={() => onOpenEventPhotos?.(e)} />
                      <CtaWill2 label="Modifier" onPress={() => onEditEvent?.(e)} />
                    </>
                  ) : (
                    <>
                      <CtaWill label="Modifier" variante="violet" onPress={() => onEditEvent?.(e)} />
                      {etat.erreur ? <CtaWill2 label="Supprimer" variante="erreur" onPress={() => deleteEvent(e)} /> : null}
                    </>
                  )}
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
