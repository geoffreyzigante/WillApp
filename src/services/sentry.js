// Observabilite Sentry : crash reports + breadcrumbs + device state.
// Active uniquement si SENTRY_DSN defini (sinon no-op silencieux). DSN
// configure via Constants.expoConfig.extra.sentryDsn pour permettre une
// rotation sans rebuild (override OTA possible via eas update env).
//
// Pas de PII : aucun email/userId envoye. Si besoin de breadcrumb runner,
// utiliser un hash anonyme cote caller.

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = Constants?.expoConfig?.extra?.sentryDsn || Constants?.easConfig?.sentryDsn;
const ENV = Constants?.expoConfig?.extra?.eas?.projectId ? 'preview' : 'development';

let initialized = false;

export function initSentry() {
  if (initialized) return;
  if (!DSN) {
    console.log('[sentry] no DSN configured, skipping init');
    return;
  }
  try {
    Sentry.init({
      dsn: DSN,
      environment: ENV,
      // Track des actions runner pour reconstituer le contexte du crash.
      enableAutoPerformanceTracing: false, // pas besoin de perf pour V1
      tracesSampleRate: 0,
      // 30 breadcrumbs : assez pour reconstituer un flow capture / upload
      // sans gonfler la payload reseau.
      maxBreadcrumbs: 30,
      // Ne pas envoyer les PII automatiquement (email/userId etc.).
      sendDefaultPii: false,
      // Filtre des erreurs benignes hors notre controle.
      beforeSend(event) {
        const msg = event?.exception?.values?.[0]?.value || '';
        // Network errors normales (offline 4G dans le tunnel) : pas la peine
        // de polluer Sentry, on a deja le retry backoff cote queue.
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

// Wrapper qui ajoute un breadcrumb pour les actions importantes.
// Usage : trackEvent('photographer:capture-burst', { count: 5, reason: 'face-left-zone' })
export function trackEvent(category, data) {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({
      category,
      level: 'info',
      data: data || undefined,
    });
  } catch {}
}

// Capture une erreur explicite avec contexte additionnel.
export function captureError(err, context) {
  if (!initialized) {
    console.error('[error]', err?.message || err, context);
    return;
  }
  try {
    if (context) {
      Sentry.withScope((scope) => {
        Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {}
}

// ErrorBoundary HOC propre. Wrap App() avec ca pour que les crashes JS
// remontent automatiquement vers Sentry au lieu d'un screen blanc.
export const SentryErrorBoundary = Sentry.ErrorBoundary;
export const wrapRootComponent = Sentry.wrap;
