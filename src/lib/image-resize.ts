// Photos from an iPhone camera are often larger than the upload limits (a 12 MP JPEG is
// 2-5 MB). Instead of rejecting them, oversized images are redrawn smaller in the browser and
// re-encoded as JPEG until they fit.

const SCALE_STEPS = [1, 0.8, 0.64, 0.5];
const JPEG_QUALITY = 0.85;

function loadImage(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image."));
    };
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/**
 * Returns the file unchanged when it is at most maxBytes. Otherwise returns a JPEG copy whose
 * longest side is at most maxDimension pixels and whose size is at most maxBytes, or null when
 * the image cannot be read or made small enough.
 */
export async function shrinkImageToFit(
  file: File,
  maxBytes: number,
  maxDimension = 2048,
): Promise<File | null> {
  if (file.size <= maxBytes) return file;

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    return null;
  }
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longestSide) return null;

  for (const step of SCALE_STEPS) {
    const scale = Math.min(1, (maxDimension * step) / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    // JPEG has no transparency: paint transparent areas white instead of black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpeg(canvas);
    if (blob && blob.size <= maxBytes) {
      const name = `${file.name.replace(/\.[^.]*$/, "") || "image"}.jpg`;
      return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
    }
  }
  return null;
}
