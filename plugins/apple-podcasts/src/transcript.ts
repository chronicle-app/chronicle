import { decodeEntities, tokenizeHtml } from '@chronicle.app/etl';

/**
 * The text of a transcript Apple Podcasts made of an episode, from its TTML.
 * Each `<p>` is one speaker's turn and becomes a paragraph. Its words are
 * spans with no space between them, so the text in a turn is joined with
 * spaces. Timings and the speaker labels (`SPEAKER_1`) are left out. Empty
 * when the transcript has no words.
 */
export function transcriptText(ttml: string): string {
  const paragraphs: string[] = [];
  let words: string[] | null = null;
  for (const token of tokenizeHtml(ttml)) {
    if (token.kind === 'open' && token.name === 'p') {
      words = [];
    } else if (token.kind === 'close' && token.name === 'p') {
      if (words && words.length > 0) paragraphs.push(words.join(' '));
      words = null;
    } else if (token.kind === 'text' && words) {
      const text = decodeEntities(token.value).replaceAll(/\s+/g, ' ').trim();
      if (text) words.push(text);
    }
  }
  return paragraphs.join('\n\n');
}
