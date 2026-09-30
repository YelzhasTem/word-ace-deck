export function requireLocalDeletionFixture(url: string | undefined): string {
  if (!url) throw new Error("Local account-deletion test configuration is missing");
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Account deletion fixtures refuse non-local Supabase");
  return url;
}
