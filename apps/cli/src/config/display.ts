import type { Definition, Tokens } from '../output/index.js';
import type { PresetConfig } from './schema.js';

/** A setting's value as it reads: strings bare, anything else as JSON. */
export const valueText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value);

/** Flags as they'd be typed: `--limit 5 --loader table`. */
export function typedFlags(flags: Record<string, unknown>): string {
  return Object.entries(flags)
    .map(([name, value]) => {
      if (value === true) return `--${name}`;
      if (value === false) return `--no-${name}`;
      const text = valueText(value);
      return `--${name} ${/^[\w.,:/@+-]+$/.test(text) ? text : JSON.stringify(text)}`;
    })
    .join(' ');
}

/** Presets by name: the flags each sets, then what it's for. */
export function presetDefinitions(presets: Record<string, PresetConfig>, t: Tokens): Definition[] {
  return Object.keys(presets)
    .sort()
    .map(name => ({
      term: [[name, t.command]],
      text: [`\`${typedFlags(presets[name].flags)}\``, presets[name].description]
        .filter(Boolean)
        .join('\n'),
    }));
}
