import { writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

// The zip format's record signatures and the values every entry here shares.
const LOCAL_FILE = 0x04_03_4b_50;
const CENTRAL_FILE = 0x02_01_4b_50;
const END_OF_CENTRAL = 0x06_05_4b_50;
const VERSION = 20;
const UTF8_NAMES = 0x08_00;
const DEFLATE = 8;
// 1980-01-01 00:00, the earliest date a zip can hold, so a fixture's bytes don't
// change. A DOS date packs the years since 1980, the month, and the day into 16 bits.
const DOS_TIME = 0;
const DOS_DATE = 0x00_21;
// Info-ZIP's extended timestamp, which dates an entry in UTC to the second.
const UNIX_TIME = 0x54_55;

/**
 * Write a zip of the given files, by their paths inside it, for test
 * fixtures: an export zipped the way a service hands it over. With
 * `modified`, each entry is dated then, as a service dates the files it exports.
 */
export function writeZip(
  path: string,
  files: { [name: string]: string | Uint8Array },
  { modified }: { modified?: Date } = {}
): void {
  const extra = Buffer.alloc(modified ? 9 : 0);
  if (modified) {
    extra.writeUInt16LE(UNIX_TIME, 0);
    extra.writeUInt16LE(5, 2);
    extra.writeUInt8(1, 4);
    extra.writeUInt32LE(Math.floor(modified.getTime() / 1000), 5);
  }
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    const compressed = deflateRawSync(data);
    const fileName = Buffer.from(name);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(extra.length, 28);
    locals.push(local, fileName, extra, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName, extra);

    offset += local.length + fileName.length + extra.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...locals, directory, end]));
}
