import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Collection,
  Agent,
  Project,
  Tag,
  Task,
  UpdateAction,
} from '@chronicle.app/schema';

export default class ThingsTodoTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'tasks') {
      actions.push(...this.buildTaskActions(record));
    }

    return actions;
  }

  private buildTaskActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    const task: Task = this.buildTask({
      task: record.data,
      project: record.context.project,
      area: record.context.area,
      heading: record.context.heading,
      tags: record.context.tags,
    });

    const user: Agent = this.buildUser(record.context.agent.name);

    // Always create the initial PlanAction with creation timestamp
    actions.push(
      this.buildAction({
        data: record.data,
        timestamp: record.data.creationDate,
        type: 'PlanAction',
        agentObj: user,
        taskObj: task,
      })
    );

    // If task was edited (modification date differs significantly from creation), create UpdateAction
    const timeDifferenceSeconds = Math.abs(
      record.data.userModificationDate - record.data.creationDate
    );
    const wasEdited = timeDifferenceSeconds > 60; // More than 60 seconds difference indicates an edit

    // Completing/cancelling/trashing a task bumps userModificationDate, which would
    // otherwise emit a redundant UpdateAction alongside the terminal action. Skip the
    // update when the modification just reflects that terminal event.
    const terminalTimestamp =
      record.data.status == 3 || record.data.status == 2
        ? record.data.stopDate
        : record.data.trashed == 1
          ? record.data.userModificationDate
          : undefined;
    const modificationIsTerminal =
      terminalTimestamp !== undefined &&
      Math.abs(record.data.userModificationDate - terminalTimestamp) <= 60;

    if (wasEdited && !modificationIsTerminal) {
      const updateAction: UpdateAction & ActionAndChildren = {
        '@type': 'UpdateAction',
        timestamp: new Date(record.data.userModificationDate * 1000),
        '@key': ['@type', 'source', 'sourceId'],
        source: 'things-todo',
        sourceId: record.data.uuid,
        agent: user,
        object: task,
      };
      actions.push(updateAction);
    }

    if (record.data.status == 3) {
      actions.push(
        this.buildAction({
          data: record.data,
          timestamp: record.data.stopDate,
          type: 'CompleteAction',
          agentObj: user,
          taskObj: task,
        })
      );
    } else if (record.data.status == 2) {
      actions.push(
        this.buildAction({
          data: record.data,
          timestamp: record.data.stopDate,
          type: 'CancelAction',
          agentObj: user,
          taskObj: task,
        })
      );
    }

    if (record.data.trashed == 1) {
      actions.push(
        this.buildAction({
          data: record.data,
          timestamp: record.data.userModificationDate,
          type: 'DeleteAction',
          agentObj: user,
          taskObj: task,
        })
      );
    }

    return actions;
  }

  private buildAction({
    data,
    timestamp,
    type,
    agentObj,
    taskObj,
  }: {
    agentObj: Agent;
    data: any;
    taskObj: Task;
    timestamp: number;
    type: 'PlanAction' | 'CompleteAction' | 'CancelAction' | 'DeleteAction';
  }): ActionAndChildren {
    return {
      '@type': type,
      timestamp: new Date(timestamp * 1000),
      '@key': ['@type', 'source', 'sourceId'],
      source: 'things-todo',
      sourceId: data.uuid,
      agent: agentObj,
      object: taskObj,
    };
  }

  private buildUser(realName: string | undefined): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source'],
      source: 'things-todo',
      name: realName,
      sameAs: ['@me'],
    };
  }

  private buildTask({
    task,
    project,
    area,
    heading,
    tags,
  }: {
    area: any;
    project: any;
    task: any;
    heading?: any;
    tags?: any[];
  }): Task {
    const obj = {
      '@type': 'Task',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'things-todo',
      sourceId: task.uuid,
      name: task.title,
    } as Task;

    if (task.notes) {
      obj.description = task.notes;
    }

    const isPartOf = [];

    if (project) {
      isPartOf.push(this.buildProject(project));
    }

    if (heading) {
      isPartOf.push(this.buildHeading(heading)); // Headings are organizational sections
    }

    if (area) {
      isPartOf.push(this.buildArea(area));
    }

    if (isPartOf.length > 0) {
      obj.isPartOf = isPartOf;
    }

    // Add tags as 'about' entities (representing what the task is about)
    if (tags && tags.length > 0) {
      obj.about = tags.map(
        tag =>
          ({
            '@type': 'Tag' as const,
            '@key': ['@type', 'source', 'sourceId'],
            source: 'things-todo',
            sourceId: tag.uuid,
            handle: tag.title,
            name: tag.title,
          }) as Tag
      );
    }

    return obj;
  }

  private buildProject(project: any): Project {
    return {
      '@type': 'Project',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'things-todo',
      sourceId: project.uuid,
      name: project.title,
    };
  }

  private buildHeading(heading: any): Collection {
    return {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'things-todo',
      sourceId: heading.uuid,
      name: heading.title,
    };
  }

  private buildArea(area: any): Collection {
    return {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'things-todo',
      sourceId: area.uuid,
      name: area.title,
    };
  }
}
