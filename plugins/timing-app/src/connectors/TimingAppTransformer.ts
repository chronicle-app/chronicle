import { ChronicleTransformer, Record, SystemInfo } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  DirectoryAndChildren,
  EntityAndChildren,
  ExecuteAction,
  ExperienceAction,
  Project,
  Realm,
  Session,
  SoftwareApplication,
  Device,
  DeviceSession,
} from '@chronicle.app/schema';
import type { TimingDevice, TimingProject } from './TimingDbExtractor.js';
import path from 'node:path';

const SOURCE = 'timing-app';

export default class TimingAppTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  private meAgent?: Agent;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'app-activities':
        return [this.buildAppActivity(record)];
      case 'time-entries':
        return [this.buildTimeEntry(record)];
      default:
        return [];
    }
  }

  /**
   * The account owner, tagged `@me`. Timing has no account of its own (and it is
   * not an iCloud identity), so we don't assume a name — the node is just the
   * `@me` tag sourced to Timing, keyed on `['@type','source']`. The `@me` token
   * merges it with the subject's named identities from other sources.
   */
  private me(): Agent {
    if (!this.meAgent) {
      this.meAgent = {
        '@type': 'Agent',
        '@key': ['@type', 'source'],
        source: SOURCE,
        sameAs: ['@me'],
      } as Agent;
    }
    return this.meAgent;
  }

  // --- Projects -------------------------------------------------------------

  /**
   * A Project node with its ancestry nested via isPartOf. `chain` is leaf-first
   * ([self, parent, ...]); returns the leaf node, or null when unattributed.
   *
   * Each node asserts `isPartOf` as the complete parent set as of this read, so
   * a project reparented (or promoted to root) in Timing closes its old parent
   * edge instead of accumulating both.
   */
  private buildProjectChain(chain: TimingProject[]): Project | null {
    let child: Project | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const node: Project = {
        '@type': 'Project',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId: chain[i].id,
        name: chain[i].title,
        '@asserts': ['isPartOf'],
      };
      if (child) node.isPartOf = [child];
      child = node;
    }
    return child;
  }

  // --- App activity ---------------------------------------------------------

  private buildAppActivity(record: Record): ActionAndChildren {
    const ctx = record.context as {
      id: string;
      startDate: number;
      endDate: number;
      app: {
        bundleIdentifier: string | null;
        executable: string | null;
        title: string | null;
      };
      device: TimingDevice | null;
      projectChain: TimingProject[];
      windowTitle: string | null;
      pathString: string | null;
    };

    const session: DeviceSession = {
      '@type': 'DeviceSession',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.id,
    };

    const project = this.buildProjectChain(ctx.projectChain);
    if (project) session.isPartOf = [project];

    // The logical machine (a name-keyed :Realm) scopes file paths and unifies
    // with the same host seen from other sources; the physical device (keyed on
    // its hardware, distinct per machine) is the instrument and links to the
    // realm via inRealm.
    const realm = this.buildRealm(ctx.device);
    const device = this.buildDevice(ctx.device, realm);

    const resource = this.buildResource(ctx.pathString, realm);
    if (resource?.['@type'] === 'Directory') {
      // A directory is where the activity happened (a terminal's CWD, a Finder
      // folder) — the session's location, not the resource in focus.
      session.workingDirectory = resource as DirectoryAndChildren;
    } else if (resource) {
      session.subject = [resource];
    }

    // The window title describes the session (what this window showed during the
    // block), not the resource — a subject folds across every session that
    // touches it, so it keeps its own stable name (the path basename) while the
    // title, which changes block to block ("sleep 4", a path abbreviation, a page
    // title), names the session. Skip it when it only repeats the subject's name
    // (an editor titling itself with the file it already points at).
    const title = ctx.windowTitle ? stripWindowTitle(ctx.windowTitle, ctx.app.title) : null;
    if (title && title !== (resource as { name?: string } | null)?.name) {
      session.name = title;
    }

    const action: ExecuteAction & ActionAndChildren = {
      '@type': 'ExecuteAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.id,
      startTime: secondsToISO(ctx.startDate),
      endTime: secondsToISO(ctx.endDate),
      agent: this.me(),
      result: session,
    } as any;

    const app = this.buildApplication(ctx.app);
    if (app) action.object = app;

    if (device) action.instrument = device;

    return action;
  }

  /** The on-screen resource: a URL-keyed web page, or a realm-scoped filesystem entry. */
  private buildResource(pathString: string | null, realm: Realm | null): EntityAndChildren | null {
    if (!pathString) return null;

    // A web page: globally unique, content-addressed by URL. Its title is the
    // session's (set by the caller) — here the URL is the whole identity.
    if (/^https?:\/\//i.test(pathString)) {
      return {
        '@type': 'Entity',
        '@key': ['url'],
        url: pathString,
      } as EntityAndChildren;
    }

    // A filesystem entry. Timing stores these as file:// URIs (or, rarely, bare
    // paths). A path is not globally unique, so scope it by the machine whose
    // filesystem it lives on, via `inRealm` — so the same path folds with that
    // machine seen from other sources (e.g. shell) and survives a hardware
    // migration, while paths on different machines stay distinct. `@type` is kept
    // out of the key: a path is one entry, and neither the dir-vs-file signal (a
    // trailing slash) nor a later, more specific media type may fragment identity.
    //
    // A trailing slash is Timing's directory marker (a terminal's CWD, a Finder
    // folder) → a :Directory. Anything else IS the media object living at that
    // path, leaf-typed as far as the extension can tell — a path-only source
    // never sees bytes, so unknown extensions stay a plain :MediaObject and a
    // byte-reader may refine later (specificity wins at fold time). The name is
    // the path's basename either way.
    const filePath = toFilePath(pathString);
    if (filePath && realm) {
      const isDir = filePath.endsWith('/');
      const handle = isDir ? filePath.replace(/\/+$/, '') : filePath;
      if (!handle) return null;
      return {
        '@type': isDir ? 'Directory' : mediaTypeForPath(handle),
        '@key': ['source', 'handle', 'inRealm.handle'],
        source: 'filesystem',
        handle,
        name: path.basename(handle) || handle,
        inRealm: realm,
      } as EntityAndChildren;
    }

    return null;
  }

  /**
   * The logical machine as a name-keyed `:Realm` — a file's `inRealm` scope and
   * the device's `inRealm`. Keyed on the normalized name (Timing's device name →
   * `pat-mbp`), so it folds with the same machine seen by the shell plugin, unifies
   * across sources, and survives the hardware migrating.
   */
  private buildRealm(device: TimingDevice | null): Realm | null {
    if (!device?.name) return null;
    const handle = SystemInfo.normalizeMachineName(device.name);
    if (!handle) return null;
    return {
      '@type': 'Realm',
      '@key': ['@type', 'source', 'handle'],
      source: 'hostname',
      handle,
    };
  }

  /**
   * The physical device — the action's `instrument`. Keyed on Timing's stable
   * device id (with the hardware MAC linked via `sameAs`), so distinct hardware
   * stays distinct: two MAC addresses are two devices, never merged. `inRealm`
   * links it to the logical machine (`realm`) it runs on.
   */
  private buildDevice(device: TimingDevice | null, realm: Realm | null): Device | null {
    if (!device) return null;
    const node: Device = {
      '@type': 'Device',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: device.globalId,
      name: device.name,
    };
    // Kind is open-ended data on :category (not a subclass); make/model on :model.
    const category = deviceCategory(device.model);
    if (category) node.category = [category];
    if (device.model) node.model = device.model;
    if (device.mac) {
      node.sameAs = [
        {
          '@type': 'Device',
          '@key': ['@type', 'source', 'handle'],
          source: 'mac-address',
          handle: device.mac,
        } as any,
      ];
    }
    if (realm) node.inRealm = realm;
    return node;
  }

  private buildApplication(app: {
    bundleIdentifier: string | null;
    executable: string | null;
    title: string | null;
  }): SoftwareApplication | null {
    if (app.bundleIdentifier) {
      return {
        '@type': 'SoftwareApplication',
        '@key': ['@type', 'source', 'handle'],
        source: 'apple-bundle-id',
        handle: app.bundleIdentifier,
        ...(app.title ? { name: app.title } : {}),
      };
    }
    const handle = app.executable || app.title;
    if (!handle) return null; // degenerate app row (no bundle/executable/title) — can't key
    return {
      '@type': 'SoftwareApplication',
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle,
      ...(app.title ? { name: app.title } : {}),
    };
  }

  // --- Time entries ---------------------------------------------------------

  /**
   * A manually-logged time entry. It's real lived activity (not a plan), so it's
   * an `ExperienceAction` carrying the real occurrence, with the produced `Session`
   * as its `result` — symmetric with app usage (`ExecuteAction` → `DeviceSession`).
   */
  private buildTimeEntry(record: Record): ActionAndChildren {
    const ctx = record.context as {
      id: string;
      startDate: number;
      endDate: number;
      title: string | null;
      notes: string | null;
      projectChain: TimingProject[];
    };

    const session: Session = {
      '@type': 'Session',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.id,
    };

    if (ctx.title) session.name = ctx.title;
    if (ctx.notes) session.description = ctx.notes;
    const project = this.buildProjectChain(ctx.projectChain);
    if (project) session.isPartOf = [project];

    const action: ExperienceAction & ActionAndChildren = {
      '@type': 'ExperienceAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.id,
      startTime: secondsToISO(ctx.startDate),
      endTime: secondsToISO(ctx.endDate),
      agent: this.me(),
      result: session,
    } as any;

    return action;
  }
}

function secondsToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** The device kind (open-ended :category data), inferred from Timing's model code. */
function deviceCategory(model: string | null): string | null {
  if (!model) return null;
  if (/^Mac/i.test(model)) return 'computer';
  if (/^iPhone/i.test(model)) return 'phone';
  if (/^iPad/i.test(model)) return 'tablet';
  return null;
}

/** Normalize a Timing Path value to an absolute filesystem path, or null if it isn't one. */
function toFilePath(value: string): string | null {
  let p = value;
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
    try {
      p = decodeURI(p);
    } catch {
      // keep the raw (still-encoded) path rather than dropping the file
    }
  } else if (!p.startsWith('/')) {
    return null;
  }
  const trimmed = p.trim();
  return trimmed && trimmed !== '/' ? trimmed : null;
}

/**
 * The most specific :MediaObject leaf a path's extension supports. The
 * path-keyed entity IS the media object living there, typed as well as a
 * path-only observer can tell; anything unrecognized (code, data, no extension)
 * stays a plain MediaObject for a byte-reader to refine later.
 */
const MEDIA_TYPE_BY_EXTENSION: { [ext: string]: MediaLeafType } = {
  ...leafType('ImageObject', 'png jpg jpeg gif webp heic heif svg tiff tif bmp ico'),
  ...leafType('AudioObject', 'mp3 wav aac flac m4a ogg aiff wma'),
  ...leafType('VideoObject', 'mp4 mov avi mkv webm m4v wmv flv'),
  ...leafType(
    'DocumentObject',
    'pdf doc docx txt md markdown rtf pages key ppt pptx xls xlsx csv numbers epub odt tex'
  ),
};

type MediaLeafType = 'ImageObject' | 'AudioObject' | 'VideoObject' | 'DocumentObject';

function leafType(type: MediaLeafType, extensions: string) {
  return Object.fromEntries(extensions.split(' ').map(ext => [ext, type]));
}

function mediaTypeForPath(handle: string): MediaLeafType | 'MediaObject' {
  const ext = path.extname(handle).slice(1).toLowerCase();
  return MEDIA_TYPE_BY_EXTENSION[ext] ?? 'MediaObject';
}

/** Drop a trailing " - <app>" / " — <app>" suffix that just repeats the app name. */
function stripWindowTitle(title: string, appTitle: string | null): string {
  const trimmed = title.trim();
  if (appTitle) {
    for (const sep of [' - ', ' — ', ' – ']) {
      const suffix = `${sep}${appTitle}`;
      if (trimmed.endsWith(suffix)) return trimmed.slice(0, -suffix.length).trim();
    }
  }
  return trimmed;
}
