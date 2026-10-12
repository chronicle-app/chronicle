/** What a recording's encoder tag says about where it was recorded. */
export interface Recorder {
  /** The tag inside `com.apple.VoiceMemos (…)`, as written, such as `Watch Version 11.5 (Build 22T572)`. */
  release: string;
  /** The kind of device, when the tag names one. */
  line: ProductLine | null;
}

export interface ProductLine {
  /** Its Wikidata entity, which other sources can name too. */
  url: string;
  name: string;
}

const WIKIDATA = 'http://www.wikidata.org/entity/';
const LINES = {
  iPhone: { url: `${WIKIDATA}Q2766`, name: 'iPhone' },
  Watch: { url: `${WIKIDATA}Q18010946`, name: 'Apple Watch' },
  Mac: { url: `${WIKIDATA}Q75687`, name: 'Mac' },
} satisfies { [kind: string]: ProductLine };

// When each major release came out. A tag naming a release that came out
// after the recording was made comes from a device that rewrote the file
// later, as iOS 13 did to older recordings. A release missing here isn't
// checked, so a new one only needs adding to catch a later rewrite.
const RELEASED: { [os: string]: { [major: string]: string } } = {
  iOS: {
    12: '2018-09-17',
    13: '2019-09-19',
    14: '2020-09-16',
    15: '2021-09-20',
    16: '2022-09-12',
    17: '2023-09-18',
    18: '2024-09-16',
    26: '2025-09-15',
  },
  watchOS: {
    5: '2018-09-17',
    6: '2019-09-19',
    7: '2020-09-16',
    8: '2021-09-20',
    9: '2022-09-12',
    10: '2023-09-18',
    11: '2024-09-16',
    26: '2025-09-15',
  },
  // Only `Mac OS X 10.x` tags name macOS: since then, Voice Memos on a Mac
  // has been the iPad app.
  macOS: { '10.14': '2018-09-24', '10.15': '2019-10-07' },
};

const TAG = /^com\.apple\.VoiceMemos \((.+)\)$/;
const VERSIONED = /^(iPhone|Watch) Version (\d+)/;
const IOS = /^iOS (\d+)[\d.]*$/;
const MAC_OS_X = /^Mac OS X (10\.\d+)[\d.]*$/;

/**
 * Read a recording's encoder tag, such as
 * `com.apple.VoiceMemos (Watch Version 11.5 (Build 22T572))`. The tag names
 * the kind of device and the OS release that wrote the file, but not which
 * device. `null` when it isn't Voice Memos' tag, or when the release came out
 * after the recording was made, so the tag describes a later rewrite.
 */
export function readEncoder(tag: string, recorded: Date): Recorder | null {
  const release = TAG.exec(tag)?.[1];
  if (!release) return null;

  let os: string | null = null;
  let major: string | null = null;
  let kind: keyof typeof LINES | null = null;
  const versioned = VERSIONED.exec(release);
  const ios = IOS.exec(release);
  const macOSX = MAC_OS_X.exec(release);
  // `iPad Version …` names no kind of device: Voice Memos on a Mac is the iPad
  // app, so a Mac's tag says `iPad` too, with macOS's version.
  if (versioned) {
    const [, device, version] = versioned;
    os = device === 'Watch' ? 'watchOS' : 'iOS';
    major = version;
    kind = device as 'iPhone' | 'Watch';
  } else if (ios) {
    // `iOS 13.1.2` doesn't say whether it was an iPhone or an iPad.
    os = 'iOS';
    major = ios[1];
  } else if (macOSX) {
    os = 'macOS';
    major = macOSX[1];
    kind = 'Mac';
  }

  const released = os && major ? RELEASED[os]?.[major] : undefined;
  if (released && recorded < new Date(released)) return null;
  return { release, line: kind ? LINES[kind] : null };
}
