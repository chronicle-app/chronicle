import {
  Scope,
  provenanceOf,
  type Asset,
  type PhotosLibrary,
  type Provenance,
} from '../library.js';
import ApplePhotosExtractor, { type Found } from './ApplePhotosExtractor.js';

/**
 * How a photo or video came to be in your library:
 *
 * - `camera`: you took it with a camera, as its file says
 * - `screenshot`, `screenRecording`: you captured your screen
 * - `faceTime`: a Live Photo you took during a FaceTime call
 * - `saved`: an app added it, such as a photo saved from a chat
 */
export type Origin = 'camera' | 'screenshot' | 'screenRecording' | 'faceTime' | 'saved';

/** A photo or video in your library, with how it came to be there. */
export interface Photo extends Asset {
  origin: Origin;
}

// Photos' kinds of photo and video (`ZKINDSUBTYPE`).
const SCREENSHOT = 10;
const SCREEN_RECORDING = 103;

// The apps that add what the camera took. A photo with no app took the
// camera's path into the library too.
const CAMERA_APPS = new Set(['com.apple.camera', 'com.apple.camera.CameraMessagesApp']);
// What adds a Live Photo taken during a FaceTime call.
const FACETIME_APPS = new Set(['com.apple.FTLivePhotoService', 'com.apple.TelephonyUtilities']);

/**
 * How an asset came to be in the library. Screenshots and screen recordings
 * come first, since many have no app. A camera photo needs both a camera's
 * app, or none, and the camera's make in its file: an app's save of a photo,
 * even one you took, such as a post saved from Instagram, is a save.
 */
export function originOf(asset: Provenance): Origin {
  if (asset.subtype === SCREENSHOT) return 'screenshot';
  if (asset.subtype === SCREEN_RECORDING) return 'screenRecording';
  if (asset.importer && FACETIME_APPS.has(asset.importer)) return 'faceTime';
  if ((!asset.importer || CAMERA_APPS.has(asset.importer)) && asset.camera?.make) return 'camera';
  return 'saved';
}

/** When an asset happened: what you made when you made it, and a save when it was added. */
function timeOf(asset: Provenance, origin = originOf(asset)): string | null {
  return origin === 'saved' ? (asset.added ?? asset.created) : asset.created;
}

/**
 * Your photos and videos: one record for each in your library, with what you
 * did to make it, who you said is in it, and the albums it's in. Each run
 * reads the library as it is now.
 */
export class ApplePhotosPhotosExtractor extends ApplePhotosExtractor {
  static override description = 'Your photos and videos, with who is in them and their albums';
  static override recordTypes = ['photos'];
  static override default = true;
  static override temporality = 'snapshot' as const;

  protected read(library: PhotosLibrary): Array<Found<Photo>> {
    return library.describe(library.rows(Scope.own)).flatMap(asset => {
      const origin = originOf(asset);
      const time = timeOf(asset, origin);
      return time ? [{ key: asset.id, time, data: { ...asset, origin } }] : [];
    });
  }

  /** When each was made or saved, from its row, without who and what is in it. */
  protected override times(library: PhotosLibrary): string[] {
    return library.rows(Scope.own).flatMap(row => timeOf(provenanceOf(row)) ?? []);
  }
}
