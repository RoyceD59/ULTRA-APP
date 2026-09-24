import type { MediaItem } from '@/components/MediaPicker';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

export interface UploadedMedia {
  /** Relative serving path ("/api/storage/objects/…") or private reference ID. Store this. */
  url: string;
  type: 'photo' | 'video';
}

interface UploadUrlRequester {
  (meta: { name: string; size: number; contentType: string }): Promise<{
    uploadURL: string;
    objectPath: string;
    /** Absolute reference object for private media when requested instead of url */
    reference?: string;
  }>;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

/**
 * Uploads locally-picked media to object storage via presigned URLs.
 * Two-step flow: ask the API for a presigned PUT URL (auth required),
 * then send the bytes straight to storage — never through our server.
 * Throws on the first failure so callers can surface an explicit error.
 */
export async function uploadMediaItems(
  items: MediaItem[],
  requestUploadUrl: UploadUrlRequester,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadedMedia[]> {
  const out: UploadedMedia[] = [];
  let done = 0;
  onProgress?.(0, items.length);
  for (const item of items) {
    if (item.storedUrl) {
      out.push({ url: item.storedUrl, type: item.type });
      done += 1;
      onProgress?.(done, items.length);
      continue;
    }

    let body: Blob | Uint8Array<ArrayBuffer> | undefined;
    let nativeFile: File | undefined;
    let detectedSize = 0;
    let detectedType = '';
    let detectedName = '';

    if (Platform.OS === 'web') {
      const fileResp = await fetch(item.uri);
      if (!fileResp.ok) throw new Error('Could not read the selected file');
      const blob = await fileResp.blob();
      body = blob;
      detectedSize = blob.size;
      detectedType = blob.type;
    } else {
      const file = new File(item.uri);
      if (!file.exists) throw new Error('The selected file is no longer available');
      nativeFile = file;
      detectedSize = file.size;
      detectedType = file.type;
      detectedName = file.name;
    }

    const contentType =
      item.mimeType || detectedType || (item.type === 'video' ? 'video/mp4' : 'image/jpeg');
    const mimeExtension = contentType === 'video/quicktime'
      ? 'mov'
      : contentType === 'video/3gpp'
        ? '3gp'
        : contentType === 'video/webm'
          ? 'webm'
          : item.type === 'video'
            ? 'mp4'
            : contentType === 'image/png'
              ? 'png'
              : contentType === 'image/webp'
                ? 'webp'
                : contentType === 'image/heic' || contentType === 'image/heif'
                  ? 'heic'
                  : 'jpg';
    const name = item.fileName || detectedName || `upload-${Date.now()}.${mimeExtension}`;
    const size = detectedSize || item.fileSize || 0;
    const maxBytes = item.type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (size <= 0 || size > maxBytes) {
      throw new Error(
        `${item.type === 'video' ? 'Videos' : 'Photos'} must be under ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    }

    const { uploadURL, objectPath, reference } = await requestUploadUrl({ name, size, contentType });
    if (nativeFile) body = await nativeFile.bytes();

    const put = Platform.OS === 'web'
      ? await fetch(uploadURL, {
          method: 'PUT',
          body: body as Blob,
          headers: { 'Content-Type': contentType },
        })
      : await expoFetch(uploadURL, {
          method: 'PUT',
          body: body as Uint8Array<ArrayBuffer>,
          headers: { 'Content-Type': contentType },
        });
    if (!put.ok) throw new Error('Upload failed — please check your connection and try again');

    out.push({ url: reference || `/api/storage${objectPath}`, type: item.type });
    done += 1;
    onProgress?.(done, items.length);
  }
  return out;
}
