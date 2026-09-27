declare module 'emailjs-addressparser' {
  export interface ParsedAddress {
    name?: string;
    address: string;
  }

  function parse(input: string): ParsedAddress[];
  export default parse;
}
