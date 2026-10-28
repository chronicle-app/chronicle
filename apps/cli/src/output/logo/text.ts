/** A terminal style code, like a color or bold, built from a string since it starts with an escape. */
const STYLE = String.raw`\u001B\[[\d;]*m`;
const CODE = new RegExp(STYLE, 'y');
const CODES = new RegExp(STYLE, 'g');

/** Text as a person sees it: without its style codes. */
export const visible = (text: string) => text.replaceAll(CODES, '');

/** How many columns text takes, once its style codes are left out. */
export const visibleWidth = (text: string) => [...visible(text)].length;

/** Text in its pieces: style codes, and characters one at a time. */
function pieces(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  let i = 0;
  while (i < text.length) {
    CODE.lastIndex = i;
    const match = CODE.exec(text);
    if (match) {
      out.push({ code: true, text: match[0] });
      i += match[0].length;
    } else {
      const char = String.fromCodePoint(text.codePointAt(i)!);
      out.push({ code: false, text: char });
      i += char.length;
    }
  }
  return out;
}

/**
 * Lines as typed so far, `count` characters in, a line after another: the
 * rest blank, every style kept, and `head` where the next character goes.
 * Spaces type free, so a line's indent and gaps don't hold it up.
 */
export function typed(lines: string[], count: number, head = ''): string[] {
  let left = count;
  let headed = false;
  return lines.map(line => {
    let out = '';
    for (const piece of pieces(line)) {
      if (piece.code) {
        out += piece.text;
      } else if (piece.text === ' ' && left > 0) {
        out += ' ';
      } else if (left > 0) {
        out += piece.text;
        left--;
      } else if (!headed && head) {
        out += head;
        headed = true;
        break;
      } else {
        break;
      }
    }
    // A line cut short may stop inside a style; it ends there.
    return out.includes('\u001B[') ? `${out}\u001B[0m` : out;
  });
}

/** How many characters typing the lines takes: those that aren't spaces. */
export const typeable = (lines: string[]) =>
  lines.reduce((n, line) => n + [...visible(line)].filter(char => char !== ' ').length, 0);
