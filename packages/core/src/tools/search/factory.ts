import { SearchProvider } from './types.js';
import { TavilySearchProvider } from './tavily.js';
import { BraveSearchProvider } from './brave.js';
import { MockSearchProvider } from './mock.js';

export interface SearchFactoryOptions {
  provider?: string;
  apiKey?: string;
}

export function createSearchProvider(options: SearchFactoryOptions = {}): SearchProvider {
  const chosenProvider = (
    options.provider ??
    process.env.SEARCH_PROVIDER ??
    (process.env.TAVILY_API_KEY ? 'tavily' : process.env.BRAVE_SEARCH_API_KEY ? 'brave' : 'mock')
  ).toLowerCase();

  if (chosenProvider === 'tavily') {
    try {
      return new TavilySearchProvider({ apiKey: options.apiKey });
    } catch {
      // Fallback if key missing
      return new MockSearchProvider();
    }
  }

  if (chosenProvider === 'brave') {
    try {
      return new BraveSearchProvider({ apiKey: options.apiKey });
    } catch {
      // Fallback if key missing
      return new MockSearchProvider();
    }
  }

  return new MockSearchProvider();
}
