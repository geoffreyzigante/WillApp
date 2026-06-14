// Wrapper JS du module natif iOS ThermalMonitor (cf
// plugins/ThermalMonitor.m). Adapte CONCURRENCY upload selon
// NSProcessInfoThermalState pour soulager NPU/CPU sur events 4h+ :
//   nominal/fair -> 3 (default)
//   serious      -> 2 (CPU throttling actif, on soulage)
//   critical     -> 1 (proche shutdown iOS, on minimise)
//
// La capture reste a cadence pleine : on prefere ralentir le drain plutot
// qu'avoir un thermal shutdown camera en plein peloton.

import { NativeModules, NativeEventEmitter } from 'react-native';

export const ThermalMonitorModule = NativeModules.ThermalMonitor;
export const hasThermalMonitor = !!(
  ThermalMonitorModule && ThermalMonitorModule.getThermalState
);

export const thermalEmitter = hasThermalMonitor
  ? new NativeEventEmitter(ThermalMonitorModule)
  : null;

// State module-level mute par le listener et lu par drainQueue. Default
// 'nominal' pour ne pas penaliser le drain au demarrage avant le 1er read.
// Expose via getter pour que les imports ES restent vivants (les exports
// `let` sont des refs read-only cote consumer).
let _currentThermalState = 'nominal';
export function getCurrentThermalState() { return _currentThermalState; }

export function concurrencyForThermal(state) {
  switch (state) {
    case 'critical': return 1;
    case 'serious': return 2;
    case 'fair':
    case 'nominal':
    default: return 3;
  }
}

if (thermalEmitter) {
  thermalEmitter.addListener('ThermalStateChanged', (evt) => {
    if (evt && typeof evt.state === 'string') {
      const prev = _currentThermalState;
      _currentThermalState = evt.state;
      if (prev !== evt.state) {
        console.log(`[thermal] ${prev} -> ${evt.state} (CONCURRENCY=${concurrencyForThermal(evt.state)})`);
      }
    }
  });
  // Init async, ne bloque pas
  ThermalMonitorModule.getThermalState()
    .then(({ state }) => { if (state) _currentThermalState = state; })
    .catch(() => {});
}
