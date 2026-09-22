// handle 5s, 10m, etc.
export function parseDuration(duration: string): number | typeof Number.NaN {
  const match = duration.match(/^(\d+)([dhmswy])$/); // Added 'w', 'm', 'y'
  if (!match) {
    return Number.NaN;
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': {
      return value * 1000;
    }

    case 'm': {
      return value * 1000 * 60;
    }

    case 'h': {
      return value * 1000 * 60 * 60;
    }

    case 'd': {
      return value * 1000 * 60 * 60 * 24;
    }

    case 'w': {
      return value * 1000 * 60 * 60 * 24 * 7;
    }

    case 'mo': {
      return value * 1000 * 60 * 60 * 24 * 30;
    }

    case 'y': {
      return value * 1000 * 60 * 60 * 24 * 365;
    }

    default: {
      throw new Error(`Invalid duration unit: ${unit}`);
    }
  }
}

/** Compact relative age for status lines: 42s ago, 5m ago, 3h ago, 2d ago. */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
