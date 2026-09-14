import type { MediaItem } from '@/components/MediaPicker';

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
    const fileResp = await fetch(item.uri);
    if (!fileResp.ok) throw new Error('Could not read the selected file');
    const blob = await fileResp.blob();

    const contentType =
      item.mimeType || blob.type || (item.type === 'video' ? 'video/mp4' : 'image/jpeg');
    const ext = item.type === 'video' ? 'mp4' : 'jpg';
    const name = item.fileName || `upload-${Date.now()}.${ext}`;
    const size = blob.size || item.fileSize || 0;

    const { uploadURL, objectPath, reference } = await requestUploadUrl({ name, size, contentType });

    const put = await fetch(uploadURL, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': contentType },
    });
    if (!put.ok) throw new Error('Upload failed — please check your connection and try again');

    out.push({ url: reference || `/api/storage${objectPath}`, type: item.type });
    done += 1;
    onProgress?.(done, items.length);
  }
  return out;
}
