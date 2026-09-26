/**
 * The quoted message's stanza id for a reply, decoded from `ZWAMEDIAITEM.ZMETADATA`.
 *
 * WhatsApp only sets the structured `ZWAMESSAGE.ZPARENTMESSAGE` link for a handful of
 * replies (when the parent object is retained in Core Data). For the rest, the quote
 * pointer lives in the message's media-item metadata blob, which is one of two shapes:
 *
 *  - **protobuf** (the overwhelming majority): field 5 (`0x2a`, length-delimited) is
 *    the quoted message's stanza id as an ASCII string.
 *  - **bplist00** (`WAMediaItemMetadata` NSKeyedArchiver, only when the reply itself
 *    carries media): the quote is the `stanzaID` field. Rare enough that we skip it
 *    here and fall back to `ZPARENTMESSAGE`.
 *
 * Returns the quoted stanza id, or null when the blob is not a reply.
 */

/** Stanza ids are uppercase-hex tokens (20 or 32 chars), or a digit run with a `-<n>` suffix. */
const STANZA_ID = /^[0-9A-F]{12,40}(-\d+)?$/;

export function decodeReplyStanzaId(meta: Buffer | Uint8Array | null | undefined): string | null {
  if (!meta || meta.length < 2) return null;
  const buf = Buffer.isBuffer(meta) ? meta : Buffer.from(meta);
  // The bplist (media-reply) variant is handled via ZPARENTMESSAGE instead.
  if (buf.toString('ascii', 0, 8) === 'bplist00') return null;

  const field5 = readBytesField(buf, 5);
  if (!field5) return null;
  const id = field5.toString('latin1');
  return STANZA_ID.test(id) ? id : null;
}

/** First length-delimited (wire type 2) value for `field` in a protobuf message, or null. */
function readBytesField(buf: Buffer, field: number): Buffer | null {
  let p = 0;
  while (p < buf.length) {
    const tag = readVarint(buf, p);
    if (!tag) return null;
    p = tag.next;
    const wire = tag.value % 8;
    const fieldNum = Math.floor(tag.value / 8);
    switch (wire) {
      case 2: {
        const len = readVarint(buf, p);
        if (!len) return null;
        p = len.next;
        const end = p + len.value;
        if (end > buf.length) return null;
        if (fieldNum === field) return buf.subarray(p, end);
        p = end;
        break;
      }
      case 0: {
        const varint = readVarint(buf, p);
        if (!varint) return null;
        p = varint.next;
        break;
      }
      case 5:
        p += 4;
        break;
      case 1:
        p += 8;
        break;
      default:
        return null; // groups / unknown wire types — not expected here
    }
  }
  return null;
}

/** A base-128 varint; values here (tags, lengths) are small, so a JS number is safe. */
function readVarint(buf: Buffer, p: number): { value: number; next: number } | null {
  let value = 0;
  let mult = 1;
  let n = p;
  while (n < buf.length) {
    const byte = buf[n++];
    value += (byte % 128) * mult;
    if (byte < 128) return { value, next: n };
    mult *= 128;
    if (mult > 2 ** 35) return null; // these fields never need a large varint
  }
  return null;
}
