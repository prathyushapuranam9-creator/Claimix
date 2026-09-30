import { z } from "zod";

/** Common list query params, parsed leniently from the URL (bad values fall back to defaults). */
export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parseListQuery(params: Record<string, string | string[] | undefined>): ListQuery {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return listQuerySchema.parse(flat);
}

export function offsetOf(q: Pick<ListQuery, "page" | "pageSize">) {
  return (q.page - 1) * q.pageSize;
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Reads a single string param (first value) from Next.js searchParams. */
export function param(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}
