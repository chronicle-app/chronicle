# @chronicle.app/apple-call-history

Chronicle plugin that extracts phone & FaceTime calls from **Apple Call History**
and folds them into the existing comms identity graph (iMessage/WhatsApp via
`phone`/`email` + `@me`).

## Source

`~/Library/Application Support/CallHistoryDB/CallHistory.storedata` (read-only) —
the rich, per-record source (direction, number, duration, participants).

Calls emit `source: apple-call-history`, `sourceId = <call UUID>` (`ZUNIQUE_ID`). Apple's
store has a rolling retention (~recent calls); the **longer history that Apple
prunes is relayed through Timing.app and lives in the `timing-app` plugin**
(`-t calls`), which emits the same `apple-call-history` + UUID identity so the two
fold into one call.

The service (phone / FaceTime / VoIP) is not modeled yet (it needs
cross-source action identity, since the shared key is Apple's UUID).

## Frame

A call is shared co-presence, not a directed send, so participants live on
`:with`, not `:recipient`:

```
CallAction   agent = initiator (when known)   object = CallSession   startTime/endTime
  CallSession  with = [participants other than @me]
```

- **Direction** (`ZORIGINATED`): outgoing → `agent: @me`; incoming 1:1 →
  `agent`: the caller; incoming group → `agent` omitted.
- **Connected vs missed** is derived from the span (missed ⇒ `endTime == startTime`).
- **Participants** are `Person` keyed on `phone` (E.164) or `email` — folding into
  the iMessage/WhatsApp graph and `@me`.
- Blocked/private numbers (empty address) carry no participant.

## Usage

```bash
chronicle extract apple-call-history                          # Apple Call History (rich; type: calls)
chronicle extract apple-call-history --input /path/to/CallHistory.storedata --since 2025-01-01
```

## Tests

Tests build a synthetic `CallHistory.storedata` and a synthetic AddressBook with
`node:sqlite`, and pass the transformer an explicit iCloud `account` and a
`lookupContact` over that AddressBook, so they never read the host's call history,
contacts, or iCloud account.
