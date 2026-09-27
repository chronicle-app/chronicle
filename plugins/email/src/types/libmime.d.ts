declare module 'libmime' {
  export class Libmime {
    decodeWords(input: string): string;
    decodeWord(input: string): string;
    encodeWords(input: string): string;
    decodeHeader(input: string): string;
  }
}
