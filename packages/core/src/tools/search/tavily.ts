import { SearchProvider, SearchResult } from './types.js';

export interface TavilySearchOptions {
  apiKey?: string;
  customFetch?: typeof fetch;
}

export class TavilySearchProvider implements SearchProvider {
  public readonly name = 'tavily';
  private readonly apiKey: string;
  private readonly customFetch: typeof fetch;

  constructor(options: TavilySearchOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TAVILY_API_KEY ?? '';
    this.customFetch = options.customFetch ?? fetch;

    if (!this.apiKey) {
      throw new Error('TavilySearchProvider requires TAVILY_API_KEY');
    }
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const response = await this.customFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily search API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    return (data.results ?? []).map((item) => ({
      title: item.title ?? 'Untitled',
      url: item.url ?? '',
      snippet: item.content ?? '',
    }));
  }
}
