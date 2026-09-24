# Connecting records

This guide covers the properties that link records to each other, with an example for each.

## Agent and instrument

An action's :agent is who did it, and its :instrument is what they used.

In [an assistant's reply](example:assistant-reply), the :agent is Claude, a :SoftwareAgent, and the :instrument is the model that generated the reply, a :SoftwareApplication.

## Messages and attachments

A :MessageAction records a message being sent. Its :object is the :Message, which has:

- :body, the text
- :recipient, each agent it was sent to
- :author, the agent who wrote it
- :contains, each attachment

An attachment is an :ImageObject, :AudioObject, :VideoObject, or :DocumentObject. Its content is located by :contentPath or :url, and its format is in :mimeType. See [receiving a message with a photo](example:message-with-photo), [sending a voice message](example:voice-message), and [sharing a video and a PDF with a group](example:group-message-attachments).

## isPartOf and about

:isPartOf links an entity to something that contains it. An entity can have more than one:

- In [completing a to-do](example:task-completed), the task is part of a :Project and of a :Collection for its area.
- In [an assistant's reply](example:assistant-reply), the message is part of a :Thread, and the thread is part of a :Project.

:about links an entity to its subject, such as a :Tag on a task.

## Several actions on one entity

A source can report several actions on the same entity. Each action is a separate record with its own timestamp and the entity as its :object. A to-do can have:

1. A :PlanAction when it is created ([example](example:task-planned)).
2. An :UpdateAction when it is edited ([example](example:task-edited)).
3. A :CompleteAction when it is done ([example](example:task-completed)).

A cancelled to-do has a :CancelAction ([example](example:task-cancelled)), and one moved to the trash has a :DeleteAction ([example](example:task-deleted)).

All of these actions use the same key for the task, so they refer to the same task.

See [all examples](../examples/index.html) or [all classes](../classes/index.html).
