// Vitest setup — runs before any test file is imported. Several service
// modules transitively import lib/supabaseClient.js, which throws eagerly at
// import time if Supabase env vars are missing (correct behavior for the real
// app — fail fast on misconfiguration — but it would otherwise break every
// unit test, including ones that never touch Supabase, like the pure
// detectFileType/clampDueDate/parseAmount tests). These are obviously-fake
// placeholder values, never used to make a real network call in this suite.
process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.CLAUDE_API_KEY ??= "test-claude-key";
