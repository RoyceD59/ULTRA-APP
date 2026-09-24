# Native Review Media Upload Reliability

## Scope

Fix the confirmed Expo Go failure where both review photos and videos upload to object storage but review submission rejects them as the wrong media type. Preserve the existing server-side security boundary and complete the physical-device review-media verification before publishing.

This design does not disable validation, transcode media, or broaden the accepted format list beyond formats already allowed by the upload API.

## Confirmed Failure

The Companion app currently uploads a native `expo-file-system` `File` through `expo/fetch` with an explicit `Content-Type` header. On physical devices, object storage records the resulting object as `application/octet-stream`. Review submission then checks the stored object metadata and correctly rejects it because the metadata does not begin with `image/` or `video/`.

The failure affects both camera and library media and therefore belongs to the shared native upload path rather than either picker.

## Design

### Native upload

For iOS and Android, read the selected `File` as bytes and upload those bytes with the MIME type detected by the picker or file metadata. This prevents the native `File` request body from replacing the explicit MIME header.

The web upload path remains unchanged.

The client continues to preserve:

- Original picker MIME type when available
- Original filename and size
- QuickTime (`.mov`), 3GPP (`.3gp`), WebM, MP4, JPEG, PNG, WebP, and HEIC/HEIF extensions
- Existing stored references when reopening and resubmitting an edited review

### Server verification fallback

Object-storage metadata remains the primary verification source.

When metadata is the generic `application/octet-stream`, the API will:

1. Load the upload declaration stored when the presigned URL was issued.
2. Read only the leading bytes required to identify the container or image format.
3. Detect an allowlisted image or video signature.
4. Require the detected family to match both the declared MIME family and the review attachment type.
5. Retain the existing object-size limits.

Unknown signatures, mismatched declarations, HTML/SVG/executable content, missing uploads, and oversized objects remain rejected. Filenames and extensions alone are never sufficient evidence.

### Review persistence and reopening

The existing saved-media behavior remains:

- A successful review stores object references in the review row.
- Public review responses return those references to every account.
- Editing a saved review restores its media into the picker.
- Restored media bypasses re-upload unless the user replaces it.
- Saved video URLs are resolved against the API base and remain playable after reopening.

## Error handling

- File read failure remains an explicit client error.
- PUT failure remains an explicit connection/upload error.
- Signature mismatch returns a media-specific validation error.
- Missing upload returns the existing re-attach message.
- Unexpected storage failures remain fail-closed and are logged server-side.

## Verification

Automated checks:

- Unit tests for native upload body/header behavior without reading a real device file
- Unit tests for accepted and rejected image/video signatures
- Existing Companion tests and TypeScript checks
- Existing API tests and TypeScript checks

Required physical-device acceptance:

1. On iOS or Android, attach one photo and one supported short video.
2. Submit the review and confirm both attachments display.
3. Close and reopen the saved review.
4. Confirm both attachments still appear.
5. Play the saved video successfully.
6. Record device and OS details for any remaining failure.

Physical-device result (September 24, 2026): The user confirmed a pass on an iPhone 17 Pro Max. A photo and supported video were attached and submitted; both appeared in the saved review, remained after reopening it, and the saved video played. The iOS version was not provided. No device-specific failure was reported.

Publishing remained blocked until this physical-device acceptance flow passed.