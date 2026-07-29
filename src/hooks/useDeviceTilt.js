// Tangage / roulis de l'appareil pour le guide de cadrage (§1.8).
//
// ⚠️ PRÉREQUIS BUILD : `expo-sensors` n'est PAS installé aujourd'hui.
//     npx expo install expo-sensors
//     -> nouvelle dépendance native : exige un build EAS, pas un simple OTA.
//     Le plugin v2 (bbox, M2) exige de toute façon un build : les grouper.
//
// Pourquoi Accelerometer et pas DeviceMotion : on ne veut QUE la direction de
// la gravité. L'accéléromètre suffit, coûte moins cher, et à 10 Hz reste
// négligeable devant la preview caméra (35-45 %/h, cf. AUDIT_BATTERIE).
// Le lissage exponentiel élimine les micro-vibrations sans latence perçue.

import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
// framingGuide vit dans src/services/ (module de calcul pur, partage avec
// FramingGuide.js). Ce hook est dans src/hooks/ : chemin remontant obligatoire.
import { attitudeFromGravity } from '../services/framingGuide';

const UPDATE_MS = 100;   // 10 Hz : largement suffisant pour un appareil posé
const ALPHA = 0.15;      // lissage EMA — plus bas = plus stable, plus lent

/**
 * @param {boolean} enabled  monter/démonter l'abonnement. IMPÉRATIF : passer
 *        false dès que le guide n'est plus affiché — inutile de tourner
 *        pendant les 4-6 h d'un event.
 * @returns {{pitch:number, roll:number, available:boolean}} radians
 */
export function useDeviceTilt(enabled = true) {
  const [tilt, setTilt] = useState({ pitch: 0, roll: 0, available: false });
  const smoothed = useRef(null);

  useEffect(() => {
    if (!enabled) {
      smoothed.current = null;
      return undefined;
    }
    let sub = null;
    let cancelled = false;

    (async () => {
      // iOS renvoie true, mais on garde la garde : sur simulateur ou appareil
      // dégradé, mieux vaut masquer le guide que d'afficher un repère faux.
      let ok = true;
      try { ok = await Accelerometer.isAvailableAsync(); } catch { ok = false; }
      if (cancelled) return;
      if (!ok) {
        setTilt({ pitch: 0, roll: 0, available: false });
        return;
      }

      Accelerometer.setUpdateInterval(UPDATE_MS);
      sub = Accelerometer.addListener(({ x, y, z }) => {
        // expo-sensors renvoie l'accélération en g, gravité INCLUSE. Appareil
        // posé => c'est la gravité pure. Le lissage absorbe les secousses de
        // manipulation pendant le réglage.
        //
        // Convention : le vecteur mesuré pointe à l'OPPOSÉ de la gravité
        // (force spécifique). On le renverse pour retrouver « vers le bas ».
        const g = { x: -x, y: -y, z: -z };
        const a = attitudeFromGravity(g);
        const prev = smoothed.current;
        const next = prev
          ? {
              pitch: prev.pitch + ALPHA * (a.pitch - prev.pitch),
              // interpolation circulaire pour ne pas traverser ±π
              roll: prev.roll + ALPHA * Math.atan2(
                Math.sin(a.roll - prev.roll), Math.cos(a.roll - prev.roll)),
            }
          : a;
        smoothed.current = next;
        setTilt({ ...next, available: true });
      });
    })();

    return () => {
      cancelled = true;
      if (sub) sub.remove();
      smoothed.current = null;
    };
  }, [enabled]);

  return tilt;
}
