# Connecting records

Records become useful when they connect: who did something, what it involved, and where it belongs. This guide covers the properties that connect records, with an example for each.

## Who acted, and with what

An action's :agent is the doer, and its :instrument is what they used. The two are kept apart because they answer different questions.

In [an assistant's reply](example:assistant-reply), the :agent is Claude, a :SoftwareAgent, and the :instrument is the model that generated the reply, a :SoftwareApplication. The assistant acted; the model is what it used.

## Messages and attachments

A :MessageAction records a message being sent. Its :object is the :Message, which carries:

- :body, the text.
- :recipient, each agent it was sent to. A group message has several.
- :author, the agent who wrote the content.
- :contains, each attachment.

Attachments are media records: :ImageObject, :AudioObject, :VideoObject, or :DocumentObject. Each locates its content with :contentPath or :url and names its format in :mimeType. See [receiving a message with a photo](example:message-with-photo), [sending a voice message](example:voice-message), and [sharing a video and a PDF with a group](example:group-message-attachments).

## Where things belong

:isPartOf links an entity to a whole that contains it. An entity can be part of several things at once:

- In [completing a to-do](example:task-completed), the task is part of a :Project and of a :Collection, the area it is filed under.
- In [an assistant's reply](example:assistant-reply), the message is part of a :Thread, the conversation, which is itself part of a :Project.

:about links an entity to its subject matter, such as a :Tag on a task.

## One task over time

A source often reports several actions on the same entity. Each action is its own record with its own time, and each carries the entity as its :object:

1. [Creating a to-do](example:task-planned): a :PlanAction.
2. [Editing a to-do](example:task-edited): an :UpdateAction.
3. [Completing a to-do](example:task-completed): a :CompleteAction.

A plan that is dropped instead ends with a [:CancelAction](example:task-cancelled), and an item removed from the source with a [:DeleteAction](example:task-deleted).

Because every action identifies its task with the same key, they all refer to the same task.

Browse [all examples](../examples/index.html), or start from any [class](../classes/index.html).
