import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const IMAGE_URL_PATTERN = /\.(png|jpe?g|webp|gif)(\?|#|$)/i;

export function extensionForMediaType(mediaType) {
  const ext = EXTENSIONS[String(mediaType).toLowerCase().split(';')[0].trim()];
  if (!ext) throw new Error(`Unsupported image type: ${mediaType}`);
  return ext;
}

export function looksLikeImageUrl(url) {
  return IMAGE_URL_PATTERN.test(url);
}

export function saveImageBuffer(buffer, { outDir, id, mediaType }) {
  const path = join(outDir, `${id}${extensionForMediaType(mediaType)}`);
  writeFileSync(path, buffer);
  return path;
}

export async function saveImageFromUrl(url, { outDir, id, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { redirect: 'follow' });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'That image URL returned 403. Pinterest blocks direct image links — ' +
          'drag the image in instead.'
      );
    }
    throw new Error(`That image URL returned ${response.status}.`);
  }

  const mediaType = response.headers.get('content-type') || '';
  if (!mediaType.startsWith('image/')) {
    throw new Error(
      `That URL did not return an image (got "${mediaType || 'no content-type'}").`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return saveImageBuffer(buffer, { outDir, id, mediaType });
}
