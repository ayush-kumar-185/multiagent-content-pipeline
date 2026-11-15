import fs from 'fs';
import path from 'path';
import { fetchPage } from '../packages/core/src/tools/fetch/fetchPage.js';

async function cachePages() {
  const urls = [
    'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
    'https://www.geeksforgeeks.org/typescript/typescript-5-0-updates-what-s-new',
    'https://blog.logrocket.com/exploring-typescript-5-features-smaller-simpler-faster',
  ];

  console.log('Fetching and caching Topic 1 pages...');
  const pages = [];
  for (const url of urls) {
    const res = await fetchPage(url);
    pages.push({
      url,
      title: res.title,
      rawText: res.rawText,
      wrappedText: res.wrappedText,
    });
    console.log(`  Cached: ${url} (${res.rawText.length} chars)`);
  }

  const outPath = path.resolve(process.cwd(), 'token-audit/topic1-cached-pages.json');
  fs.writeFileSync(outPath, JSON.stringify(pages, null, 2));
  console.log(`Saved cached pages to ${outPath}`);
}

cachePages().catch(console.error);

