import { SearchProvider, SearchResult } from './types.js';

export interface BraveSearchOptions {
  apiKey?: string;
  customFetch?: typeof fetch;
}

export class BraveSearchProvider implements SearchProvider {
  public readonly name = 'brave';
  private readonly apiKey: string;
  private readonly customFetch: typeof fetch;

  constructor(options: BraveSearchOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY ?? '';
    this.customFetch = options.customFetch ?? fetch;

    if (!this.apiKey) {
      throw new Error('BraveSearchProvider requires BRAVE_SEARCH_API_KEY');
    }
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(maxResults));

    const response = await this.customFetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Brave search API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>;
      };
    };

    return (data.web?.results ?? []).map((item) => ({
      title: item.title ?? 'Untitled',
      url: item.url ?? '',
      snippet: item.description ?? '',
    }));
  }
}
