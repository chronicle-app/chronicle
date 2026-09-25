import { Record } from '@chronicle.app/etl';
import { SqliteExtractor, timeRangeConditions } from '@chronicle.app/etl-sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { localAccountName } from './ownerName.js';
import ThingsTodoTransformer from './ThingsTodoTransformer.js';

/**
 * Resolve the Things 3 SQLite database path.
 *
 * Things stores its data under a per-install directory whose name is
 * `ThingsData-XXXXX` (the suffix is unique to each installation), so the path
 * cannot be hardcoded. Glob the Group Containers directory for the
 * `ThingsData-*` folder and return the database inside it.
 */
function resolveThingsDbPath(): string {
  const containerDir = `${process.env.HOME}/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac`;
  const dbSuffix = 'Things Database.thingsdatabase/main.sqlite';

  if (existsSync(containerDir)) {
    const thingsDataDirs = readdirSync(containerDir).filter(name => name.startsWith('ThingsData-'));
    for (const dir of thingsDataDirs) {
      const dbPath = join(containerDir, dir, dbSuffix);
      if (existsSync(dbPath)) {
        return dbPath;
      }
    }
  }

  // Fall back to the conventional location so the error message is meaningful
  // when Things is not installed.
  return join(containerDir, 'ThingsData', dbSuffix);
}

interface TMTaskRow {
  uuid: string;
  title: string;
  type: number;
  status: number;
  creationDate?: number;
  startDate?: number;
  stopDate?: number;
  userModificationDate?: number;
  project?: string;
  heading?: string;
  area?: string;
  notes?: string;
  trashed?: number;
  tag_ids?: string;
  tag_titles?: string;
}

export class ThingsTodoExtractor extends SqliteExtractor<typeof ThingsTodoExtractor> {
  static override source = 'things-todo';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  // Re-reads current task state, so attributes (name, status) are sighted at
  // read time — not back-dated to the creation/modification timestamps the
  // actions carry. Lets a rename supersede cleanly instead of colliding with the
  // old name at the creation instant. See Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override description = 'Tasks and projects';
  static override recordTypes: string[] = ['tasks', 'projects'];
  static override default = true;
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .describe('The db file to read from')
      .default(() => resolveThingsDbPath()),
    agentName: z
      .string()
      .optional()
      .describe("Name of the task owner. Defaults to the OS account's full name"),
  }) as any;

  static override defaultTransformer = ThingsTodoTransformer;

  /** The owner's name from the local machine, used when `agentName` isn't set. */
  protected resolveAgentName(): string | undefined {
    return localAccountName();
  }

  private getStatusLabel(status: number): string {
    switch (status) {
      case 0:
        return 'open';
      case 2:
        return 'cancelled';
      case 3:
        return 'completed';
      default:
        return 'unknown';
    }
  }

  override async *extract(): AsyncGenerator<Record> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const limit = this.getEffectiveLimit();
    const { conditions, values } = timeRangeConditions('task.userModificationDate', this.config, {
      sinceOp: '>=',
      untilOp: '<=',
    });
    let sql = `SELECT task.*, group_concat(DISTINCT tag.uuid) AS tag_ids,
      group_concat(DISTINCT tag.title) AS tag_titles FROM TMTask task
      LEFT JOIN TMTaskTag tagging ON task.uuid = tagging.tasks
      LEFT JOIN TMTag tag ON tagging.tags = tag.uuid
      WHERE task.type IN (0, 1, 2)`;
    if (conditions.length > 0) sql += ' AND ' + conditions.join(' AND ');
    sql += ' GROUP BY task.uuid ORDER BY task.userModificationDate DESC, task.uuid';
    if (limit !== null) {
      sql += ' LIMIT ?';
      values.push(limit);
    }
    const rows = this.db.prepare(sql).all(...values) as unknown as TMTaskRow[];
    const agentName = this.config.agentName ?? this.resolveAgentName();

    // Get enriched areas and projects with nested data
    const areaIds = [...new Set(rows.map(row => row.area))].filter(Boolean) as string[];
    const enrichedAreas = await this.getEnrichedAreas(areaIds);

    // Get both direct projects and headings (which can also be projects)
    const directProjectIds = [...new Set(rows.map(row => row.project))].filter(Boolean) as string[];
    const headingIds = [...new Set(rows.map(row => row.heading))].filter(Boolean) as string[];
    const allProjectIds = [...new Set([...directProjectIds, ...headingIds])];
    const enrichedProjects = this.getEnrichedProjects(allProjectIds);

    // Get tag hierarchies for all tags used
    const allTagIds = rows
      .map(row => row.tag_ids)
      .filter(Boolean)
      .join(',')
      .split(',')
      .filter(Boolean);
    const tagHierarchies = this.getTagHierarchies([...new Set(allTagIds)]);

    for (const row of rows) {
      const recordType = row.type === 1 || row.type === 2 ? 'projects' : 'tasks';

      // Convert timestamps to dates
      const timeline = {
        createdAt: row.creationDate ? new Date(row.creationDate * 1000) : null,
        startedAt: row.startDate ? new Date(row.startDate * 1000) : null,
        completedAt: row.stopDate ? new Date(row.stopDate * 1000) : null,
        status: this.getStatusLabel(row.status),
        lastModifiedAt: row.userModificationDate ? new Date(row.userModificationDate * 1000) : null,
      };

      // Build enriched tags array with hierarchies
      const taskTagIds = row.tag_ids ? row.tag_ids.split(',') : [];
      const taskTagTitles = row.tag_titles ? row.tag_titles.split(',') : [];
      const enrichedTags = taskTagIds.map((tagId: string, index: number) => {
        const hierarchy = tagHierarchies.get(tagId);
        return {
          uuid: tagId,
          title: taskTagTitles[index] || null,
          shortcut: hierarchy?.shortcut || null,
          hierarchy: hierarchy
            ? {
                parent: hierarchy.parent,
                children: hierarchy.children,
                path: hierarchy.path,
                level: hierarchy.level,
              }
            : null,
          lastUsedAt: hierarchy?.lastUsedAt || null,
        };
      });

      // Determine the project relationship
      let projectRelation = null;
      let headingRelation = null;

      // If task has a direct project, use that
      if (row.project) {
        projectRelation = enrichedProjects.get(row.project);
      }
      // If task has a heading, the heading might belong to a project
      else if (row.heading) {
        const heading = enrichedProjects.get(row.heading);
        if (heading) {
          headingRelation = {
            uuid: heading.uuid,
            title: heading.title,
            type: heading.type,
          };
          // If the heading belongs to a project, use that project
          if (heading.project) {
            projectRelation = enrichedProjects.get(heading.project);
          }
        }
      }

      yield this.createRecord(row, {
        recordType,
        timeline,
        project: projectRelation,
        heading: headingRelation,
        area: row.area ? enrichedAreas.get(row.area) || null : null,
        tags: enrichedTags,
        agent: { name: agentName },
      });
    }
  }

  private async getEnrichedAreas(areaIds: string[]): Promise<Map<string, any>> {
    const enrichedAreas = new Map();

    if (areaIds.length === 0) return enrichedAreas;

    const areas = this.db!.prepare(
      `SELECT area.*,
      group_concat(DISTINCT area_tag.tags) AS area_tag_ids,
      group_concat(DISTINCT tag.title) AS area_tag_titles,
      COUNT(DISTINCT task.uuid) AS task_count,
      COUNT(DISTINCT project.uuid) AS project_count
      FROM TMArea area
      LEFT JOIN TMAreaTag area_tag ON area.uuid = area_tag.areas
      LEFT JOIN TMTag tag ON area_tag.tags = tag.uuid
      LEFT JOIN TMTask task ON area.uuid = task.area AND task.type IN (0, 1)
      LEFT JOIN TMTask project ON area.uuid = project.area AND project.type = 2
      WHERE area.uuid IN (${areaIds.map(() => '?').join(',')}) GROUP BY area.uuid
    `
    ).all(...areaIds);

    for (const area of areas) {
      const areaData = area as any;
      const areaTagIds = areaData.area_tag_ids ? areaData.area_tag_ids.split(',') : [];
      const areaTagTitles = areaData.area_tag_titles ? areaData.area_tag_titles.split(',') : [];

      const tags = areaTagIds.map((id: string, index: number) => ({
        uuid: id,
        title: areaTagTitles[index] || null,
      }));

      enrichedAreas.set(areaData.uuid, {
        ...areaData,
        tags,
        metrics: {
          taskCount: Number.parseInt(areaData.task_count) || 0,
          projectCount: Number.parseInt(areaData.project_count) || 0,
        },
      });
    }

    return enrichedAreas;
  }

  private getEnrichedProjects(projectIds: string[]): Map<string, any> {
    const enrichedProjects = new Map();

    if (projectIds.length === 0) return enrichedProjects;

    const query = `
      SELECT 
        project.*,
        area.title as area_title,
        area.uuid as area_uuid,
        COUNT(DISTINCT task.uuid) as task_count,
        COUNT(DISTINCT completed_task.uuid) as completed_task_count
      FROM TMTask project
      LEFT JOIN TMArea area ON project.area = area.uuid
      LEFT JOIN TMTask task ON (project.uuid = task.project OR project.uuid = task.heading) AND task.type IN (0, 1)
      LEFT JOIN TMTask completed_task ON (project.uuid = completed_task.project OR project.uuid = completed_task.heading) AND completed_task.type IN (0, 1) AND completed_task.status = 3
      WHERE project.uuid IN (${projectIds.map(() => '?').join(',')}) AND project.type IN (1, 2)
      GROUP BY project.uuid
    `;

    const projects = this.db!.prepare(query).all(...projectIds);

    for (const project of projects) {
      const projectData = project as any;
      enrichedProjects.set(projectData.uuid, {
        ...projectData,
        area: projectData.area_uuid
          ? {
              uuid: projectData.area_uuid,
              title: projectData.area_title,
            }
          : null,
        metrics: {
          totalTasks: Number.parseInt(projectData.task_count) || 0,
          completedTasks: Number.parseInt(projectData.completed_task_count) || 0,
          progress:
            projectData.task_count > 0
              ? projectData.completed_task_count / projectData.task_count
              : 0,
        },
      });
    }

    return enrichedProjects;
  }

  private getTagHierarchies(tagIds: string[]): Map<string, any> {
    const tagHierarchies = new Map();

    if (tagIds.length === 0) return tagHierarchies;

    // Get all tags with their parent relationships
    const query = `
      SELECT 
        tag.*,
        parent.title as parent_title,
        group_concat(DISTINCT child.uuid) as child_ids,
        group_concat(DISTINCT child.title) as child_titles
      FROM TMTag tag
      LEFT JOIN TMTag parent ON tag.parent = parent.uuid
      LEFT JOIN TMTag child ON tag.uuid = child.parent
      WHERE tag.uuid IN (${tagIds.map(() => '?').join(',')})
      GROUP BY tag.uuid
      ORDER BY tag.title
    `;

    const tags = this.db!.prepare(query).all(...tagIds);

    // Build hierarchical paths
    const buildPath = (tagId: string, visited = new Set()): string => {
      if (visited.has(tagId)) return ''; // Prevent cycles
      visited.add(tagId);

      const tag = tags.find((t: any) => t.uuid === tagId);
      if (!tag) return '';

      const tagData = tag as any;
      if (tagData.parent) {
        const parentPath = buildPath(tagData.parent, visited);
        return parentPath ? `${parentPath} > ${tagData.title}` : tagData.title;
      }
      return tagData.title;
    };

    for (const tag of tags) {
      const tagData = tag as any;
      const childIds = tagData.child_ids ? tagData.child_ids.split(',') : [];
      const childTitles = tagData.child_titles ? tagData.child_titles.split(',') : [];

      const children = childIds.map((id: string, index: number) => ({
        uuid: id,
        title: childTitles[index] || null,
      }));

      const path = buildPath(tagData.uuid);
      const level = path.split(' > ').length - 1;

      tagHierarchies.set(tagData.uuid, {
        uuid: tagData.uuid,
        title: tagData.title,
        shortcut: tagData.shortcut,
        lastUsedAt: tagData.usedDate ? new Date(tagData.usedDate * 1000) : null,
        parent: tagData.parent
          ? {
              uuid: tagData.parent,
              title: tagData.parent_title,
            }
          : null,
        children,
        path,
        level,
      });
    }

    return tagHierarchies;
  }
}
