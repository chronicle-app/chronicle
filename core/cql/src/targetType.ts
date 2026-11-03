import { getAllSubtypes } from '@chronicle.app/schema';
import type { ConstraintNode } from './types.js';

/**
 * Properties that mark a query as action-targeted when used as a constraint.
 * `location` is deliberately absent (shared with entities), as are the
 * reverse-lookup predicates (encountered/liked/consuming/completed), which are
 * entity-target by definition.
 */
const ACTION_ROLE_PROPERTIES = new Set(['object', 'agent', 'result', 'instrument', 'target']);

const ACTION_TIME_PROPERTIES = new Set(['timestamp', 'startTime', 'endTime']);

let actionTypes: Set<string> | undefined;

function isActionType(value: string): boolean {
  actionTypes ??= new Set(['Action', ...getAllSubtypes('Action')]);
  // The schema lookup is authoritative; the suffix check keeps detection
  // working for action types the loaded ontology doesn't know about.
  return actionTypes.has(value) || value.endsWith('Action');
}

/**
 * Infer whether a parsed CQL AST targets actions or entities. AST-only
 * equivalent of QueryParser.analyzeContext for callers that receive an AST
 * without parser context (e.g. the persistence query engine).
 */
export function inferQueryTarget(ast: ConstraintNode[]): 'actions' | 'entities' {
  return hasActionConstraint(ast) ? 'actions' : 'entities';
}

function hasActionConstraint(nodes: ConstraintNode[]): boolean {
  for (const node of nodes) {
    switch (node.type) {
      case 'type':
        if (isActionType(node.value)) return true;
        break;
      case 'association':
        if (ACTION_ROLE_PROPERTIES.has(node.property)) return true;
        break;
      case 'property':
        if (ACTION_ROLE_PROPERTIES.has(node.property)) return true;
        if (ACTION_TIME_PROPERTIES.has(node.property)) return true;
        break;
      case 'or':
      case 'and':
        if (hasActionConstraint(node.constraints)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}
