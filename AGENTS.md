# Project Deployment Rules

## Vercel

- This is a TanStack Start/Nitro app. Vercel must build Nitro's Vercel output, not a plain `dist/` static site.
- Use project root `.` as the Vercel Root Directory.
- Use npm for Vercel installs because `package-lock.json` is the committed npm lockfile. Do not let Vercel choose Bun just because `bun.lock` exists.
- Vercel settings:
  - Framework Preset: Other
  - Install Command: `npm install`
  - Build Command: `npm run build`
  - Output Directory: leave empty
- Keep `NITRO_PRESET=vercel` available during Vercel builds.

## Environment Safety

- Never commit real `.env`, `.env.local`, or `.env.*` files.
- Keep `.env.example` committed with variable names only and placeholder/blank values.
- Local Vercel handoff files must be named `VERCEL_ENV_IMPORT.local.env` and `VERCEL_ENV_VALUES.local.md`; both must stay ignored by git.
- Do not print secrets in chat, docs, commits, logs, screenshots, or PR descriptions.
- Public browser variables use `VITE_*` and are visible to users. Never put private secrets in a `VITE_*` variable.

## Supabase

- `SUPABASE_URL` is the base project URL, for example `https://PROJECT_REF.supabase.co`; do not include `/rest/v1`.
- `SUPABASE_PUBLISHABLE_KEY` is the anon/public key for server-side user-authenticated Supabase clients.
- `VITE_SUPABASE_URL` is the same base project URL exposed to the browser.
- `VITE_SUPABASE_PUBLISHABLE_KEY` is the same anon/public key exposed to the browser.
- `VITE_SUPABASE_PROJECT_ID` is the Supabase project ref, the part before `.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` is a secret backend-only admin key. Never expose it as `VITE_*`.
- Do not require the service-role key unless code performs trusted backend admin work that must bypass RLS. Normal user-authenticated deck and collection reads/writes should use the anon/public key plus the user's Bearer token.
- Keep `supabase/config.toml` aligned with the target Supabase project ref before running migrations.

## Database Migrations

- Migrations are SQL files that create or update database tables, policies, and seed data.
- The Supabase project ref is the part of `https://PROJECT_REF.supabase.co` before `.supabase.co`.
- If runtime errors say a table was not found in the schema cache, apply the SQL migrations to the target Supabase project.
- Prefer `supabase link --project-ref PROJECT_REF` followed by `supabase db push` when the Supabase CLI is available and authenticated.
- If CLI login or database password is unavailable, open Supabase Dashboard -> SQL Editor and run the migration SQL files in timestamp order.

## AI Keys and Models

- This project uses `GEMINI_API_KEY` for direct Gemini API calls. Treat it as a secret backend/server-only key.
- Never expose Gemini keys as `VITE_*`.
- For student projects, default Gemini model selection to `gemini-2.5-flash-lite` unless the user explicitly asks for another model.

## Before Deploy

- Confirm `git remote -v`, current branch, and local folder path.
- Confirm there are no duplicate local clones being edited by mistake.
- Confirm `.env` is ignored and not tracked.
- Confirm `.env.example` is committed and contains no real secrets.
- Confirm Vercel has all required Production, Preview, and Development environment variables.
- Confirm Supabase migrations have been applied to the same project ref used by Vercel env vars.
- Run `npm run build` and verify it creates `.vercel/output`.
