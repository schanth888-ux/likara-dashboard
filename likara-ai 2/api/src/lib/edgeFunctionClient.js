// Calls a deployed Supabase Edge Function, forwarding the caller's own JWT so
// the function's own RLS-scoped Supabase client sees the correct user/agency.
export async function callEdgeFunction(functionName, accessToken, body) {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error("SUPABASE_URL is not configured");

  const res = await fetch(`${base}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Edge function ${functionName} returned ${res.status}`);
  }
  return data;
}
