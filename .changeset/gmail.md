---
'@chronicle.app/mail': minor
'@chronicle.app/gmail': minor
'@chronicle.app/email': minor
---

A Gmail plugin reads your Gmail through the API, newest first, or from a Google Takeout mbox, with each message in its `Thread` and its labels as `tags`. `--sent` and `--label` pick what to extract with either, and `--query` takes any Gmail search with the API. Spam and Trash are left out unless named with `--label`. Mail in Sent is yours (`@me`).

A shared mail package reads mbox files as a stream and parses messages with postal-mime, so quoted-printable, base64, and HTML-only bodies come through. A message's body is what its sender wrote, as plain text or Markdown: HTML becomes Markdown; quoted history and signatures are removed with email-reply-parser; bulk mail loses its footer; and images, tracking parameters, and click-tracking redirect URLs are left out. Only the headers a source reads are kept in the raw record. The email plugin uses it too. Messages and people are now keyed with no source, a message by its Message-ID and a person by their lowercased address, so the same email from Gmail, a Takeout, or another mbox is one node; the email plugin's messages and people get these new keys. A message's text is its `body`, where it was its `description`, and a reply is `inReplyTo` the message it answers.
