/**
 * Helpers for building Chronicle JSON-LD media objects (ImageObject,
 * AudioObject, VideoObject, DocumentObject) from plugin transformers. The
 * resulting objects carry `url`, `contentData` (data URI), or `contentPath`;
 * the persistence layer captures the bytes into the blob store at ingest.
 */

export interface MediaObjectOptions {
  url?: string;
  base64?: string;
  /** Absolute local file path; emitted as contentPath and captured at ingest. */
  path?: string;
  mimeType?: string;
  description?: string;
  [key: string]: any;
}

export interface ImageObjectOptions extends MediaObjectOptions {
  width?: number;
  height?: number;
}

export interface AudioObjectOptions extends MediaObjectOptions {
  duration?: number;
  artist?: string;
  album?: string;
  genre?: string;
}

export interface VideoObjectOptions extends MediaObjectOptions {
  duration?: number;
  width?: number;
  height?: number;
  videoFrameRate?: number;
  videoQuality?: string;
}

export interface DocumentObjectOptions extends MediaObjectOptions {
  pageCount?: number;
}

function buildMediaObject(type: string, options: MediaObjectOptions): Record<string, any> {
  const { url, base64, path, mimeType, ...otherProps } = options;

  return {
    '@type': type,
    '@key': ['url'],
    // Include URL if provided
    ...(url && { url }),
    // Include base64 data with proper data URI format
    ...(base64 && {
      contentData: base64.startsWith('data:')
        ? base64
        : `data:${mimeType || 'application/octet-stream'};base64,${base64}`,
    }),
    // Local file path; bytes are captured into the attachment store at ingest
    ...(path && { contentPath: path }),
    // Include MIME type for processing hints
    ...(mimeType && { mimeType }),
    // Spread all other properties
    ...otherProps,
  };
}

export function createImageObject(options: ImageObjectOptions): any {
  return buildMediaObject('ImageObject', options);
}

export function createAudioObject(options: AudioObjectOptions): any {
  return buildMediaObject('AudioObject', options);
}

export function createVideoObject(options: VideoObjectOptions): any {
  return buildMediaObject('VideoObject', options);
}

export function createDocumentObject(options: DocumentObjectOptions): any {
  return buildMediaObject('DocumentObject', options);
}

/**
 * Generic media object creator that determines type based on MIME type
 */
export function createMediaObject(options: ImageObjectOptions & { type?: string }): any {
  const { type, mimeType } = options;

  // Use explicit type if provided
  if (type) {
    switch (type) {
      case 'ImageObject':
        return createImageObject(options);
      case 'AudioObject':
        return createAudioObject(options);
      case 'VideoObject':
        return createVideoObject(options);
      case 'DocumentObject':
        return createDocumentObject(options);
      default:
        throw new Error(`Unsupported media object type: ${type}`);
    }
  }

  // Infer type from MIME type
  if (mimeType) {
    if (mimeType.startsWith('image/')) {
      return createImageObject(options);
    }
    if (mimeType.startsWith('audio/')) {
      return createAudioObject(options);
    }
    if (mimeType.startsWith('video/')) {
      return createVideoObject(options);
    }
    if (mimeType === 'application/pdf' || mimeType.includes('document')) {
      return createDocumentObject(options);
    }
  }

  // Default to DocumentObject for unknown types
  return createDocumentObject(options);
}
