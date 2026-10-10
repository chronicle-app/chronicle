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

| Gmail thing       | Chronicle node  | Key                                                                                               | Properties                                                                                                                                                                                                         |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sending a message | `MessageAction` | `@type`, `sourceId` (the Message-ID)                                                              | `agent` (the sender), `object` (the `Message`), `timestamp` (the Date header)                                                                                                                                      |
| A message         | `Message`       | `@type`, `sourceId` (the Message-ID)                                                              | `inAccount` (the account at the mailbox's address, from the API), `name` (subject), `body` (what was written, as text or Markdown), `author`, `recipient`, `inReplyTo`, `isPartOf` (its `Thread`), `tags` (labels) |
| A conversation    | `Thread`        | `@type`, `source`, `inAccount` (the Google account, from the API), `sourceId` (Gmail's thread ID) |                                                                                                                                                                                                                    |
| A person          | `Agent`         | `@type`, `source` (`email`), `handle` (their address, lowercased)                                 | `alternateName` (each display name the mail gave it); you are `sameAs` `@me`, and your Google account from the API                                                                                                 |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**A message is its Message-ID, wherever it's read.** A message and the sending of it are keyed by its Message-ID, without the angle brackets around it, in the `email` namespace, the protocol's own, so the same message from the API, a Takeout, another mailbox, or an mbox is one node. The message is `inAccount` the account at the mailbox's address, an Agent keyed by that address in the `email` namespace, as any mail source of the same mailbox can say, so "messages in this account" is one query; a message in several of your accounts is in each. Gmail's own message ID isn't kept: it's only unique within the account (it's the time the message arrived there, and a counter), and the Message-ID already identifies the message. A thread is Gmail's: the Google account issued its ID, which is only unique within it, so the thread is `inAccount` the Google account (an Agent keyed by the address in the `google-account` namespace) and keyed within it. A person is their lowercased address in the `email` namespace, the identity other plugins link an address to, so a person seen in Gmail, any other mail, or a calendar is one node. A message without a Message-ID is identified by its sender, date, and subject.

**Threads link to Gmail, in their account.** The plugin declares a `deepLinks` template for its `Thread` nodes, `https://mail.google.com/mail/?authuser=<address>#all/<thread ID>`, so a host can open the conversation in Gmail. `authuser` picks the signed-in Google account by its address, so with several signed in it opens in the right one. A thread from a Takeout has no account to fill it with.

**Threads and labels come from Gmail either way.** The API gives a message's thread ID and label IDs; a Takeout writes the same thread ID in decimal (`X-GM-THRID`) and the labels by name (`X-Gmail-Labels`). Both give the same thread ID and the same label names, as Gmail shows them. Read state (Unread, Opened) changes as you read, so it isn't kept as a label.

**A Takeout names no account.** The mbox doesn't say which account it was exported from. A message's `Delivered-To` can be an alias, and mail you sent says only the address you sent it from, which can be a send-as address, so neither is the account. So a Takeout's messages are in no account, its threads are keyed by Gmail's thread ID alone, and you aren't linked to a Google account or to your contacts. Its messages are the API's messages, but its threads aren't the API's threads.

**A body is what was written, not what was sent.** It's plain text or Markdown, never HTML: the text part, or the HTML part converted to Markdown. Quoted history, signatures, newsletter footers, images, and tracking parameters are left out; see [@chronicle.app/email-core](../../core/email/README.md).

**Your contacts can link people.** With `--link-contacts` (and `chronicle auth login google --add contacts`), a person on one of your contacts is `sameAs` your contact: the entry in your Google account's contacts, keyed by its ID there and named as you saved it, which is `sameAs` the contact's other addresses and phone numbers, so the person who emails you is the person who texts or calls you. A Takeout doesn't: it can't say whose contacts they'd be.

**A draft isn't a message.** Drafts are left out, from the API and a Takeout alike: they were never sent.

**A display name is what a message called someone.** The name in a `From`, `To`, or `Cc` header is chosen by the sender or their address book, and a group or notification address carries a different one in nearly every message. So it's an `alternateName` of the address, never its `name`, and an address gathers one for each name it was shown with. A person's `name` comes from a source that keeps a record of them: the name you saved for a contact is that contact's `name`.

**Mail in Sent is yours.** Its sender is `sameAs` `@me`, whatever address it came from. Gmail also says the mailbox's own address (the API's profile, or the `Delivered-To` header in a Takeout), so you are `@me` as a recipient too.

**You are your Google account.** Wherever the API has you as `@me`, you are also `sameAs` the Google account the mailbox is: an Agent keyed by the mailbox's address in the `google-account` namespace, the node Google Calendar and Chrome link you to. A Takeout names no account, so it doesn't link you to one.

## Tests

The tests run against a fake Gmail API on 127.0.0.1 and a synthetic Takeout mbox in a temporary directory, both built from the same made-up messages, and pass the access token directly. They never read stored credentials or reach Google.
