import { setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

export type ServerHttpErrorMetadata = { statusCode: number; code: string };

const errorMetadata = new WeakMap<Error, ServerHttpErrorMetadata>();

export function httpError(
  statusCode: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): never {
  setResponseStatus(statusCode);
  setResponseHeader("Cache-Control", "no-store");
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    setResponseHeader("Retry-After", String(Math.ceil(retryAfterSeconds)));
  }
  // TanStack's shallow Error serializer preserves only `message`, so include a
  // non-sensitive status marker that the browser helper can reliably classify.
  const error = new Error(`HTTP ${statusCode}: ${message}`);
  errorMetadata.set(error, { statusCode, code });
  throw error;
}

export function getServerHttpErrorMetadata(error: unknown) {
  return error instanceof Error ? errorMetadata.get(error) : undefined;
}

export function isServerHttpError(error: unknown): error is Error {
  return Boolean(getServerHttpErrorMetadata(error));
}
