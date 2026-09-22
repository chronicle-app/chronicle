import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { inkInput, InkInputResult } from './InkInput.js';
import { inkSelect, InkSelectResult, SelectOption } from './InkSelect.js';
import { getTheme } from '../theme.js';

export interface PickerStep {
  type: 'input' | 'select';
  field: string;
  prompt: string;
  options?: SelectOption[];
  defaultValue?: string | ((answers: Record<string, any>) => string);
  validate?: (input: string, answers: Record<string, any>) => string | boolean;
}

export interface PickerConfig {
  title?: string;
  steps: PickerStep[];
  onComplete?: (answers: Record<string, any>) => void;
  theme?: string;
}

export interface PickerResult {
  answers: Record<string, any>;
  cancelled: boolean;
}

/**
 * Multi-step form picker using Ink components
 * Supports both input and select steps with validation
 */
export class InkPicker {
  private answers: Record<string, any> = {};
  private currentStep = 0;
  private config: PickerConfig;
  private theme: string;

  constructor(config: PickerConfig) {
    this.config = config;
    this.theme = config.theme || 'default';
  }

  async run(): Promise<PickerResult> {
    try {
      // Show title if provided
      if (this.config.title) {
        console.log(`\n${getTheme(this.theme).info(this.config.title)}\n`);
      }

      // Process each step
      for (let i = 0; i < this.config.steps.length; i++) {
        this.currentStep = i;
        const step = this.config.steps[i];

        // Get default value (can be function of previous answers)
        let { defaultValue } = step;
        if (typeof defaultValue === 'function') {
          defaultValue = defaultValue(this.answers);
        }

        let result: InkInputResult | InkSelectResult;
        let isValid = false;

        // Keep prompting until valid input
        while (!isValid) {
          if (step.type === 'input') {
            result = await inkInput(step.prompt, {
              defaultValue,
              validate: step.validate ? input => step.validate!(input, this.answers) : undefined,
              theme: this.theme,
            });
          } else {
            if (!step.options) {
              throw new Error(`Select step '${step.field}' requires options`);
            }
            result = await inkSelect(step.prompt, step.options, defaultValue, this.theme);
          }

          if (result.cancelled) {
            return { answers: {}, cancelled: true };
          }

          // Additional validation for select steps
          if (step.validate && step.type === 'select') {
            const validationResult = step.validate(result.value, this.answers);
            if (validationResult !== true) {
              console.error(
                `\n${getTheme(this.theme).error('✗')} ${typeof validationResult === 'string' ? validationResult : 'Invalid selection'}\n`
              );
              continue;
            }
          }

          this.answers[step.field] = result.value;
          isValid = true;
        }
      }

      // Call completion callback if provided
      if (this.config.onComplete) {
        this.config.onComplete(this.answers);
      }

      return { answers: this.answers, cancelled: false };
    } catch {
      return { answers: {}, cancelled: true };
    }
  }

  /**
   * Get current answers (useful during validation)
   */
  getAnswers(): Record<string, any> {
    return { ...this.answers };
  }

  /**
   * Get answer for specific field
   */
  getAnswer(field: string): any {
    return this.answers[field];
  }
}

/**
 * Convenience function for simple picker usage
 */
export async function picker(config: PickerConfig): Promise<PickerResult> {
  const pickerInstance = new InkPicker(config);
  return pickerInstance.run();
}

// Re-export types and functions for convenience

export { type SelectOption, type InkSelectResult, inkSelect } from './InkSelect.js';
export { type InkInputResult, inkInput } from './InkInput.js';
