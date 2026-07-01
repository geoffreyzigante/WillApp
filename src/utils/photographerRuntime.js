// Etat runtime partage entre le boot (recuperation post-crash) et le
// heartbeat (LOT 1.6). Non persiste : reset a chaque cold start.
//
// Utilisation :
//   - Au boot App, si @will_photographer_active === 'true' :
//       runtimeState.recoveredFromCrash = true;
//       runtimeState.recoveredAt = Date.now();
//   - Dans le premier heartbeat envoye, on inclut recovered_from_crash: true
//     puis on met le flag a false (une seule notif par cold start).
//
// Cette approche evite de faire remonter recoveredFromCrash via prop :
// PhotographerScreen n a pas besoin de le connaitre, seul le service
// heartbeat le lit.

export const photographerRuntime = {
  recoveredFromCrash: false,
  recoveredAt: 0,
};

export function consumeCrashRecoveryFlag() {
  const was = photographerRuntime.recoveredFromCrash;
  if (was) {
    photographerRuntime.recoveredFromCrash = false;
  }
  return was;
}
