// Completion d un event organisateur — miroir exact de
// WILL/dashboard/src/orga/components/EventCompletionPanel.js REQUIRED_FIELDS.
// Toute modification ici doit etre repercutee la-bas, et inversement : les
// deux surfaces annoncent le meme pourcentage a l orga.

export const REQUIRED_FIELDS = [
  {
    id: 'start_time',
    label: 'Heure de départ',
    check: (ev) => !!(ev.start_time && String(ev.start_time).trim()),
  },
  {
    id: 'event_date_end',
    label: 'Date de fin',
    // Une date de debut suffit : un event d un jour a une fin implicite.
    check: (ev) => !!ev.event_date,
  },
  {
    id: 'distances',
    label: 'Distances',
    check: (ev) => Array.isArray(ev.distances) && ev.distances.length > 0,
  },
  {
    id: 'estimated_participants',
    label: 'Participants estimés',
    check: (ev) => {
      const v = ev.estimated_participants;
      return typeof v === 'number' ? v > 0 : !!(v && String(v).trim());
    },
  },
  {
    id: 'message',
    label: 'Description',
    check: (ev) => !!(ev.message && String(ev.message).trim()),
  },
  {
    id: 'phone',
    label: 'Téléphone',
    check: (ev, me) => {
      const evPhone = ev.phone && String(ev.phone).trim();
      const mePhone = me?.phone && String(me.phone).trim();
      return !!(evPhone || mePhone);
    },
  },
  {
    id: 'website',
    label: 'Site web',
    check: (ev) => !!(ev.website && String(ev.website).trim()),
  },
  {
    id: 'cover_image',
    label: 'Image de couverture',
    check: (ev) => !!(ev.cover_image && String(ev.cover_image).trim()),
  },
];

export function completionOf(ev, me) {
  const missing = REQUIRED_FIELDS.filter(f => !f.check(ev || {}, me));
  const percent = Math.round(((REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length) * 100);
  return { missing, percent, isComplete: missing.length === 0 };
}

// Mention de facturation affichee en pastille dans le bandeau — meme regle
// que billingLabel() du dashboard.
export function billingLabel(ev) {
  const mode = ev?.mode || (ev?.billing_status === 'paid' || ev?.billing_status === 'pending_payment' ? 'sold' : 'free');
  if (mode === 'free') return 'Offre partenaire gratuite';
  const pricingMode = ev?.pricing_mode === 'free' ? 'free' : (ev?.pricing_mode === 'paid' ? 'paid' : null);
  if (ev?.active && pricingMode) {
    return `Forfait ${pricingMode === 'free' ? 'Photos offertes' : 'Coureurs paient'}`;
  }
  const status = ev?.billing_status || ev?.status;
  if (status === 'paid' || status === 'active') return 'Payé';
  if (status === 'pending_payment') return 'À régler';
  return null;
}
