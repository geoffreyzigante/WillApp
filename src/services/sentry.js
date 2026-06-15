// Observabilite Sentry : crash reports + breadcrumbs + device state.
// Active uniquement si SENTRY_DSN defini ET module natif @sentry/react-native
// present dans le build (require() lazy + try/catch). Cas OTA preview qui
// charge le JS avec Sentry sur un build sans natif Sentry : tout devient
// no-op silencieux au lieu de crasher au boot.
//
// Pas de PII : aucun email/userId envoye. Si besoin de breadcrumb runner,
// utiliser un hash anonyme cote caller.

import Constants from 'expo-constants';

const DSN = Constants?.expoConfig?.extra?.sentryDsn || Constants?.easConfig?.sentryDsn;
const ENV = Constants?.expoConfig?.extra?.eas?.projectId ? 'preview' : 'development';

let Sentry = null;
let initialized = false;
let nativeMissing = false;

function loadSentry() {
  if (Sentry) return Sentry;
  if (nativeMissing) return null;
  try {
    Sentry = require('@sentry/react-native');
    return Sentry;
  } catch (e) {
    nativeMissing = true;
    console.warn('[sentry] native module missing, running OTA on pre-Sentry build, no-op');
    return null;
  }
}

export function initSentry() {
  if (initialized) return;
  if (!DSN) {
    console.log('[sentry] no DSN configured, skipping init');
    return;
  }
  const S = loadSentry();
  if (!S) return;
  try {
    S.init({
      dsn: DSN,
      environment: ENV,
      enableAutoPerformanceTracing: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 30,
      sendDefaultPii: false,
      beforeSend(event) {
        const msg = event?.exception?.values?.[0]?.value || '';
        if (/Network request failed|Connexion impossible/i.test(msg)) return null;
        return event;
      },
    });
    initialized = true;
    console.log('[sentry] initialized for env', ENV);
  } catch (e) {
    console.warn('[sentry] init failed:', e?.message || e);
  }
}

export function trackEvent(category, data) {
  if (!initialized) return;
  const S = loadSentry();
  if (!S) return;
  try {
    S.addBreadcrumb({ category, level: 'info', data: data || undefined });
  } catch {}
}

export function captureError(err, context) {
  const S = loadSentry();
  if (!initialized || !S) {
    console.error('[error]', err?.message || err, context);
    return;
  }
  try {
    if (context) {
      S.withScope((scope) => {
        Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
        S.captureException(err);
      });
    } else {
      S.captureException(err);
    }
  } catch {}
}

// wrapRootComponent : si Sentry natif absent, on retourne l identite.
// App() devient simplement App() au lieu de Sentry.wrap(App()).
export function wrapRootComponent(Component) {
  const S = loadSentry();
  if (!S || typeof S.wrap !== 'function') return Component;
  try { return S.wrap(Component); } catch { return Component; }
}

export const SentryErrorBoundary = null;
