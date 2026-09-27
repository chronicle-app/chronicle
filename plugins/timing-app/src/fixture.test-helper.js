import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Epoch seconds; 1735689600 is 2025-01-01T00:00:00Z.
export const JAN_1 = 1_735_689_600;

export const MAC_GLOBAL_ID = '1234567890123456789';
export const PHONE_GLOBAL_ID = '1987654321098765432';

/**
 * A synthetic Timing.app SQLite.db holding the tables the extractors read: two
 * devices (a Mac and a Screen Time-relayed iPhone), a project tree, app usage,
 * time entries, and the Apple Call History relay. Returns the database path.
 */
export function writeTimingFixture(dir) {
  const file = join(dir, 'SQLite.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE Device (localID INTEGER PRIMARY KEY, globalID INTEGER, macAddress BLOB,
      displayName TEXT, property_bag TEXT);
    CREATE TABLE Project (id INTEGER PRIMARY KEY, title TEXT, parentID INTEGER, color TEXT,
      productivityScore REAL, isArchived INTEGER, property_bag TEXT, isSample INTEGER);
    CREATE TABLE Application (id INTEGER PRIMARY KEY, bundleIdentifier TEXT, executable TEXT,
      title TEXT);
    CREATE TABLE Title (id INTEGER PRIMARY KEY, stringValue TEXT);
    CREATE TABLE Path (id INTEGER PRIMARY KEY, stringValue TEXT);
    CREATE TABLE AppActivity (id INTEGER PRIMARY KEY, startDate REAL, endDate REAL,
      localDeviceID INTEGER, applicationID INTEGER, projectID INTEGER, titleID INTEGER,
      pathID INTEGER, isDeleted INTEGER);
    CREATE TABLE TaskActivity (id INTEGER PRIMARY KEY, startDate REAL, endDate REAL,
      projectID INTEGER, title TEXT, notes TEXT, isDeleted INTEGER, isRunning INTEGER);
    CREATE TABLE Integration (id INTEGER PRIMARY KEY, type TEXT);
    CREATE TABLE EventSource (id INTEGER PRIMARY KEY, title TEXT, event_source_type TEXT);
    CREATE TABLE Event (id INTEGER PRIMARY KEY, origin_id TEXT, start_date REAL, end_date REAL,
      integration_id INTEGER, event_source_id INTEGER, deleted_at REAL);

    INSERT INTO Project VALUES
      (1, 'Work', NULL, '#0000ff', 1, 0, '{"_default_billing_status":"billable"}', 0),
      (2, 'Chronicle', 1, NULL, 1, 0, NULL, 0),
      (3, 'Sample project', NULL, NULL, 0, 0, NULL, 1),
      (4, 'Family', NULL, NULL, 0, 0, 'not json', 0);
    INSERT INTO Application VALUES
      (1, 'com.mitchellh.ghostty', NULL, 'Ghostty'),
      (2, 'com.google.Chrome', NULL, 'Google Chrome'),
      (3, 'com.apple.TextEdit', NULL, 'TextEdit'),
      (4, NULL, '/usr/bin/vim', 'vim'),
      (5, 'com.example.notes', NULL, 'Notes');
    INSERT INTO Title VALUES
      (1, 'sleep 4'),
      (2, 'Chronicle docs - Google Chrome'),
      (3, 'my notes.md'),
      (4, 'Makefile (~/projects)');
    INSERT INTO Path VALUES
      (1, 'file:///Users/pat/projects/chronicle/'),
      (2, 'https://example.com/docs'),
      (3, 'file:///Users/pat/my%20notes.md'),
      (4, '/Users/pat/projects/Makefile');

    INSERT INTO AppActivity VALUES
      (101, ${JAN_1 + 100}, ${JAN_1 + 400}, 1, 1, 2, 1, 1, 0),
      (102, ${JAN_1 + 500}, ${JAN_1 + 800}, 1, 2, 1, 2, 2, 0),
      (103, ${JAN_1 + 900}, ${JAN_1 + 1000}, 1, 3, NULL, 3, 3, 0),
      (104, ${JAN_1 + 1100}, ${JAN_1 + 1200}, 1, 4, 3, 4, 4, 0),
      (105, ${JAN_1 + 1300}, ${JAN_1 + 1400}, 2, 5, NULL, NULL, NULL, 0),
      (106, ${JAN_1 + 1500}, ${JAN_1 + 1600}, 1, 1, NULL, NULL, NULL, 1);

    INSERT INTO TaskActivity VALUES
      (201, ${JAN_1 + 200}, ${JAN_1 + 3800}, 4, 'Bedtime routine', 'with family', 0, 0),
      (202, ${JAN_1 + 300}, ${JAN_1 + 400}, 4, 'Still running', NULL, 0, 1),
      (203, ${JAN_1 + 350}, ${JAN_1 + 450}, 4, 'Deleted', NULL, 1, 0);

    INSERT INTO Integration VALUES (1, 'com.apple.CallHistory'), (2, 'com.apple.Calendar');
    INSERT INTO EventSource VALUES
      (1, '+1 (416) 555-0123', 'contact'),
      (2, 'Sam Rivera', 'contact'),
      (3, 'Nobody Known', 'contact'),
      (4, 'Planning', 'calendar');
    INSERT INTO Event VALUES
      (1, 'CALL-0001', ${JAN_1 + 150}, ${JAN_1 + 183}, 1, 1, NULL),
      (2, 'CALL-0002', ${JAN_1 + 450}, NULL, 1, 2, NULL),
      (3, 'CALL-0003', ${JAN_1 + 650}, ${JAN_1 + 700}, 1, 3, NULL),
      (4, 'CALL-0004', ${JAN_1 + 660}, ${JAN_1 + 700}, 1, 1, ${JAN_1 + 800}),
      (5, NULL, ${JAN_1 + 670}, ${JAN_1 + 700}, 1, 1, NULL),
      (6, 'CAL-0001', ${JAN_1 + 680}, ${JAN_1 + 700}, 2, 4, NULL);
  `);
  const insertDevice = db.prepare('INSERT INTO Device VALUES (?, ?, ?, ?, ?)');
  insertDevice.run(
    1,
    MAC_GLOBAL_ID,
    Uint8Array.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]),
    'pat-mbp.local',
    JSON.stringify({ _device_model: 'Mac15,3' })
  );
  // A Screen Time relay: its MAC is not a real hardware address, so it is dropped.
  insertDevice.run(
    2,
    PHONE_GLOBAL_ID,
    Uint8Array.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x01]),
    'iPhone',
    JSON.stringify({
      _imported_via_screen_time: true,
      _display_name_override: 'pat-iphone',
      _device_model: 'iPhone15,2',
    })
  );
  db.close();
  return file;
}

/**
 * A synthetic macOS AddressBook under `home`, where the icloud package's
 * contact lookup finds it when HOME points at `home`.
 */
export function writeAddressBook(home) {
  const dir = join(home, 'Library', 'Application Support', 'AddressBook');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'AddressBook-v22.abcddb'));
  db.exec(`
    CREATE TABLE ZABCDRECORD (Z_PK INTEGER, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT,
      ZEXTERNALUUID TEXT);
    CREATE TABLE ZABCDEMAILADDRESS (ZOWNER INTEGER, ZADDRESS TEXT);
    CREATE TABLE ZABCDPHONENUMBER (ZOWNER INTEGER, ZFULLNUMBER TEXT);
    INSERT INTO ZABCDRECORD VALUES
      (1, 'Sam', 'Rivera', NULL, 'contact-sam'),
      (2, 'Alex', 'Chen', NULL, 'contact-alex');
    INSERT INTO ZABCDEMAILADDRESS VALUES (1, 'Sam@Example.com');
    INSERT INTO ZABCDPHONENUMBER VALUES (1, '+1 416 555 0199'), (2, '(416) 555-0123');
  `);
  db.close();
}
