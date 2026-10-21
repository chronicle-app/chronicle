import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
export const JAN_1 = 757_382_400;
const DAY = 86_400;

// An explicit account keeps the host's iCloud account out of the tests.
export const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '123',
};

/**
 * A synthetic MTLibrary.sqlite, with the columns the extractor reads in the
 * layout macOS 27 uses: an episode's duration and audio URL are on its media
 * enclosure, and its description is a row of its own.
 *
 * A followed show and one that isn't, and six episodes: finished after being
 * saved, in progress, saved but unplayed, marked as played without a last-played
 * date, an older one played with only its playback-sync time left, and one
 * sampled for five seconds, which isn't extracted.
 *
 * Each has Apple's catalog ID, but for another followed show and an episode of
 * it that was played. They aren't in the catalog, so they're left out.
 *
 * The followed show is on its network's channel, and its feed names its host
 * as its author. Its feed has moved since it was followed. The finished episode names its producers instead. The other
 * shows aren't on a channel.
 *
 * The finished episode's feed links it to the show's home page, as many feeds
 * link every episode.
 *
 * The unfollowed show has been retired. Its publisher retitled it and its older
 * episode "Podcast no longer available".
 *
 * A played episode's playback position syncs to a row of ZMTUPPMETADATA,
 * matched by its metadata identifier. At 01:00 a library-wide update changed the
 * older episode's play state and synced the finished one again, and a feed
 * refresh at 02:30 changed the finished episode's play state.
 *
 * It's laid out as the app's group container is, with the library in
 * `Documents/` and downloaded transcripts in `Library/Cache/Assets/TTML/`. The
 * finished episode's transcript is there. The episode in progress has one that
 * hasn't been downloaded, and the saved episode's can't be read.
 */
export function writeApplePodcastsFixture(dir) {
  mkdirSync(join(dir, 'Documents'));
  const input = join(dir, 'Documents', 'MTLibrary.sqlite');
  const transcripts = join(dir, 'Library', 'Cache', 'Assets', 'TTML');
  mkdirSync(join(transcripts, TRANSCRIPT_FOLDER), { recursive: true });
  writeFileSync(join(transcripts, `${TRANSCRIPT_FOLDER}/transcript_2001.ttml-2001.ttml`), TTML);
  // A folder where the saved episode's transcript should be: it can't be read.
  mkdirSync(join(transcripts, `${TRANSCRIPT_FOLDER}/transcript_2003.ttml-2003.ttml`));
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE ZMTPODCAST (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR,
      ZAUTHOR VARCHAR, ZCATEGORY VARCHAR, ZFEEDURL VARCHAR, ZIMAGEURL VARCHAR,
      ZWEBPAGEURL VARCHAR, ZSTORECOLLECTIONID INTEGER, ZADDEDDATE TIMESTAMP,
      ZITEMDESCRIPTION VARCHAR, ZSUBSCRIBED INTEGER, ZCHANNEL INTEGER,
      ZUPDATEDFEEDURL VARCHAR);
    CREATE TABLE ZMTCHANNEL (Z_PK INTEGER PRIMARY KEY, ZSTOREID INTEGER, ZNAME VARCHAR);
    CREATE TABLE ZMTMEDIAENCLOSURE (Z_PK INTEGER PRIMARY KEY, ZEPISODE INTEGER,
      ZDURATION FLOAT, ZREMOTEURL VARCHAR, ZTRANSCRIPTIDENTIFIER VARCHAR);
    CREATE TABLE ZMTEPISODEDESCRIPTION (Z_PK INTEGER PRIMARY KEY, ZEPISODE INTEGER,
      ZPLAINTEXT VARCHAR, ZTEXT VARCHAR);
    CREATE TABLE ZMTEPISODE (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZGUID VARCHAR,
      ZTITLE VARCHAR, ZAUTHOR VARCHAR, ZPODCAST INTEGER, ZPODCASTUUID VARCHAR,
      ZCURRENTMEDIAENCLOSURE INTEGER, ZDESCRIPTIONOBJECT INTEGER, ZPLAYHEAD FLOAT,
      ZPLAYCOUNT INTEGER, ZPLAYSTATELASTMODIFIEDDATE TIMESTAMP, ZLASTDATEPLAYED TIMESTAMP,
      ZLASTUSERMARKEDASPLAYEDDATE TIMESTAMP, ZISBOOKMARKED INTEGER,
      ZLASTBOOKMARKEDDATE TIMESTAMP, ZPUBDATE TIMESTAMP, ZSTORETRACKID INTEGER,
      ZWEBPAGEURL VARCHAR, ZARTWORKTEMPLATEURL VARCHAR, ZMETADATAIDENTIFIER VARCHAR);
    CREATE TABLE ZMTUPPMETADATA (Z_PK INTEGER PRIMARY KEY, ZMETADATAIDENTIFIER VARCHAR,
      ZTIMESTAMP TIMESTAMP);

    INSERT INTO ZMTPODCAST VALUES
      (1, 'SHOW-FOLLOWED', 'Example Conversations', 'Pat Example', 'Society & Culture',
        'https://example.com/feed.xml', 'https://example.com/show.jpg',
        'https://example.com/show', 1001, ${JAN_1 - 30 * DAY}, 'Long conversations.', 1, 1,
        'https://feeds.example.net/conversations.xml'),
      (2, 'SHOW-UNFOLLOWED', 'Podcast no longer available', NULL, NULL, 'https://example.org/feed.xml',
        NULL, NULL, 1002, NULL, NULL, 0, NULL, NULL),
      (3, 'SHOW-UNCATALOGED', 'Example Members', NULL, NULL, 'https://example.net/members.xml',
        NULL, NULL, NULL, ${JAN_1 - 5 * DAY}, NULL, 1, NULL, NULL);

    INSERT INTO ZMTCHANNEL VALUES (1, 3001, 'Example Network');

    INSERT INTO ZMTMEDIAENCLOSURE VALUES
      (1, 1, 3121, 'https://example.com/audio/finished.mp3?dest=1',
        '${TRANSCRIPT_FOLDER}/transcript_2001.ttml'),
      (2, 2, 3363, 'https://example.com/audio/in-progress.mp3',
        '${TRANSCRIPT_FOLDER}/transcript_2002.ttml'),
      (3, 3, 1200, 'https://example.com/audio/saved.mp3',
        '${TRANSCRIPT_FOLDER}/transcript_2003.ttml'),
      (4, 4, 600, 'https://example.org/audio/sampled.mp3', NULL),
      (5, 5, 45, 'https://example.org/audio/marked.mp3', NULL),
      (6, 6, 1800, 'https://example.org/audio/older.mp3', NULL),
      (7, 7, 900, 'https://example.net/audio/members.mp3', NULL);

    INSERT INTO ZMTEPISODEDESCRIPTION VALUES
      (1, 1, 'A guest on their new book.',
        '<p>A guest on <a href="https://example.com/book">their new book</a>.</p>');

    INSERT INTO ZMTEPISODE VALUES
      (1, 'EP-FINISHED', 'guid-1', 'A Finished Episode', 'Sam Producer, Pat Example', 1,
        'SHOW-FOLLOWED',
        1, 1, 0, 1, ${JAN_1 + 9000}, ${JAN_1 + 3000}, NULL, 1, ${JAN_1 - DAY},
        ${JAN_1 - 2 * DAY}, 2001, 'https://example.com/show',
        'https://example.com/art/{w}x{h}bb.{f}', 'md-finished'),
      (2, 'EP-IN-PROGRESS', 'guid-2', 'An Episode in Progress', 'Pat Example', 1,
        'SHOW-FOLLOWED', 2, NULL, 239, 0, ${JAN_1 + 7200}, ${JAN_1 + 7200}, NULL, 0, NULL,
        ${JAN_1 - DAY}, 2002, NULL, NULL, 'md-in-progress'),
      (3, 'EP-SAVED', 'guid-3', 'A Saved Episode', 'Pat Example', 1, 'SHOW-FOLLOWED',
        3, NULL, 0, 0, ${JAN_1 + 600}, NULL, NULL, 1, ${JAN_1 + 600}, ${JAN_1}, 2003, NULL,
        NULL, 'md-saved'),
      (4, 'EP-SAMPLED', 'guid-4', 'A Sampled Episode', NULL, 2, 'SHOW-UNFOLLOWED', 4, NULL,
        5, 0, ${JAN_1 + 9000}, ${JAN_1 + 9000}, NULL, 0, NULL, ${JAN_1}, 2004, NULL, NULL,
        'md-sampled'),
      (5, 'EP-MARKED', 'guid-5', 'A Trailer', NULL, 2, 'SHOW-UNFOLLOWED', 5, NULL, 0, 1,
        ${JAN_1 + 5400}, NULL, ${JAN_1 + 5400}, 0, NULL, ${JAN_1 - DAY}, 2005, NULL, NULL,
        'md-marked'),
      (6, 'EP-OLDER', 'guid-6', 'Podcast No Longer Available', NULL, 2, 'SHOW-UNFOLLOWED', 6, NULL, 0,
        1, ${JAN_1 + 3600}, NULL, NULL, 0, NULL, ${JAN_1 - 20 * DAY}, 2006, NULL, NULL,
        'md-older'),
      (7, 'EP-UNCATALOGED', 'guid-7', 'A Members Episode', NULL, 3, 'SHOW-UNCATALOGED', 7,
        NULL, 0, 1, ${JAN_1 + 4000}, ${JAN_1 + 4000}, NULL, 0, NULL, ${JAN_1 - DAY}, NULL,
        NULL, NULL, 'md-uncataloged');

    INSERT INTO ZMTUPPMETADATA VALUES
      (1, 'md-finished', ${JAN_1 + 3600}),
      (2, 'md-in-progress', ${JAN_1 + 7200}),
      (3, 'md-older', ${JAN_1 - 10 * DAY});
  `);
  db.close();
  return input;
}

const TRANSCRIPT_FOLDER = 'PodcastContent221/v4/aa/bb/cc/fixture';

// A transcript as Apple Podcasts makes them: each speaker's turn a paragraph of
// sentences, each word a span, with no space between the spans.
const word = text => `<span begin="0" end="1" podcasts:unit="word">${text}</span>`;
const sentence = text =>
  `<span begin="0" end="1" podcasts:unit="sentence" xml:lang="en">${text
    .split(' ')
    .map(text => word(text))
    .join('')}</span>`;
const TTML =
  '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:podcasts="http://podcasts.apple.com/transcript-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="en">' +
  '<head><metadata /></head><body dur="3120.48"><div begin="0" end="9">' +
  `<p begin="0" end="4" ttm:agent="SPEAKER_1">${sentence('Welcome back, it&apos;s Q&amp;A time.')}</p>` +
  `<p begin="4" end="9" ttm:agent="SPEAKER_2">${sentence('Thanks for having me.')}${sentence('Glad to be here.')}</p>` +
  '</div></body></tt>';
