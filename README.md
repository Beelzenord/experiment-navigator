# Scrawlers

Web crawlers for extracting policy, terms, prices, and availability from websites.

## Tech Stack

- TypeScript (strict mode)
- Node.js 20+
- Crawlee
- Playwright
- pnpm
- ESM

## Installation

```bash
pnpm install
npx playwright install
```

## Usage

```typescript
import { WebsiteCrawler } from './src/crawler.js';

const crawler = new WebsiteCrawler({
  startUrls: ['https://example.com'],
  maxRequestsPerCrawl: 10,
});

await crawler.run();
```

## Testing on a Website

To test the crawler on a specific website (e.g., https://spolosug.se/):

```bash
pnpm test-crawl
```

Results will be saved in `storage/default/datasets/default/` directory.

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
```

## Features

- Extracts policy information
- Extracts terms and conditions
- Extracts prices
- Extracts availability/stock information

