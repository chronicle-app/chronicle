import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { ConfigSchema, DEFAULT_CONFIG } from './schema.js';
import type { Config, PresetConfig } from './schema.js';

/**
 * Manages Chronicle configuration files and presets
 */
export class ConfigManager {
  private configPath: string;

  constructor(configDir: string) {
    // Use OCLIF's config directory
    this.configPath = join(configDir, 'config.json');
  }

  /**
   * Load the configuration file
   */
  async loadConfig(): Promise<Config> {
    try {
      const configText = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(configText);
      return ConfigSchema.parse(config);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Config file doesn't exist, return defaults
        return DEFAULT_CONFIG;
      }
      // If config is invalid, return default and log warning
      console.warn('Invalid configuration file, using defaults:', error);
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save the configuration file
   */
  async saveConfig(config: Config): Promise<void> {
    const validatedConfig = ConfigSchema.parse(config);

    // Ensure config directory exists
    await fs.mkdir(dirname(this.configPath), { recursive: true });

    // Write config file with proper formatting
    await fs.writeFile(
      this.configPath,
      JSON.stringify(validatedConfig, null, 2),
      { mode: 0o600 } // Restrict to user read/write only
    );
  }

  /**
   * Get a specific preset by name
   */
  async getPreset(name: string): Promise<PresetConfig | null> {
    const config = await this.loadConfig();
    return config.presets?.[name] || null;
  }

  /**
   * Save a preset to the configuration
   */
  async savePreset(
    name: string,
    preset: Omit<PresetConfig, 'name' | 'created' | 'modified'>
  ): Promise<void> {
    const config = await this.loadConfig();

    if (!config.presets) {
      config.presets = {};
    }

    const existingPreset = config.presets[name];
    const now = new Date().toISOString();

    config.presets[name] = {
      name,
      description: preset.description,
      flags: preset.flags,
      created: existingPreset?.created || now,
      modified: now,
    };

    await this.saveConfig(config);
  }

  /**
   * Delete a preset from the configuration
   */
  async deletePreset(name: string): Promise<boolean> {
    const config = await this.loadConfig();

    if (!config.presets?.[name]) {
      return false;
    }

    delete config.presets[name];
    await this.saveConfig(config);
    return true;
  }

  /**
   * List all preset names
   */
  async listPresets(): Promise<string[]> {
    const config = await this.loadConfig();
    return Object.keys(config.presets || {});
  }

  /**
   * Get a global configuration value
   */
  async getGlobalValue(key: string): Promise<any> {
    const config = await this.loadConfig();
    return config.global?.[key];
  }

  /**
   * Set a global configuration value
   */
  async setGlobalValue(key: string, value: any): Promise<void> {
    const config = await this.loadConfig();

    if (!config.global) {
      config.global = {};
    }

    config.global[key] = value;
    await this.saveConfig(config);
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfig(): Promise<void> {
    await this.saveConfig(DEFAULT_CONFIG);
  }

  /**
   * Get the configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if the configuration file exists
   */
  async configExists(): Promise<boolean> {
    try {
      await fs.access(this.getConfigPath());
      return true;
    } catch {
      return false;
    }
  }
}
