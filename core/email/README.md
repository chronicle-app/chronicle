# @chronicle.app/email-core

What Chronicle's mail sources share: reading an mbox, parsing an email, identifying it, and the nodes it becomes. The [email](../../plugins/email/README.md) plugin reads any mbox with it; the [gmail](../../plugins/gmail/README.md) plugin reads Gmail's API and Takeouts with it.

- `readMbox(path)` yields each message in an mbox, raw, with the date on its `From ` line, reading the file as a stream: a Takeout of a whole mailbox runs to gigabytes. A message with no Date header takes that date. `countMbox(path)` counts them the same way.
- `parseMessage(raw)` parses an RFC 5322 message with [postal-mime](https://github.com/postalsys/postal-mime): encoded words, quoted-printable and base64 bodies, and multipart alternatives are decoded. The result, a `MailMessage`, is plain data, so it can be a raw record. It keeps only the headers a source reads (the envelope, threading, mailing-list headers, and Gmail's `X-GM-*`), not the routing and signing headers that make up most of a header block.
- `messageBody(parts, { bulk })` is what the sender wrote, as plain text or Markdown, and is the `MailMessage`'s `text`:
  - the text part when there's a real one, else the HTML part converted to Markdown (links, lists, and emphasis kept; hidden preheaders and images dropped), and any markup in a text part converted too;
  - without quoted history and signatures, by [email-reply-parser](https://github.com/crisp-oss/email-reply-parser): reply headers in many languages, Outlook's quoted blocks, `-- ` and "Sent from my phone" signatures. A reply links to the message it answers, so the quote would only store it again. A message that is only a quote, like a forward with no note, keeps it;
  - for bulk mail (one with `List-Unsubscribe`, `List-Id`, or `Precedence: bulk`), without its footer: from the first unsubscribe or "you're receiving this" line in its second half;
  - with tracking parameters (`utm_*`, `fbclid`, …) taken off links and the padding characters newsletters fill their inbox preview with removed, by `tidyText` from `@chronicle.app/etl`. In bulk mail, click-tracking redirects (URLs over 200 characters) lose their URL but keep their words; a person's mail keeps long links, like a meeting's join link.
- `identityOf(message)` is its Message-ID, or else its sender, date, and subject; null when it has neither, and a source skips it.
- `messageAction(message, options)` is the sending of it: a `MessageAction` by the sender on a `Message`, with its recipients and the message it replies to, and a source's thread and labels when it has them. The sender is written in full as the action's `agent`, and as the message's `author` by key alone. With `account`, the message is `inAccount` it.
- `emailAccount(address)` is the account at an address, an Agent keyed by it in the `email` namespace: what a message is `inAccount`, whatever service holds it.

Identifiers the email protocol defines are keyed in its namespace (`source: 'email'`): a message by its Message-ID without the angle brackets around it (as JMAP and `mid:` URIs write it), so the same email read by any mail source is one node. A person is their lowercased address in the `email` namespace (`source: 'email'`), the identity other plugins already link an address to, so every mail source, a calendar, and those links meet on one node.

## Tests

The tests run the parser and builder over synthetic messages and a synthetic mbox in a temporary directory.
