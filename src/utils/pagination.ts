import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const skipTake = (p: { page: number; pageSize: number }) => ({ skip: (p.page - 1) * p.pageSize, take: p.pageSize });

export const pageMeta = (p: { page: number; pageSize: number }, total: number): PageMeta => ({
  page: p.page,
  pageSize: p.pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
});

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

/** Builds a sort schema restricted to a whitelist so clients can never order by arbitrary columns. */
export function sortSchema<const T extends readonly [string, ...string[]]>(fields: T, defaultField: T[number]) {
  return z.object({
    sortBy: z.enum(fields).default(defaultField),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  });
}
