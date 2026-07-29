export const MAX_IMPORT_IMAGE_BYTES = 2_500_000;
export const SUPPORTED_IMPORT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImportImageMimeType = (typeof SUPPORTED_IMPORT_IMAGE_TYPES)[number];

export class ImageValidationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ImageValidationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function hasMagicBytes(bytes: Uint8Array, mimeType: ImportImageMimeType) {
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

export function validateImportImage(imageBase64: string, mimeType: ImportImageMimeType) {
  if (!imageBase64 || imageBase64.startsWith("data:") || imageBase64.length % 4 !== 0) {
    throw new ImageValidationError(422, "IMAGE_BASE64_INVALID", "The image data is invalid.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new ImageValidationError(422, "IMAGE_BASE64_INVALID", "The image data is invalid.");
  }

  const decoded = Buffer.from(imageBase64, "base64");
  if (decoded.byteLength > MAX_IMPORT_IMAGE_BYTES) {
    throw new ImageValidationError(413, "IMAGE_TOO_LARGE", "Image must be 2.5 MB or smaller.");
  }
  if (!hasMagicBytes(decoded, mimeType)) {
    throw new ImageValidationError(
      422,
      "IMAGE_TYPE_MISMATCH",
      "The image content does not match its file type.",
    );
  }

  return decoded.toString("base64");
}
