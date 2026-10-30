import { z } from 'zod';

/**
 * Schema for individual preset configurations
 */
export const PresetConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  flags: z.record(z.any()),
  created: z.string().datetime(),
  modified: z.string().datetime().optional(),
});

/**
 * Something `chronicle setup` extracts: a source and the flags that say what
 * to read, as `chronicle extract` takes them. Never the run's own (`since`,
 * `limit`, `loader`, the output), and never a credential.
 */
export const TargetSchema = z.object({ source: z.string(), flags: z.record(z.any()).default({}) });

/**
 * Schema for the entire configuration file
 */
export const ConfigSchema = z.object({
  version: z.string().default('1.0'),
  global: z.record(z.any()).optional(),
  presets: z.record(PresetConfigSchema).optional(),
  /** Absolute paths of plugins added with `chronicle plugins add`. */
  plugins: z.array(z.string()).optional(),
  /** What `chronicle setup` extracts. */
  targets: z.array(TargetSchema).optional(),
  /** The folders `chronicle setup` looks in for exports. */
  folders: z.array(z.string()).optional(),
  /** What `chronicle setup` found and was left unpicked, so it stays unpicked. */
  skipped: z.array(TargetSchema).optional(),
  /** Exports asked for and not here yet, with when. */
  requested: z.array(TargetSchema.extend({ at: z.string().datetime() })).optional(),
  /** Sources picked to add that need a step first, like a sign-in, and how each is read. */
  wanted: z.array(z.object({ source: z.string(), strategy: z.string() })).optional(),
  /** When each of setup's todos was last put off, by its key: they come after the rest. */
  later: z.record(z.string().datetime()).optional(),
});

export type PresetConfig = z.infer<typeof PresetConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type Target = z.infer<typeof TargetSchema>;

/**
 * Default configuration structure
 */
export const DEFAULT_CONFIG: Config = {
  version: '1.0',
  global: {},
  presets: {},
};
