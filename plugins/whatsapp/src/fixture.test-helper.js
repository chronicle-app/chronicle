import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
export const JAN_1 = 757_382_400;

export const SELF_NUMBER = '+14165550000';

/** The stanza id of the DM message that A2 quotes. */
export const PARENT_ID = '3EB0462C7F395EC0B664';

/** A protobuf blob whose field 5 is the quoted stanza id, as WhatsApp stores replies. */
export function replyMeta(stanzaId) {
  const id = Buffer.from(stanzaId, 'latin1');
  return Buffer.concat([Buffer.from([5 * 8 + 2, id.length]), id]);
}

/**
 * A synthetic WhatsApp container: ChatStorage.sqlite, ContactsV2.sqlite, and one
 * media file under Message/. Returns the directory holding them.
 */
export function writeWhatsappFixture(dir) {
  mkdirSync(join(dir, 'Message', 'Media'), { recursive: true });
  writeFileSync(join(dir, 'Message', 'Media', 'photo.jpg'), 'JPG');

  const db = new DatabaseSync(join(dir, 'ChatStorage.sqlite'));
  db.exec(`
    CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZSESSIONTYPE INTEGER,
      ZPARTNERNAME TEXT);
    CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZMEMBERJID TEXT,
      ZCONTACTNAME TEXT);
    CREATE TABLE ZWAPROFILEPUSHNAME (ZJID TEXT, ZPUSHNAME TEXT);
    CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMESSAGE INTEGER, ZMEDIALOCALPATH TEXT,
      ZTITLE TEXT, ZMETADATA BLOB);
    CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZTEXT TEXT, ZMESSAGEDATE REAL,
      ZISFROMME INTEGER, ZMESSAGETYPE INTEGER, ZFROMJID TEXT, ZCHATSESSION INTEGER,
      ZGROUPMEMBER INTEGER, ZPARENTMESSAGE INTEGER, ZMEDIAITEM INTEGER);

    INSERT INTO ZWACHATSESSION VALUES
      (1, '14165551234@s.whatsapp.net', 0, 'Alex'),
      (2, '120363000000000001@g.us', 1, 'Hike Club'),
      (3, 'status@broadcast', 3, NULL);
    INSERT INTO ZWAGROUPMEMBER VALUES
      (1, 2, '14165550001@s.whatsapp.net', 'Sam'),
      (2, 2, '555111@lid', NULL);
    INSERT INTO ZWAPROFILEPUSHNAME VALUES ('555111@lid', 'Riley');
    INSERT INTO ZWAMEDIAITEM VALUES
      (1, 2, NULL, NULL, NULL),
      (2, 4, 'Media/photo.jpg', 'Summit!', NULL),
      (3, 5, 'Media/missing.opus', NULL, NULL);

    INSERT INTO ZWAMESSAGE VALUES
      (1, '${PARENT_ID}', 'Are you coming?', ${JAN_1 + 1}, 0, 0, '14165551234@s.whatsapp.net', 1, NULL, NULL, NULL),
      (2, 'A2', 'Yes', ${JAN_1 + 2}, 1, 0, NULL, 1, NULL, NULL, 1),
      (3, 'G1', 'On my way', ${JAN_1 + 3}, 0, 0, '120363000000000001@g.us', 2, 2, NULL, NULL),
      (4, 'G2', NULL, ${JAN_1 + 4}, 0, 1, '120363000000000001@g.us', 2, 1, NULL, 2),
      (5, 'G3', NULL, ${JAN_1 + 5}, 1, 3, NULL, 2, NULL, NULL, 3),
      (6, 'SYS', 'Security code changed', ${JAN_1 + 6}, 0, 10, NULL, 2, NULL, NULL, NULL),
      (7, 'ST1', 'A status', ${JAN_1 + 7}, 0, 0, NULL, 3, NULL, NULL, NULL);
  `);
  db.prepare('UPDATE ZWAMEDIAITEM SET ZMETADATA = ? WHERE Z_PK = 1').run(replyMeta(PARENT_ID));
  db.close();

  const contacts = new DatabaseSync(join(dir, 'ContactsV2.sqlite'));
  contacts.exec(`
    CREATE TABLE ZWAADDRESSBOOKCONTACT (ZLID TEXT, ZWHATSAPPID TEXT);
    INSERT INTO ZWAADDRESSBOOKCONTACT VALUES ('555111@lid', '14165559999@s.whatsapp.net');
  `);
  contacts.close();
  return dir;
}
