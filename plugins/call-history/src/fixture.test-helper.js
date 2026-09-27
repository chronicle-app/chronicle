import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
export const JAN_1 = 757_382_400;

/**
 * A synthetic CallHistory.storedata with five calls: outgoing 1:1, incoming
 * 1:1 by email, missed, blocked (no address), and an incoming group call.
 */
export function writeCallHistoryFixture(dir) {
  const input = join(dir, 'CallHistory.storedata');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE ZCALLRECORD (Z_PK INTEGER PRIMARY KEY, ZUNIQUE_ID TEXT, ZDATE REAL,
      ZDURATION REAL, ZORIGINATED INTEGER, ZADDRESS TEXT, ZNAME TEXT,
      ZPARTICIPANTGROUPUUID BLOB);
    CREATE TABLE ZHANDLE (Z_PK INTEGER PRIMARY KEY, ZVALUE TEXT);
    CREATE TABLE Z_2REMOTEPARTICIPANTHANDLES (Z_2REMOTEPARTICIPANTCALLS INTEGER,
      Z_4REMOTEPARTICIPANTHANDLES INTEGER);

    INSERT INTO ZCALLRECORD VALUES
      (1, 'CALL-OUT', ${JAN_1 + 60}, 33, 1, '(416) 555-1234', 'Alex Example', NULL),
      (2, 'CALL-IN', ${JAN_1 + 120}, 10, 0, 'Friend@Example.com', NULL, NULL),
      (3, 'CALL-MISSED', ${JAN_1 + 180}, 0, 0, '+14165559999', NULL, NULL),
      (4, 'CALL-BLOCKED', ${JAN_1 + 240}, 5, 0, '', NULL, NULL),
      (5, 'CALL-GROUP', ${JAN_1 + 300}, 90, 0, NULL, 'Group', X'ABCDEF01'),
      (6, NULL, ${JAN_1 + 360}, 1, 1, '+14165551234', NULL, NULL);
    INSERT INTO ZHANDLE VALUES (1, '+14165551234'), (2, 'friend@example.com'), (3, NULL);
    INSERT INTO Z_2REMOTEPARTICIPANTHANDLES VALUES (5, 1), (5, 2), (5, 3);
  `);
  db.close();
  return input;
}

/** A synthetic AddressBook with one card for the Alex number. */
export function writeContactsFixture(dir) {
  const file = join(dir, 'contacts.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE ZABCDRECORD (Z_PK INTEGER, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT,
      ZEXTERNALUUID TEXT);
    CREATE TABLE ZABCDEMAILADDRESS (ZOWNER INTEGER, ZADDRESS TEXT);
    CREATE TABLE ZABCDPHONENUMBER (ZOWNER INTEGER, ZFULLNUMBER TEXT);
    INSERT INTO ZABCDRECORD VALUES (1, 'Alex', 'Contact', NULL, 'contact-1');
    INSERT INTO ZABCDPHONENUMBER VALUES (1, '+1 416 555 1234');
  `);
  db.close();
  return file;
}
