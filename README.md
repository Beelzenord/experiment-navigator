# Scrawlers

Web crawlers for extracting policy, terms, prices, and availability from websites.

## Tech Stack

- TypeScript (strict mode)
- Node.js 20+
- Crawlee
- Playwright
- Cheerio (via Crawlee)
- pnpm
- ESM

## Installation

```bash
pnpm install
npx playwright install
```

## Usage

### Basic Crawler (Playwright)

```typescript
import { WebsiteCrawler } from './src/crawler.js';

const crawler = new WebsiteCrawler({
  startUrls: ['https://example.com'],
  maxRequestsPerCrawl: 10,
});

await crawler.run();
```

### Hybrid Crawler (Cheerio + Playwright)

The hybrid crawler uses CheerioCrawler for fast static HTML parsing and automatically falls back to PlaywrightCrawler for JavaScript-heavy pages.

```typescript
import { HybridCrawler } from './src/hybrid.js';

const crawler = new HybridCrawler({
  startUrls: ['https://example.com'],
  maxRequestsPerCrawl: 10,
});

await crawler.run();

// Get statistics
const stats = crawler.getStats();
console.log(`JS Fallback Rate: ${stats.js_rate}%`);
```

**Features:**
- Fast CheerioCrawler for static HTML (fast pass)
- Automatic fallback to PlaywrightCrawler when critical fields are missing
- Shared RequestQueue between both crawlers
- Statistics tracking (total, http_ok, js_fallback, js_rate)
- Critical fields: service title, provider, price text

## Testing on a Website

### Basic Crawler

```bash
pnpm test-crawl
```

### Hybrid Crawler

```bash
pnpm test-hybrid
```

Results will be saved in `storage/datasets/default/` directory.

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Run
pnpm start

# Test crawl on a website
pnpm test-crawl

# Test hybrid crawler
pnpm test-hybrid
```

## Features

- Extracts policy information
- Extracts terms and conditions
- Extracts prices
- Extracts availability/stock information
- Hybrid crawling with automatic JS fallback
- Statistics and logging
- Swedish language support
