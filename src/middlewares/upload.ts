import path from 'node:path';
import type { RequestHandler } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { env } from '../config/env';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, ValidationError, type FieldError } from '../utils/errors';

export type FileKind = 'manuscript' | 'pdf' | 'html' | 'report' | 'cv';

export interface UploadField {
  name: string;
  kind: FileKind;
  required?: boolean;
}

export interface UploadSpec {
  fields: UploadField[];
  /** Accept plain JSON bodies too (files stay optional); multipart is only parsed when sent. */
  allowJson?: boolean;
}

export interface UploadedFile {
  field: string;
  kind: FileKind;
  buffer: Buffer;
  size: number;
  originalName: string;
  /** Extension derived from verified content (never from the client MIME type). */
  ext: string;
  mime: string;
}

export type UploadedFiles = Record<string, UploadedFile[]>;

const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024;

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
};

async function isValidDocx(buf: Buffer): Promise<boolean> {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) return false;
  try {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    if (names.length > MAX_ZIP_ENTRIES) return false;
    let total = 0;
    for (const n of names) {
      total += (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      if (/vbaProject\.bin$/i.test(n)) return false; // macro-bearing content is never accepted
    }
    if (total > MAX_ZIP_UNCOMPRESSED) return false; // zip-bomb guard
    return names.includes('[Content_Types].xml') && names.includes('word/document.xml');
  } catch {
    return false;
  }
}

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

function isHtml(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096);
  if (head.includes(0)) return false;
  return /<!doctype\s+html|<html[\s>]/i.test(head.toString('utf8'));
}

/** Detects the real type from file content. Returns the extension or null when the content is not acceptable. */
async function sniff(kind: FileKind, buf: Buffer): Promise<'docx' | 'pdf' | 'html' | null> {
  const allowDocx = kind === 'manuscript' || kind === 'report' || kind === 'cv';
  const allowPdf = kind === 'pdf' || kind === 'report' || kind === 'cv';
  const allowHtml = kind === 'html' || kind === 'report';
  if (allowPdf && isPdf(buf)) return 'pdf';
  if (allowDocx && (await isValidDocx(buf))) return 'docx';
  if (allowHtml && isHtml(buf)) return 'html';
  return null;
}

const KIND_LABEL: Record<FileKind, string> = {
  manuscript: 'a Microsoft Word (.docx) document',
  pdf: 'a PDF document',
  html: 'an HTML document',
  report: 'a PDF, Word (.docx) or HTML report',
  cv: 'a PDF or Word (.docx) document',
};

export function upload(spec: UploadSpec): RequestHandler[] {
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.maxUploadBytes, files: spec.fields.length, fields: 30, fieldSize: 256 * 1024, parts: 40 },
  });
  const parse = m.fields(spec.fields.map((f) => ({ name: f.name, maxCount: 1 })));

  const validate = asyncHandler(async (req, _res, next) => {
    const raw = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const errors: FieldError[] = [];
    const out: UploadedFiles = {};

    for (const f of spec.fields) {
      const file = raw[f.name]?.[0];
      if (!file) {
        if (f.required) errors.push({ field: f.name, message: 'File is required' });
        continue;
      }
      if (file.size === 0) {
        errors.push({ field: f.name, message: 'File is empty' });
        continue;
      }
      const clientExt = path.extname(file.originalname).replace('.', '').toLowerCase();
      const real = await sniff(f.kind, file.buffer);
      if (!real) {
        errors.push({ field: f.name, message: `File must be ${KIND_LABEL[f.kind]}` });
        continue;
      }
      if (f.kind === 'manuscript' && (!env.manuscriptExtensions.includes(real) || clientExt !== real)) {
        errors.push({ field: f.name, message: `Manuscript must be a ${env.manuscriptExtensions.map((e) => `.${e}`).join(' / ')} file` });
        continue;
      }
      if (clientExt && clientExt !== real) {
        errors.push({ field: f.name, message: 'File extension does not match the file content' });
        continue;
      }
      out[f.name] = [{ field: f.name, kind: f.kind, buffer: file.buffer, size: file.size, originalName: path.basename(file.originalname).slice(0, 200), ext: real, mime: MIME[real]! }];
    }
    if (errors.length) throw new ValidationError(errors);
    (req as unknown as { files: UploadedFiles }).files = out;
    next();
  });

  const guard: RequestHandler = (req, _res, next) => {
    if (!req.is('multipart/form-data')) return next(new BadRequestError('Content-Type must be multipart/form-data'));
    next();
  };

  if (spec.allowJson) {
    const onlyMultipart = (h: RequestHandler): RequestHandler => (req, res, next) => (req.is('multipart/form-data') ? h(req, res, next) : next());
    return [parse, validate].map(onlyMultipart);
  }
  return [guard, parse, validate];
}
