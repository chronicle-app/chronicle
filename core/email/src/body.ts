import { htmlToMarkdown, looksLikeHtml, tidyText, withoutInvisible } from '@chronicle.app/etl';
import EmailReplyParser from 'email-reply-parser';

/**
 * What a person wrote in an email, as plain text or Markdown: never the HTML
 * it was sent as, the earlier messages it quotes, or its signature.
 *
 * - The text part, when there's a real one; the HTML part as Markdown when
 *   there isn't, or when the text part is only a stub pointing at it.
 * - Hidden preheader text and images are dropped from HTML: in mail they're
 *   tracking pixels, spacers, and logos, not what anyone wrote.
 * - Quoted history and the signature go, by
 *   [email-reply-parser](https://github.com/crisp-oss/email-reply-parser):
 *   reply headers in many languages, Outlook's quoted blocks, `-- ` and
 *   "Sent from my phone" signatures. A reply links to the message it
 *   answers, so the quote would only store that message again.
 * - Bulk mail (a newsletter, a notification) loses its footer: the
 *   unsubscribe and "you're receiving this" lines at its end.
 * - Then `tidyText`: tracking parameters come off links, and padding
 *   characters go. In bulk mail, click-tracking redirects lose their URL
 *   but keep their words.
 */
export function messageBody(
  parts: { text?: string; html?: string },
  { bulk = false }: { bulk?: boolean } = {}
): string {
  // Some senders put markup in the text part too.
  const raw = withoutInvisible(parts.text ?? '').trim();
  const text = looksLikeHtml(raw) ? emailHtmlToMarkdown(raw) : raw;
  const fromHtml = parts.html ? emailHtmlToMarkdown(parts.html) : '';
  const body = text && !isStub(text, fromHtml) ? text : fromHtml || text;
  const written = withoutReplyHistory(body);
  return bulk ? tidyText(withoutFooter(written), { dropLongUrls: true }) : tidyText(written);
}

/** A text part that only points at the HTML one: short, and saying so, or a sliver of it. */
function isStub(text: string, fromHtml: string): boolean {
  if (!fromHtml) return false;
  const pointsElsewhere =
    /view (this|it|the) (e-?mail|message|newsletter)? ?(online|in (a|your) (web )?browser)|html (version|email)|does not support html|enable html/i;
  return (
    (text.length < 400 && pointsElsewhere.test(text)) ||
    (text.length < 80 && fromHtml.length > text.length * 4)
  );
}

/** Elements hidden from the reader: an email's preheader, and a client's own notes. */
const HIDDEN =
  /<(div|span|p|td|table)\b[^>]*\bstyle\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|max-height\s*:\s*0|mso-hide\s*:\s*all)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;

function emailHtmlToMarkdown(html: string): string {
  const markdown = withoutInvisible(htmlToMarkdown(html.replaceAll(HIDDEN, '')) ?? '');
  // An image in an email is a logo, a spacer, or a tracking pixel.
  return markdown.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
}

/**
 * The text without quoted history or signature. A message that is nothing
 * but a quote, like a forward with no note, keeps what it quotes.
 */
function withoutReplyHistory(body: string): string {
  const visible = new EmailReplyParser().read(body).getVisibleText().trim();
  return visible || body;
}

/** A line that starts a bulk mail's footer. */
const FOOTER =
  /unsubscribe|you('re| are) receiving this|you received this (e-?mail|message)|(manage|update) (your )?(e-?mail |subscription |notification )?(preferences|settings)|no longer (wish|want) to receive|this (e-?mail|message) was sent to|sent to you because|why did i get this/i;

/**
 * A bulk mail without its footer: from the first footer line in its second
 * half on. Only that half is searched, so a newsletter that mentions
 * unsubscribing near its top keeps it; a newsletter's footer, with its
 * addresses, links, and legal lines, can run long.
 */
function withoutFooter(body: string): string {
  const lines = body.split('\n');
  const from = Math.max(1, Math.floor(lines.length / 2));
  for (let i = from; i < lines.length; i++) {
    // A footer line is short; a sentence that mentions unsubscribing isn't one.
    if (lines[i].length <= 160 && FOOTER.test(lines[i])) return lines.slice(0, i).join('\n');
  }
  return body;
}
