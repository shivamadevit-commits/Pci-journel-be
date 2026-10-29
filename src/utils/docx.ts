import JSZip from 'jszip';
import mammoth from 'mammoth';

/** Counts words in the document body text (all text mammoth can extract; headings, tables and references included). */
export async function countDocxWords(buffer: Buffer): Promise<number> {
  const { value } = await mammoth.extractRawText({ buffer });
  const matches = value.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return matches ? matches.length : 0;
}

/**
 * Removes author-identifying metadata from a .docx before it is shown to a reviewer: document properties
 * (creator, last-modified-by, company, manager) and the author/initials of tracked changes and comments.
 * Authors are still asked to submit an anonymised manuscript; this is defence in depth, not a substitute.
 */
export async function scrubDocxMetadata(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  const core = zip.file('docProps/core.xml');
  if (core) {
    let xml = await core.async('string');
    xml = xml
      .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g, '<dc:creator></dc:creator>')
      .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/g, '<cp:lastModifiedBy></cp:lastModifiedBy>')
      .replace(/<dc:title>[\s\S]*?<\/dc:title>/g, '<dc:title></dc:title>')
      .replace(/<dc:subject>[\s\S]*?<\/dc:subject>/g, '<dc:subject></dc:subject>')
      .replace(/<cp:keywords>[\s\S]*?<\/cp:keywords>/g, '<cp:keywords></cp:keywords>')
      .replace(/<dc:description>[\s\S]*?<\/dc:description>/g, '<dc:description></dc:description>');
    zip.file('docProps/core.xml', xml);
  }

  const app = zip.file('docProps/app.xml');
  if (app) {
    let xml = await app.async('string');
    xml = xml.replace(/<Company>[\s\S]*?<\/Company>/g, '<Company></Company>').replace(/<Manager>[\s\S]*?<\/Manager>/g, '<Manager></Manager>');
    zip.file('docProps/app.xml', xml);
  }

  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|comments|footnotes|endnotes|header\d*|footer\d*|people)\.xml$/.test(name)) continue;
    let xml = await zip.file(name)!.async('string');
    xml = xml
      .replace(/\bw:author="[^"]*"/g, 'w:author="Author"')
      .replace(/\bw:initials="[^"]*"/g, 'w:initials=""')
      .replace(/\bw15:userId="[^"]*"/g, 'w15:userId=""');
    zip.file(name, xml);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
