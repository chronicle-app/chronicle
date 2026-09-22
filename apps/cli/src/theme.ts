import type { Theme } from '@inkjs/ui';
import chalk from 'chalk';

/**
 * Chronicle CLI Theme Configuration
 * Centralized color definitions using Ink's Chalk system for consistency
 */
export interface ChronicleTheme {
  // General UI colors
  primary: string;
  secondary: string;
  accent: string;

  // Status colors (chalk functions for console output)
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  info: (text: string) => string;

  // Text colors (Chalk functions for terminal output)
  text: (text: string) => string;
  textDim: (text: string) => string;
  textBold: (text: string) => string;

  // Color strings for Ink components
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    text: string;
    textDim: string;
    textBold: string;
  };

  // Progress bar colors (chalk functions for console)
  progressComplete: (text: string) => string;
  progressIncomplete: (text: string) => string;
  progressBar: (text: string) => string;

  // JSON syntax highlighting colors (strings for Ink)
  json: {
    StringLiteral: string;
    NumberLiteral: string;
    BooleanLiteral: string;
    NullLiteral: string;
    StringKey: string;
    Whitespace: string;
    Brace: string;
    Bracket: string;
    Colon: string;
    Comma: string;
  };

  // JSON syntax highlighting (chalk objects for console)
  jsonChalk: {
    StringLiteral: typeof chalk.green;
    NumberLiteral: typeof chalk.cyan;
    BooleanLiteral: typeof chalk.yellow;
    NullLiteral: typeof chalk.gray;
    StringKey: typeof chalk.blue;
    Whitespace: typeof chalk.white;
    Brace: typeof chalk.gray;
    Bracket: typeof chalk.gray;
    Colon: typeof chalk.gray;
    Comma: typeof chalk.gray;
  };

  // Logger symbol colors (for ETL integration)
  symbols: {
    info: string;
    warn: string;
    error: string;
  };

  // Ink UI theme integration
  inkTheme: Theme;
}

/**
 * Default Chronicle Theme
 * Professional color scheme using Chalk for consistency with Ink
 */
// Base color definitions - change colors here and they sync everywhere
const baseColors = {
  primary: '#DE4F4F',
  secondary: 'cyan',
  accent: 'green',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: '#DE4F4F',
  text: 'white',
  textDim: 'gray',
  textBold: 'white',
  progress: '#DE4F4F', // Red-orange for progress bars
} as const;

export const defaultTheme: ChronicleTheme = {
  // General UI colors (for top-level usage)
  primary: baseColors.primary,
  secondary: baseColors.secondary,
  accent: baseColors.accent,

  // Status colors (chalk functions for console output)
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,

  // Text colors (Chalk functions for console output)
  text: chalk.white,
  textDim: chalk.gray,
  textBold: chalk.bold.white,

  // Color strings for Ink components (synced with base colors)
  colors: baseColors,

  // Progress bar colors (chalk functions for console)
  progressComplete: chalk.green,
  progressIncomplete: chalk.gray,
  progressBar: chalk.blue,

  // JSON syntax highlighting (strings for Ink)
  json: {
    StringLiteral: 'green', // String values in green
    NumberLiteral: 'cyan', // Numbers in cyan
    BooleanLiteral: 'yellow', // true/false in yellow
    NullLiteral: 'gray', // null in gray
    StringKey: 'blue', // Object keys in blue
    Whitespace: 'white', // Whitespace (default)
    Brace: 'gray', // {} braces dimmed
    Bracket: 'gray', // [] brackets dimmed
    Colon: 'gray', // : colons dimmed
    Comma: 'gray', // , commas dimmed
  },

  // JSON syntax highlighting (chalk functions for console)
  jsonChalk: {
    StringLiteral: chalk.green,
    NumberLiteral: chalk.cyan,
    BooleanLiteral: chalk.yellow,
    NullLiteral: chalk.gray,
    StringKey: chalk.blue,
    Whitespace: chalk.white,
    Brace: chalk.gray,
    Bracket: chalk.gray,
    Colon: chalk.gray,
    Comma: chalk.gray,
  },

  // Logger symbols
  symbols: {
    info: 'blue', // ℹ symbol in blue
    warn: 'yellow', // ⚠ symbol in yellow
    error: 'red', // ❌ symbol in red
  },

  // Ink UI theme
  inkTheme: {
    components: {
      Badge: {
        styles: {
          container({ color }: { color: string }) {
            // Use colored text on default background instead of colored background
            return { color };
          },
          label: () => ({ bold: true }),
        },
      },
      Spinner: {
        styles: {
          container: () => ({}),
          frame: () => ({ color: 'blue' }),
          label: () => ({ color: 'white' }),
        },
      },
      Alert: {
        styles: {
          container: () => ({ padding: 1 }),
          icon: () => ({ color: 'blue' }),
          title: () => ({ color: 'white', bold: true }),
          description: () => ({ color: 'gray' }),
        },
      },
      ProgressBar: {
        styles: {
          container: () => ({}),
          completed: () => ({ color: '#DE4F4F' }),
          remaining: () => ({ color: 'gray' }),
        },
        config: () => ({
          completedCharacter: '▰',
          remainingCharacter: '▱',
        }),
      },
      OrderedList: {
        styles: {
          list: () => ({}),
          listItem: () => ({}),
          marker: () => ({ color: 'blue' }),
          content: () => ({}),
        },
      },
      UnorderedList: {
        styles: {
          list: () => ({}),
          listItem: () => ({}),
          marker: () => ({ color: 'blue' }),
          content: () => ({}),
        },
      },
    },
  },
};

/**
 * Alternative themes for different preferences
 */
export const themes = {
  default: defaultTheme,

  // High contrast theme for better accessibility
  highContrast: {
    ...defaultTheme,
    text: chalk.white,
    textDim: chalk.gray,
    textBold: chalk.bold.white,
    colors: {
      ...baseColors,
      // High contrast overrides
      textDim: 'white', // Less dim for better visibility
    },
    json: {
      StringLiteral: 'green',
      NumberLiteral: 'cyan',
      BooleanLiteral: 'magenta',
      NullLiteral: 'gray',
      StringKey: 'yellow',
      Whitespace: 'white',
      Brace: 'white',
      Bracket: 'white',
      Colon: 'white',
      Comma: 'white',
    },
    jsonChalk: {
      StringLiteral: chalk.green,
      NumberLiteral: chalk.cyan,
      BooleanLiteral: chalk.magenta,
      NullLiteral: chalk.gray,
      StringKey: chalk.yellow,
      Whitespace: chalk.white,
      Brace: chalk.white,
      Bracket: chalk.white,
      Colon: chalk.white,
      Comma: chalk.white,
    },
  } as ChronicleTheme,

  // Minimal theme with reduced colors
  minimal: {
    ...defaultTheme,
    text: chalk.white,
    textDim: chalk.gray,
    textBold: chalk.bold.white,
    colors: {
      ...baseColors,
      // Minimal overrides - less colorful
      secondary: 'white',
      accent: 'white',
    },
    json: {
      StringLiteral: 'white',
      NumberLiteral: 'cyan',
      BooleanLiteral: 'yellow',
      NullLiteral: 'gray',
      StringKey: 'white',
      Whitespace: 'white',
      Brace: 'gray',
      Bracket: 'gray',
      Colon: 'gray',
      Comma: 'gray',
    },
    jsonChalk: {
      StringLiteral: chalk.white,
      NumberLiteral: chalk.cyan,
      BooleanLiteral: chalk.yellow,
      NullLiteral: chalk.gray,
      StringKey: chalk.white,
      Whitespace: chalk.white,
      Brace: chalk.gray,
      Bracket: chalk.gray,
      Colon: chalk.gray,
      Comma: chalk.gray,
    },
  } as ChronicleTheme,
};

/**
 * Get the current theme based on theme name or default
 */
export function getTheme(themeName = 'default'): ChronicleTheme {
  switch (themeName.toLowerCase()) {
    case 'minimal':
      return themes.minimal;
    case 'high-contrast':
    case 'highcontrast':
      return themes.highContrast;
    case 'default':
    default:
      return themes.default;
  }
}

/**
 * Export commonly used theme utilities
 */
export const theme = getTheme();
