## Why loading is slow

After reading `src/lib/decks.ts`, `src/lib/decks.functions.ts`, `src/components/SiteHeader.tsx`, `src/routes/index.tsx` and `src/integrations/supabase/auth-middleware.ts`, the main bottlenecks are:

1. **Double fetch of decks on every mount.** `useDecks()` calls `reload()` once on mount, and immediately again from `supabase.auth.onAuthStateChange` (which fires synchronously with the initial `INITIAL_SESSION` event). Two full server-function round-trips before the page renders content.
2. **No caching / no shared state.** Every component that uses `useDecks()` (and every navigation back to `/`) re-runs the full fetch. TanStack Query is installed and wired into the router context but not used here — we hand-roll `useState` + `useEffect` instead.
3. **Two sequential Supabase queries per load.** `getMyDecks` does `select decks` then `select cards` serially. They could run in parallel with `Promise.all`.
4. **Every server-function call re-validates the token over the network.** `requireSupabaseAuth` calls `supabase.auth.getClaims(token)` on each request, which hits Supabase Auth. For short-lived pages with several serverFn calls this dominates latency. Decoding the JWT locally (jose `decodeJwt` + `exp` check) removes that round-trip.
5. **SSR waits but renders nothing useful.** `/` is a public route, so SSR can't prefetch user decks. The Worker still does a full SSR pass before the client takes over. We can mark the homepage as a client-only shell (or at minimum stop blocking on it) so the user sees the hero immediately.
6. **Header re-subscribes to auth, indirectly triggering more deck reloads** (via the auth listener in `useDecks`). One shared auth store would fix this; at minimum, the deck reload on auth change should be debounced and skipped for `INITIAL_SESSION`.

## Fix

### Code changes
- `src/lib/decks.functions.ts` — run the `decks` and `cards` selects with `Promise.all`.
- `src/lib/decks.ts` — replace the `useState`/`useEffect`/manual `reload` machinery with a TanStack Query `useQuery({ queryKey: ['my-decks'], queryFn: getMyDecks, staleTime: 30_000 })`. Mutations (`createDeck`, `addCard`, `markCard`, etc.) become `useMutation` calls that invalidate `['my-decks']` instead of dispatching a window event. This eliminates the double fetch and gives instant cache hits on navigation.
- Auth listener: subscribe once at the app level (or inside the query hook) and only `queryClient.invalidateQueries(['my-decks'])` on `SIGNED_IN` / `SIGNED_OUT` — ignore `INITIAL_SESSION`.
- `src/integrations/supabase/auth-middleware.ts` is auto-generated, so we won't edit it. Instead, batch related work into one server function where possible (already mostly fine) so we don't pay the `getClaims` cost N times per page.
- `src/components/SiteHeader.tsx` — read the session from the same shared source (a tiny `useSession` hook backed by TanStack Query) instead of its own `useState` + subscription, so the header doesn't trigger a separate auth round-trip.

### Verification
- Reload `/` and confirm in the network panel: exactly **one** `getMyDecks` request, not two.
- Navigate `/` → `/deck/:id` → back to `/` and confirm the second visit serves decks from cache (no new request within `staleTime`).
- Measure: TTFB on `/` should drop noticeably, and the decks list should appear in a single paint after auth resolves.

### Out of scope
- Visual/design changes.
- Behavior of Delayed Recall mode.
- Auth flow itself (login/signup).
