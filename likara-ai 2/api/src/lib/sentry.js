// Error tracking for the Node API. No-ops cleanly if SENTRY_DSN isn't set,
// so this is safe to leave wired in for local dev / before you've created a
// Sentry project. Once SENTRY_DSN is set (Railway/Render env var), every
// unhandled error and every explicit captureException call reports there.
import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn("SENTRY_DSN not set — error tracking is disabled.");
    return;
  }
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
  });
}

export { Sentry };
