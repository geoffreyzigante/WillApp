// Completion d un event organisateur — MIROIR de CHAMPS_EVENT_REQUIS dans
// WILL/worker/index.js, qui est la source de verite : c est lui qui autorise
// ou refuse la soumission. Ce fichier ne sert qu a afficher (jauge, pastilles
// « il manque »). Toute modification doit partir du worker.
// Miroir jumeau : WILL/dashboard/src/orga/components/EventCompletionPanel.js

const plein = (v) => !!(v && String(v).trim());

export const REQUIRED_FIELDS = [
  {
    id: 'event_date',
    label: "Date de l'event",
    check: (ev) => plein(ev.event_date),
  },
  {
    id: 'distances',
    label: 'Courses',
    check: (ev) => Array.isArray(ev.distances) && ev.distances.length > 0,
  },
  {
    id: 'estimated_participants',
    label: 'Participants estimés',
    check: (ev) => {
      const v = ev.estimated_participants;
      return typeof v === 'number' ? v > 0 : plein(v);
    },
  },
  {
    id: 'message',
    label: 'Description',
    check: (ev) => plein(ev.message),
  },
  {
    id: 'cover_image',
    label: 'Image de couverture',
    check: (ev) => plein(ev.cover_image),
  },
  {
    id: 'contact_admin',
    label: 'Email administratif',
    check: (ev, me) => plein(ev.contact_admin) || plein(ev.organizer_email) || plein(me?.email),
  },
  {
    id: 'contact_public',
    label: 'Contact public',
    check: (ev, me) => plein(ev.contact) || plein(ev.phone) || plein(ev.website) || plein(me?.phone),
  },
];

export function completionOf(ev, me) {
  // Le worker joint sa propre liste aux events qu il renvoie : c est elle qui
  // fait foi, puisque c est elle qui autorisera la soumission. On ne
  // recalcule que pour des donnees locales (formulaire en cours de saisie),
  // ou pour un ancien client qui ne la recoit pas encore.
  if (Array.isArray(ev?.manquants)) {
    const missing = ev.manquants;
    const percent = typeof ev.completion === 'number'
      ? ev.completion
      : Math.round(((REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length) * 100);
    return { missing, percent, isComplete: missing.length === 0 };
  }
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
