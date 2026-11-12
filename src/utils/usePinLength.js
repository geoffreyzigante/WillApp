// Longueur du PIN photographe a POSER (creation, modification d un event).
//
// Elle n est pas codee dans l app : le serveur l annonce dans GET /config
// (pin_length). La bascule de 4 a 6 chiffres se fait donc cote serveur, en
// une ligne, sans publier de mise a jour — et une app plus ancienne que la
// bascule continue de fonctionner sur les events a 4 chiffres.
//
// Tant que la reponse n est pas arrivee, ou si elle echoue : 4, la longueur
// historique. La valeur est gardee au niveau du module, donc relue sans
// attente a l ouverture suivante d un formulaire.

import { useEffect, useState } from 'react';
import { API_URL } from '../constants/api';
import { PIN_LENGTH_DEFAUT, normaliserLongueurPin } from './pin';

let longueurConnue = PIN_LENGTH_DEFAUT;
let enCours = null;

export function chargerLongueurPin() {
  if (enCours) return enCours;
  enCours = fetch(`${API_URL}/config`)
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (cfg && cfg.pin_length !== undefined) longueurConnue = normaliserLongueurPin(cfg.pin_length);
      return longueurConnue;
    })
    .catch(() => longueurConnue)
    .finally(() => { enCours = null; });
  return enCours;
}

export function useLongueurPinAPoser(actif = true) {
  const [longueur, setLongueur] = useState(longueurConnue);
  useEffect(() => {
    if (!actif) return undefined;
    let vivant = true;
    chargerLongueurPin().then((n) => { if (vivant) setLongueur(n); });
    return () => { vivant = false; };
  }, [actif]);
  return longueur;
}
