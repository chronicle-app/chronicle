/**
 * A photo, video, or GIF on a tweet or a direct message, as a record carries
 * it, the same from the archive and the API.
 */
export interface TweetMedia {
  /** X's id for the media, the same in the archive and the API; none on a DM's. */
  id?: string;
  type: 'photo' | 'video' | 'animated_gif';
  /** Where X serves it: a photo's file, or a video's best MP4. */
  url?: string;
  /** The archive's copy of the file, on disk. */
  path?: string;
  width?: number;
  height?: number;
  /** The alt text its poster wrote. */
  altText?: string;
}

/** A video's best MP4, from the archive's `bitrate` or the API's `bit_rate`. */
export function bestVideo(
  variants: { bitrate?: number | string; bit_rate?: number; content_type: string; url: string }[]
): string | undefined {
  const rate = (variant: (typeof variants)[number]) =>
    Number(variant.bit_rate ?? variant.bitrate ?? 0);
  return variants
    .filter(variant => variant.content_type === 'video/mp4')
    .sort((a, b) => rate(b) - rate(a))[0]?.url;
}

/** A URL's file name, without its query: what the archive names its copy after. */
export function fileName(url: string): string {
  return new URL(url).pathname.split('/').pop() ?? '';
}

const IMAGE_TYPES: { [extension: string]: string } = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The media's MIME type: a photo's from its file name, a video or GIF's MP4. */
export function mimeTypeOf(media: TweetMedia): string | undefined {
  if (media.type !== 'photo') return 'video/mp4';
  const name = media.path ?? (media.url && fileName(media.url)) ?? '';
  return IMAGE_TYPES[name.split('.').pop()?.toLowerCase() ?? ''];
}
