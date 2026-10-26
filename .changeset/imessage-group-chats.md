---
'@chronicle.app/imessage': minor
'@chronicle.app/apple': minor
---

A message in an iMessage group chat is part of the group's `Channel`, keyed in the `imessage` namespace by Apple's ID for the group: `original_group_id`, the ID the group started with, `sameAs` `group_id` when Messages replaced it. Those IDs are the same on your other devices, which a chat's `chat_identifier` often isn't. The Channel is named for the group when it has a name, and its `member` edges are the chat's participants and you, from the first message a run reads in it. A one-to-one chat has no Channel, and a message's recipients are unchanged.

`@chronicle.app/apple` adds `groupChatChannel`, which builds that Channel from a chat's IDs so every plugin that sees a group keys it the same way, and `GROUP_CHAT_STYLE`, a group chat's `chat.style`.
