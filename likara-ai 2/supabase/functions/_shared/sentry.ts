// Minimal error-reporting wrapper for Edge Functions. Uses @sentry/deno when
// SENTRY_DSN is configured; silently no-ops otherwise so local dev / a
// not-yet-configured project never breaks on a missing env var.
//
// Usage in every function's catch block:
//   import { captureException } from "../_shared/sentry.ts";
//   ...
//   catch (err) {
//     await captureException(err, { function: "lease-summarizer", lease_id });
//     ...
//   }
import * as Sentry from "https://esm.sh/@sentry/deno@8.9.2";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const dsn = Deno.env.get("SENTRY_DSN");
  if (dsn) {
    Sentry.init({ dsn, environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production", tracesSampleRate: 0.1 });
  }
  initialized = true;
}

export async function captureException(err: unknown, context?: Record<string, unknown>) {
  console.error("Edge Function error:", err, context ? JSON.stringify(context) : "");
  ensureInit();
  if (!Deno.env.get("SENTRY_DSN")) return; // no-op until SENTRY_DSN is set
  try {
    Sentry.captureException(err, { extra: context });
    await Sentry.flush(2000);
  } catch (sentryErr) {
    // Never let error-reporting itself take down the function.
    console.error("Sentry reporting failed:", sentryErr);
  }
}
