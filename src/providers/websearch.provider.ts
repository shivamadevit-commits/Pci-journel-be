import { env } from '../config/env';
import { logger } from '../config/logger';

export interface WebSearchResult {
  url: string;
  title: string;
}

/** A search API the plagiarism engine uses to find public pages containing a phrase. Register more with `registerWebSearchProvider`. */
export interface WebSearchProvider {
  readonly name: string;
  search(query: string, count: number): Promise<WebSearchResult[]>;
}

const registry = new Map<string, WebSearchProvider>();
export const registerWebSearchProvider = (p: WebSearchProvider) => registry.set(p.name, p);

registerWebSearchProvider({
  name: 'brave',
  async search(query, count) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-subscription-token': env.BRAVE_SEARCH_API_KEY ?? '' },
      signal: AbortSignal.timeout(env.PLAGIARISM_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Brave Search responded ${res.status}`);
    const json = (await res.json()) as { web?: { results?: Array<{ url?: string; title?: string }> } };
    return (json.web?.results ?? []).flatMap((r) => (r.url ? [{ url: r.url, title: r.title ?? r.url }] : []));
  },
});

/** The configured provider, or undefined when the web layer is disabled (WEB_SEARCH_PROVIDER=none). */
export function getWebSearchProvider(): WebSearchProvider | undefined {
  const p = registry.get(env.WEB_SEARCH_PROVIDER);
  if (!p && env.WEB_SEARCH_PROVIDER !== 'none') logger.warn({ provider: env.WEB_SEARCH_PROVIDER }, 'WEB_SEARCH_PROVIDER has no adapter registered');
  return p;
}
