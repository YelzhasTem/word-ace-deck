# Vercel deploy

Use these Vercel Project Settings:

- Root Directory: `.`
- Framework Preset: Other
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: leave empty

Set these environment variables in Vercel Project Settings for Production,
Preview, and Development:

```text
SUPABASE_URL=<base Supabase project URL, no /rest/v1>
SUPABASE_PUBLISHABLE_KEY=<Supabase anon/public key>
VITE_SUPABASE_PROJECT_ID=<Supabase project ref>
VITE_SUPABASE_URL=<same base Supabase project URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<same Supabase anon/public key>
GEMINI_API_KEY=<Google Gemini API key>
GEMINI_MODEL=gemini-2.5-flash-lite
SUPABASE_SERVICE_ROLE_KEY=<Supabase service-role key, server-only>
AI_IP_HASH_SALT=<at least 32 random characters, server-only>
```

`NITRO_PRESET=vercel` is set in `vercel.json`.

`GEMINI_MODEL` is optional; the app defaults to `gemini-2.5-flash-lite` when it
is not set.

`SUPABASE_SERVICE_ROLE_KEY` is required. The AI endpoints use it to reserve and
record AI quota (`src/lib/ai-security.server.ts`), and account deletion uses it
to remove the auth user (`src/lib/account.functions.ts`). Without it every AI
request fails with `AI_SECURITY_UNAVAILABLE` and account deletion fails. Keep it
server-only and never prefix it with `VITE_`. Deck and collection reads and
writes still use the anon key plus the user's token.

`AI_IP_HASH_SALT` is required on Vercel. It must be at least 32 random
characters (for example `openssl rand -hex 32`) and is used to hash client IPs
for AI rate limits. Keep it server-only.

The Supabase project ref is the part of `https://PROJECT_REF.supabase.co` before
`.supabase.co`. Apply SQL files from `supabase/migrations` to that same project,
in timestamp order, before deploying.
