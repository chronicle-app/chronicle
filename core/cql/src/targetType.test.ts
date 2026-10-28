import { describe, expect, it } from 'vitest';
import { inferQueryTarget } from './targetType.js';
import type { ConstraintNode } from './types.js';

const type = (value: string): ConstraintNode => ({ type: 'type', value });
const assoc = (property: string): ConstraintNode => ({
  type: 'association',
  property,
  constraints: [],
});

describe('inferQueryTarget', () => {
  it('action types root on actions', () => {
    expect(inferQueryTarget([type('ReadAction')])).toBe('actions');
    expect(inferQueryTarget([type('Book')])).toBe('entities');
  });

  it('role constraints root on actions', () => {
    expect(inferQueryTarget([assoc('object')])).toBe('actions');
    expect(inferQueryTarget([assoc('agent')])).toBe('actions');
    expect(inferQueryTarget([assoc('target')])).toBe('actions');
  });

  it('time fields root on actions', () => {
    expect(
      inferQueryTarget([{ type: 'property', property: 'timestamp', operator: 'lt', value: '2020' }])
    ).toBe('actions');
  });

  it('reverse lookups and location stay entity-target', () => {
    expect(inferQueryTarget([assoc('liked')])).toBe('entities');
    expect(inferQueryTarget([assoc('encountered')])).toBe('entities');
    expect(inferQueryTarget([assoc('location')])).toBe('entities');
  });

  it('an action constraint anywhere in an OR flips the query', () => {
    expect(
      inferQueryTarget([
        { type: 'or', constraints: [{ type: 'and', constraints: [type('ReadAction')] }] },
      ])
    ).toBe('actions');
    expect(inferQueryTarget([type('Book')])).toBe('entities');
  });
});
