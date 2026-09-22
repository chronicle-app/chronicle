import fs from 'node:fs';
import { z } from 'zod';
import { Readable } from 'node:stream';

export const ioFlags = {
  // Note: input flag removed to avoid conflict with ExtractCommand.baseFlags
  // Commands should use ExtractCommand.baseFlags for input flag instead
};

export const IoSchema = z.object({
  filename: z.string().optional(), // Internal property, not exposed as CLI flag
  inputStream: z.instanceof(Readable).optional(), // Internal property, not exposed as CLI flag
});

export const isStdinProvided = (): boolean => {
  const { stdin } = process;
  return !stdin.isTTY || stdin.readableLength > 0;
};

export const createReadStream = (config: z.infer<typeof IoSchema>): Readable => {
  if (config.inputStream) {
    return config.inputStream;
  }

  if (config.filename) {
    return fs.createReadStream(config.filename, 'utf8');
  }

  throw new Error('No input provided');
};

export const configForIo = (flags: any) => {
  const config: z.infer<typeof IoSchema> = {};

  // Handle both array (from ioFlags.input with multiple: true) and string (from ExtractCommand.baseFlags.input)
  const inputValue = Array.isArray(flags.input) ? flags.input[0] : flags.input;

  if (inputValue === '-') {
    if (isStdinProvided()) {
      config.inputStream = process.stdin;
    } else {
      throw new Error('Stdin not provided');
    }
  } else if (inputValue) {
    config.filename = inputValue;
  } else if (isStdinProvided()) {
    // TODO: figure out best practices about stdin without input flags
    config.inputStream = process.stdin;
  } else {
    throw new Error('No input provided');
  }

  return config;
};
