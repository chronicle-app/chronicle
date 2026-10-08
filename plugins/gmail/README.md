# @chronicle.app/gmail

Your Gmail: messages, the threads Gmail groups them in, and their labels. Read live through the [Gmail API](https://developers.google.com/workspace/gmail/api/reference/rest), or from the mbox in a [Google Takeout](https://takeout.google.com).

## Usage

```sh
chronicle auth login google
chronicle extract gmail
chronicle extract gmail --sent --since 2025-01-01
chronicle extract gmail --label Work,Starred
chronicle extract gmail --query "from:boss@example.com has:attachment"
chronicle extract gmail --strategy takeout --input "All mail Including Spam and Trash.mbox" --sent
```

Sign in first: see [@chronicle.app/google](../../core/google/README.md), which walks you through making your own Google client. `--account` picks one of several signed-in accounts.

The API reads newest first. A Takeout reads in the order the mbox has, and needs no sign-in.

### What to extract

- `--sent`: only mail you sent.
- `--label Work,Starred`: only mail with all of these labels, yours or Gmail's own (Inbox, Starred, Important). Spam and Trash are left out unless you name them: `--label Spam`.
- `--query "<search>"`: any Gmail search, as in Gmail's search box: `from:`, `to:`, `has:attachment`, `-in:sent`. It needs the API.
- `--since` and `--until` narrow by when the mail was sent, with either.

## Schema

Messages are built by [@chronicle.app/email-core](../../core/email/README.md), the same way the email plugin builds them from an mbox, with Gmail's thread and labels added.

| Gmail thing       | Chronicle node  | Key                                                                        | Properties                                                                                                                                                                                     |
| ----------------- | --------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sending a message | `MessageAction` | `@type`, `sourceId` (the Message-ID)                                       | `agent` (the sender), `object` (the `Message`), `timestamp` (the Date header)                                                                                                                  |
| A message         | `Message`       | `@type`, `sourceId` (the Message-ID)                                       | `sameAs` (Gmail's message ID in the mailbox), `name` (subject), `body` (what was written, as text or Markdown), `author`, `recipient`, `inReplyTo`, `isPartOf` (its `Thread`), `tags` (labels) |
| A conversation    | `Thread`        | `@type`, `source`, `inRealm` (the mailbox), `sourceId` (Gmail's thread ID) |                                                                                                                                                                                                |
| A person          | `Agent`         | `@type`, `source` (`email`), `handle` (their address, lowercased)          | `name`; you are `sameAs` `@me`                                                                                                                                                                 |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**A message is its Message-ID, wherever it's read.** A message and the sending of it are keyed by its Message-ID, without the angle brackets around it, in the `email` namespace, the protocol's own, so the same message from the API, a Takeout, another mailbox, or an mbox is one node. Gmail's own message ID is only unique within a mailbox (it's the time the message arrived there, and a counter), so it identifies this mailbox's copy, not the message: the message is `sameAs` it, keyed in a `Realm` for the account. A thread is Gmail's, so it's keyed by Gmail's thread ID in the mailbox. A person is their lowercased address in the `email` namespace, the identity other plugins link an address to, so a person seen in Gmail, any other mail, or a calendar is one node. A message without a Message-ID is identified by its sender, date, and subject.

**Messages and threads link to Gmail.** The plugin declares `deepLinks` for its `Message` and `Thread` nodes (`https://mail.google.com/mail/#all/<id>`), so a host can open them in Gmail. A link opens in the account the browser has first, so with several signed in it may need switching.

**Threads and labels come from Gmail either way.** The API gives a message's thread ID and label IDs; a Takeout writes the same thread ID in decimal (`X-GM-THRID`) and the labels by name (`X-Gmail-Labels`). Both become the same `Thread` and the same label names, as Gmail shows them. Read state (Unread, Opened) changes as you read, so it isn't kept as a label.

**A body is what was written, not what was sent.** It's plain text or Markdown, never HTML: the text part, or the HTML part converted to Markdown. Quoted history, signatures, newsletter footers, images, and tracking parameters are left out; see [@chronicle.app/email-core](../../core/email/README.md).

**Your contacts can link people.** With `--link-contacts` (and `chronicle auth login google --add contacts`), a person on one of your contacts is `sameAs` the contact's other addresses and phone numbers, so the person who emails you is the person who texts or calls you. A Takeout run links them too when you're signed in.

**A draft isn't a message.** Drafts are left out, from the API and a Takeout alike: they were never sent.

**Mail in Sent is yours.** Its sender is `sameAs` `@me`, whatever address it came from. Gmail also says the mailbox's own address (the API's profile, or the `Delivered-To` header in a Takeout), so you are `@me` as a recipient too.

**Your address is your Google account.** From the API, the mailbox's own address is also `sameAs` its Google account, a `google-account` Agent keyed by the account's Gaia id (Google's permanent id for it, from OpenID's userinfo). Chrome and Google Calendar link you to the same node, so they meet on the account even after its address changes. A Takeout doesn't say the id, and a sign-in without the `openid` scope can't read it; the run goes on without the link.

## Tests

The tests run against a fake Gmail API on 127.0.0.1 and a synthetic Takeout mbox in a temporary directory, both built from the same made-up messages, and pass the access token directly. They never read stored credentials or reach Google.
