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
 * Schema for the entire configuration file
 */
export const ConfigSchema = z.object({
  version: z.string().default('1.0'),
  global: z.record(z.any()).optional(),
  presets: z.record(PresetConfigSchema).optional(),
});

export type PresetConfig = z.infer<typeof PresetConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default configuration structure
 */
export const DEFAULT_CONFIG: Config = {
  version: '1.0',
  global: {},
  presets: {},
};
