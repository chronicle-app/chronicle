import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { getTheme, type ChronicleTheme } from '../theme.js';

interface InkLoaderProps {
  message: string;
  theme?: ChronicleTheme;
  type?: 'dots' | 'line' | 'pipe' | 'simpleDots' | 'simpleDotsScrolling' | 'star' | 'toggle';
  color?: string;
}

const InkLoaderComponent: React.FC<InkLoaderProps> = ({
  message,
  theme,
  type = 'dots',
  color = theme?.primary || 'blue',
}) => (
  <Box>
    <Spinner type={type} />
    <Text color={color || theme?.primary || 'blue'}> {message}</Text>
  </Box>
);

export class InkLoader {
  private app: any = null;
  private message: string;
  private theme?: ChronicleTheme;
  private type: any;
  private color: string;

  constructor(
    message: string,
    options: {
      theme?: string;
      type?: 'dots' | 'line' | 'pipe' | 'simpleDots' | 'simpleDotsScrolling' | 'star' | 'toggle';
      color?: string;
    } = {}
  ) {
    this.message = message;
    this.theme = getTheme(options.theme || 'default');
    this.type = options.type || 'dots';
    this.color = options.color || this.theme?.primary || 'blue';
  }

  start(): InkLoader {
    if (!this.app) {
      this.app = render(
        <InkLoaderComponent
          message={this.message}
          theme={this.theme}
          type={this.type}
          color={this.color}
        />
      );
    }
    return this;
  }

  stop(): InkLoader {
    if (this.app) {
      this.app.unmount();
      this.app = null;
    }
    return this;
  }

  succeed(message?: string): InkLoader {
    this.stop();
    if (message) {
      console.log(`✓ ${message}`);
    }
    return this;
  }

  fail(message?: string): InkLoader {
    this.stop();
    if (message) {
      console.error(`✗ ${message}`);
    }
    return this;
  }

  info(message: string): InkLoader {
    this.stop();
    console.log(`ℹ ${message}`);
    return this;
  }

  warn(message: string): InkLoader {
    this.stop();
    console.warn(`⚠ ${message}`);
    return this;
  }

  text(newMessage: string): InkLoader {
    this.message = newMessage;
    if (this.app) {
      this.stop();
      this.start();
    }
    return this;
  }
}

// Factory function for easy creation
export function inkLoader(
  message: string,
  options?: {
    theme?: string;
    type?: 'dots' | 'line' | 'pipe' | 'simpleDots' | 'simpleDotsScrolling' | 'star' | 'toggle';
    color?: string;
  }
): InkLoader {
  return new InkLoader(message, options);
}
