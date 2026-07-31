/**
 * Client-side image compression using Canvas API.
 * Resizes and compresses images before uploading to R2.
 * No external dependencies — pure browser APIs.
 */

/**
 * Compress an image file to a smaller JPEG/WebP blob.
 * @param file - Original image file selected by the user
 * @param maxSize - Maximum width or height in pixels (default: 400)
 * @param quality - Compression quality 0–1 (default: 0.8)
 * @returns Compressed Blob ready for upload
 */
export async function compressImage(
  file: File,
  maxSize = 400,
  quality = 0.8,
): Promise<Blob> {
  // SVG files don't need compression
  if (file.type === 'image/svg+xml') {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }

      // Draw onto canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP first, fallback to JPEG
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            // Fallback to JPEG if WebP fails
            canvas.toBlob(
              (jpegBlob) => {
                if (jpegBlob) resolve(jpegBlob);
                else reject(new Error('Image compression failed'));
              },
              'image/jpeg',
              quality,
            );
          }
        },
        'image/webp',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}


function toWebpName(name: string): string {
  const trimmed = name.trim() || 'receipt';
  return `${trimmed.replace(/\.[^.]+$/, '')}.webp`;
}

/**
 * Compress an image and wrap it as a WebP File for browser receipt uploads.
 * The caller can append the returned File directly to FormData.
 */
const RECEIPT_TARGET_BYTES = 1.5 * 1024 * 1024;

export async function compressImageToWebpFile(
  file: File,
  maxSize = 1800,
  quality = 0.78,
  targetBytes = RECEIPT_TARGET_BYTES,
): Promise<File> {
  const qualities = [quality, 0.72, 0.66, 0.60];
  let best: Blob | null = null;
  for (const q of qualities) {
    const compressed = await compressImage(file, maxSize, q);
    if (!best || compressed.size < best.size) best = compressed;
    if (compressed.size <= targetBytes) {
      return new File([compressed], toWebpName(file.name), { type: 'image/webp', lastModified: Date.now() });
    }
  }
  const finalBlob = best ?? await compressImage(file, maxSize, quality);
  return new File([finalBlob], toWebpName(file.name), { type: 'image/webp', lastModified: Date.now() });
}
