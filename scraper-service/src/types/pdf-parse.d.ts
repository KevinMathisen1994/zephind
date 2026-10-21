// pdf-parse ships no types, and the lib entry (not the package root — see
// pdfToText in src/services/mailIngest.ts) has no @types package at all.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
  }
  export default function pdfParse(data: Buffer): Promise<PdfParseResult>;
}
