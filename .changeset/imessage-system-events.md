---
'@chronicle.app/imessage': patch
---

The iMessage plugin leaves out Messages' system events, such as a group being renamed or someone joining it. Messages keeps them as rows beside the messages, with no text and often no sender, so they were extracted as empty messages, and one with no sender stopped its transform. A survey doesn't count them either. A message whose sender's handle is gone from `chat.db` has no `agent`, rather than stopping its transform.
