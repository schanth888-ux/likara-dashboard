// Likara AI — Node.js API server.
// Purpose: reusable business-logic layer sitting between Retool and Supabase.
// Every route delegates persistence to the RLS-scoped Supabase client
// (req.supabase, set by requireAuth) so multi-tenant isolation is enforced by
// Postgres, not by this application. This same layer is designed to be
// mounted unchanged behind the Phase 2 WhatsApp bot's webhook handler.
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { initSentry, Sentry } from "./lib/sentry.js";
import { requireAuth } from "./middleware/auth.js";
import entitiesRouter from "./routes/entities.js";
import leasesRouter from "./routes/leases.js";
import paymentsRouter from "./routes/payments.js";
import importRouter from "./routes/importRoutes.js";
import aiRouter from "./routes/ai.js";
import ownerPortalRouter from "./routes/ownerPortal.js";

initSentry();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(
  cors({
    origin: (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean),
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

// Basic IP-based rate limiting (P0 requirement: "limits login attempts / API abuse").
// Supabase Auth handles login-attempt limiting natively; this covers the REST API surface.
app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX || 100),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "likara-api", tz: "Asia/Hong_Kong" }));

// Everything below requires a valid Supabase session JWT.
app.use(requireAuth);

app.use("/api", entitiesRouter);
app.use("/api/leases", leasesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/import", importRouter);
app.use("/api/ai", aiRouter);
// Owner Portal routes check their OWN auth (owner_portal_users, not
// agency_members) — mounted after requireAuth so we still know who the
// Supabase session belongs to, but before any agency-staff-only assumptions.
app.use("/api/owner-portal", ownerPortalRouter);

// Centralized error handler — never leak stack traces to the client.
// Report to Sentry first (no-ops if SENTRY_DSN isn't set), then respond.
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  Sentry.captureException(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Likara API listening on port ${PORT} (Asia/Hong_Kong)`);
});
