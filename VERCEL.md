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
```

`NITRO_PRESET=vercel` is set in `vercel.json`.

`GEMINI_MODEL` is optional; the app defaults to `gemini-2.5-flash-lite` when it
is not set.

`SUPABASE_SERVICE_ROLE_KEY` is not required by the current app code. Only add it
later if a server-only admin operation imports the Supabase admin client and must
bypass RLS. Keep it server-only and never prefix it with `VITE_`.

The Supabase project ref is the part of `https://PROJECT_REF.supabase.co` before
`.supabase.co`. Apply SQL files from `supabase/migrations` to that same project,
in timestamp order, before deploying.
