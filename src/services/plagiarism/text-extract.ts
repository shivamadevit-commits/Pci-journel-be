import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { UnprocessableError } from '../../utils/errors';

export type DocumentFormat = 'pdf' | 'docx' | 'txt';

/** Detects the format from magic bytes first (uploads can carry a wrong extension), then falls back to the file name. */
export function detectFormat(buffer: Buffer, fileName?: string): DocumentFormat {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') return 'docx';
  const ext = fileName?.split('.').pop()?.toLowerCase();
  if (ext === 'txt' || ext === 'md') return 'txt';
  if (buffer.subarray(0, 4096).includes(0)) throw new UnprocessableError('Unsupported or unreadable file type. Use PDF, DOCX or TXT.', 'UNREADABLE_DOCUMENT');
  return 'txt';
}

/** Extracts plain text from a PDF, DOCX or TXT buffer. Throws UnprocessableError if the file cannot be read. */
export async function extractText(buffer: Buffer, fileName?: string): Promise<string> {
  if (buffer.length === 0) throw new UnprocessableError('The document is empty.', 'EMPTY_DOCUMENT');
  const format = detectFormat(buffer, fileName);
  try {
    if (format === 'docx') return (await mammoth.extractRawText({ buffer })).value;
    if (format === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        return (await parser.getText()).text;
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    return buffer.toString('utf8');
  } catch (err) {
    throw new UnprocessableError(`The ${format.toUpperCase()} file could not be read: ${(err as Error).message.slice(0, 200)}`, 'UNREADABLE_DOCUMENT');
  }
}
