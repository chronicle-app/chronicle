const NAMED: { [name: string]: string } = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * A tweet's or message's text as its author wrote it. X escapes its text as
 * HTML: `<` and `>` always, `&` since about 2013, and in its first years
 * quotes and other characters too. One pass, so `&amp;lt;` is `&lt;`.
 */
export function unescapeText<T extends string | undefined>(text: T): T {
  if (!text) return text;
  return text.replaceAll(
    /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([\da-f]+));/gi,
    (entity, name?: string, decimal?: string, hex?: string) => {
      if (name) return NAMED[name.toLowerCase()];
      const point = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
      return point <= 0x10_ff_ff ? String.fromCodePoint(point) : entity;
    }
  ) as T;
}
