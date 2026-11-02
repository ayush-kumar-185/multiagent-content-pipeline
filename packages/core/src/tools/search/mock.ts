import { SearchProvider, SearchResult } from './types.js';

export class MockSearchProvider implements SearchProvider {
  public readonly name = 'mock';
  private customResults: Map<string, SearchResult[]> = new Map();

  constructor(initialPresets?: Record<string, SearchResult[]>) {
    if (initialPresets) {
      for (const [query, results] of Object.entries(initialPresets)) {
        this.customResults.set(query.toLowerCase(), results);
      }
    }
  }

  setResults(query: string, results: SearchResult[]): void {
    this.customResults.set(query.toLowerCase(), results);
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const qLower = query.toLowerCase();

    // Check exact or partial preset match
    for (const [key, results] of this.customResults.entries()) {
      if (qLower.includes(key) || key.includes(qLower)) {
        return results.slice(0, maxResults);
      }
    }

    // Default mock response
    return [
      {
        title: `Official Technical Documentation for ${query}`,
        url: `https://example.com/docs/${encodeURIComponent(query)}`,
        snippet: `Comprehensive overview of ${query} detailing architectural decisions and benchmark results.`,
      },
      {
        title: `Deep Dive into ${query}`,
        url: `https://example.com/deep-dive/${encodeURIComponent(query)}`,
        snippet: `Performance benchmarks, design patterns, and case studies for ${query}.`,
      },
    ].slice(0, maxResults);
  }
}
