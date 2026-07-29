export type AuthClaims = Record<string, unknown> & {
  sub?: string;
  role?: string;
};

export class AuthTokenError extends Error {
  readonly code: "AUTH_REQUIRED" | "AUTH_INVALID";

  constructor(code: "AUTH_REQUIRED" | "AUTH_INVALID", message: string) {
    super(message);
    this.name = "AuthTokenError";
    this.code = code;
  }
}

export async function verifySupabaseAuthorization(
  authHeader: string | null,
  verifyToken: (
    token: string,
  ) => Promise<{ data: { claims?: AuthClaims | null } | null; error: unknown }>,
) {
  if (!authHeader) {
    throw new AuthTokenError("AUTH_REQUIRED", "Please sign in to continue.");
  }
  if (!/^Bearer [^\s]+$/.test(authHeader)) {
    throw new AuthTokenError("AUTH_INVALID", "Your session is invalid. Please sign in again.");
  }

  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await verifyToken(token);
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string" || !claims.sub || claims.role === "anon") {
    throw new AuthTokenError("AUTH_INVALID", "Your session has expired. Please sign in again.");
  }

  return { token, claims, userId: claims.sub };
}
