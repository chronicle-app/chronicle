/** What a recording's encoder tag says about where it was recorded. */
export interface Recorder {
  /** The OS release, as the tag inside `com.apple.VoiceMemos (…)` writes it, such as `Watch Version 11.5 (Build 22T572)`. */
  release: string;
  /** The kind of device, when the tag names one. */
  line: ProductLine | null;
}

export interface ProductLine {
  /** Its Wikidata ID, such as `Q2766`, which other sources can name too. */
  wikidataId: string;
  name: string;
}

const LINES = {
  iPhone: { wikidataId: 'Q2766', name: 'iPhone' },
  Watch: { wikidataId: 'Q18010946', name: 'Apple Watch' },
  Mac: { wikidataId: 'Q75687', name: 'Mac' },
} satisfies { [kind: string]: ProductLine };

// The tag's forms. `<device> Version <version> (Build <build>)` is the
// current one, and `iOS <version>` and `Mac OS X <version>` are older ones.
const TAG = /^com\.apple\.VoiceMemos \((.+)\)$/;
const VERSIONED = /^(iPhone|iPad|Watch) Version \d/;
const IOS = /^iOS (\d+)/;
const MAC_OS_X = /^Mac OS X (10\.\d+)/;

// When each release that wrote an older form came out. iOS 13 rewrote older
// recordings with its own tag, so an older-form tag naming a release that
// came out after the recording was made is from that rewrite. Voice Memos
// stopped writing these forms in 2020, so the list doesn't grow.
const OLDER_FORM_RELEASED: { [release: string]: string } = {
  'iOS 12': '2018-09-17',
  'iOS 13': '2019-09-19',
  'Mac OS X 10.14': '2018-09-24',
  'Mac OS X 10.15': '2019-10-07',
};

/**
 * Read a recording's encoder tag, such as
 * `com.apple.VoiceMemos (Watch Version 11.5 (Build 22T572))`. The tag names
 * the OS release that wrote the file, and sometimes the kind of device, but
 * never which device. `null` when it isn't Voice Memos' tag, when it doesn't
 * name an OS release, or when it's from iOS 13's rewrite of an older file.
 */
export function readEncoder(tag: string, recorded: Date): Recorder | null {
  const release = TAG.exec(tag)?.[1];
  if (!release) return null;

  const versioned = VERSIONED.exec(release);
  if (versioned) {
    // `iPad` names no kind of device: Voice Memos on a Mac is the iPad app, so
    // a Mac's tag says `iPad` too.
    const device = versioned[1] as 'iPhone' | 'iPad' | 'Watch';
    return { release, line: device === 'iPad' ? null : LINES[device] };
  }

  const ios = IOS.exec(release);
  const macOSX = MAC_OS_X.exec(release);
  let older: string;
  if (ios) older = `iOS ${ios[1]}`;
  else if (macOSX) older = `Mac OS X ${macOSX[1]}`;
  else return null;
  const released = OLDER_FORM_RELEASED[older];
  if (released && recorded < new Date(released)) return null;
  // `iOS 13.1.2` doesn't say whether it was an iPhone or an iPad.
  return { release, line: macOSX ? LINES.Mac : null };
}
