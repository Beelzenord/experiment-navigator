import { CheerioCrawler, PlaywrightCrawler, RequestQueue, Dataset } from 'crawlee';
import { Page } from 'playwright';
import type { CheerioAPI } from 'cheerio';
import type { CrawledData } from './crawler.js';

export interface HybridCrawlerConfig {
  startUrls: string[];
  maxRequestsPerCrawl?: number;
  requestHandlerTimeoutSecs?: number;
  maxConcurrency?: number;
}

export interface HybridCrawlerStats {
  seen: number;              // URLs attempted by Cheerio
  http_ok: number;           // satisfied by Cheerio
  fallback_enqueued: number;  // Cheerio decided to fallback
  js_processed: number;      // processed by Playwright where needsJs===true
  js_rate: number;           // js_processed / (http_ok + js_processed) * 100 rounded
}

export interface ProbeData {
  url: string;
  timestampISO: string;
  serviceTitle?: string;
  provider?: string;
  priceText?: string;
}

/**
 * Critical fields that must all be present for a successful extraction
 */
export const CRITICAL_FIELDS = ['serviceTitle', 'provider', 'priceText'] as const;

/**
 * Shared parsing utilities for both Cheerio and Playwright crawlers
 */
export class ParseUtils {
  /**
   * Extract service title from HTML
   */
  static extractServiceTitle($: CheerioAPI | null, page?: Page): Promise<string | undefined> {
    if ($) {
      // Cheerio path - combined selector query
      const combinedSelector = 'h1, h2:first-of-type, [class*="service-title" i], [class*="service-name" i], [id*="service-title" i], [class*="title" i], [itemprop="name"]';
      const elements = $(combinedSelector);
      
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (text && text.length > 0 && text.length < 200) {
          return Promise.resolve(text);
        }
      }
      return Promise.resolve(undefined);
    }

    // Playwright path - combined selector query
    if (!page) return Promise.resolve(undefined);
    return (async () => {
      const combinedSelector = 'h1, h2:first-of-type, [class*="service-title" i], [class*="service-name" i], [id*="service-title" i], [class*="title" i], [itemprop="name"]';
      try {
        const elements = await page.locator(combinedSelector).all();
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim().length > 0 && text.trim().length < 200) {
            return text.trim();
          }
        }
      } catch {
        // Continue
      }
      return undefined;
    })();
  }

  /**
   * Extract provider from HTML
   */
  static extractProvider($: CheerioAPI | null, page?: Page): Promise<string | undefined> {
    if ($) {
      // Cheerio path - combined selector query
      const combinedSelector = '[class*="provider" i], [id*="provider" i], [class*="company" i], [class*="business" i], [itemprop="provider"], [itemprop="brand"], footer [class*="company" i]';
      const elements = $(combinedSelector);
      
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (text && text.length > 0 && text.length < 200) {
          return Promise.resolve(text);
        }
      }
      return Promise.resolve(undefined);
    }

    // Playwright path - combined selector query
    if (!page) return Promise.resolve(undefined);
    return (async () => {
      const combinedSelector = '[class*="provider" i], [id*="provider" i], [class*="company" i], [class*="business" i], [itemprop="provider"], [itemprop="brand"], footer [class*="company" i]';
      try {
        const elements = await page.locator(combinedSelector).all();
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim().length > 0 && text.trim().length < 200) {
            return text.trim();
          }
        }
      } catch {
        // Continue
      }
      return undefined;
    })();
  }

  /**
   * Extract price text from HTML
   */
  static extractPriceText($: CheerioAPI | null, page?: Page): Promise<string | undefined> {
    if ($) {
      // Cheerio path - combined selector query
      const combinedSelector = '[class*="price" i], [id*="price" i], [data-price], [itemprop="price"], .price, [class*="pris" i]';
      const elements = $(combinedSelector);
      
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (text && text.length > 0 && /\d/.test(text)) {
          return Promise.resolve(text);
        }
      }
      return Promise.resolve(undefined);
    }

    // Playwright path - combined selector query
    if (!page) return Promise.resolve(undefined);
    return (async () => {
      const combinedSelector = '[class*="price" i], [id*="price" i], [data-price], [itemprop="price"], .price, [class*="pris" i]';
      try {
        const elements = await page.locator(combinedSelector).all();
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim().length > 0 && /\d/.test(text.trim())) {
            return text.trim();
          }
        }
      } catch {
        // Continue
      }
      return undefined;
    })();
  }

  /**
   * Check if all critical fields are present (serviceTitle AND provider AND priceText)
   */
  static hasCriticalFields(data: ProbeData): boolean {
    return !!(data.serviceTitle && data.provider && data.priceText);
  }
}

/**
 * Hybrid crawler that uses CheerioCrawler for fast static HTML parsing
 * and falls back to PlaywrightCrawler for JavaScript-heavy pages
 */
export class HybridCrawler {
  private cheerioCrawler!: CheerioCrawler;
  private playwrightCrawler!: PlaywrightCrawler;
  private requestQueue!: RequestQueue;
  private config: Required<HybridCrawlerConfig>;
  private stats: HybridCrawlerStats = {
    seen: 0,
    http_ok: 0,
    fallback_enqueued: 0,
    js_processed: 0,
    js_rate: 0,
  };
  private fallbackUrls: string[] = [];

  constructor(config: HybridCrawlerConfig) {
    this.config = {
      maxRequestsPerCrawl: config.maxRequestsPerCrawl ?? 10,
      requestHandlerTimeoutSecs: config.requestHandlerTimeoutSecs ?? 30,
      maxConcurrency: config.maxConcurrency ?? (Number(process.env.MAX_CONCURRENCY) || 5),
      startUrls: config.startUrls,
    };
  }

  /**
   * Initialize crawlers (called from run())
   */
  private async initializeCrawlers(): Promise<void> {
    // Initialize shared request queue
    const requestQueue = await RequestQueue.open();
    this.requestQueue = requestQueue;

    // Capture variables for handlers - arrow functions close over these (no `this` usage)
    const stats = this.stats;
    const fallbackUrls = this.fallbackUrls;
    const maxRequestsPerCrawl = this.config.maxRequestsPerCrawl;
    const requestHandlerTimeoutSecs = this.config.requestHandlerTimeoutSecs;
    const maxConcurrency = this.config.maxConcurrency;

    // Initialize Cheerio crawler (fast pass)
    // Handler is arrow function that closes over { requestQueue, stats }
    this.cheerioCrawler = new CheerioCrawler({
      requestQueue,
      maxRequestsPerCrawl,
      requestHandler: async ({ request, $ }) => {
        // Increment seen once per request
        stats.seen++;
        const url = request.url;

        try {
          const probeData: ProbeData = {
            url,
            timestampISO: new Date().toISOString(),
          };

          // Extract critical fields using Cheerio
          probeData.serviceTitle = await ParseUtils.extractServiceTitle($, undefined);
          probeData.provider = await ParseUtils.extractProvider($, undefined);
          probeData.priceText = await ParseUtils.extractPriceText($, undefined);

          // Check if critical fields are present
          if (ParseUtils.hasCriticalFields(probeData)) {
            // Critical fields present -> http_ok++
            stats.http_ok++;
            console.log(`[Cheerio] ✓ Extracted from: ${url}`);
            console.log(`  Service Title: ${probeData.serviceTitle || 'N/A'}`);
            console.log(`  Provider: ${probeData.provider || 'N/A'}`);
            console.log(`  Price Text: ${probeData.priceText || 'N/A'}`);
            // ProbeData is for logging/debug only - not pushed to Dataset
          } else {
            // Critical fields missing -> fallback_enqueued++
            // Don't re-enqueue here - we'll add them after Cheerio finishes
            stats.fallback_enqueued++;
            if (fallbackUrls.length < 10) {
              fallbackUrls.push(url);
            }
            console.log(`[Cheerio] Missing critical fields, will fallback to Playwright: ${url}`);
          }
        } catch (error) {
          console.error(`[Cheerio] Error processing ${url}:`, error);
        }
      },
    });

    // Initialize Playwright crawler (fallback)
    // Handler is arrow function that closes over { requestQueue, stats }
    this.playwrightCrawler = new PlaywrightCrawler({
      requestQueue,
      maxRequestsPerCrawl,
      requestHandlerTimeoutSecs,
      maxConcurrency,
      requestHandler: async ({ request, page }) => {
        const url = request.url;
        const needsJs = request.userData?.needsJs === true;

        // If request.userData.needsJs !== true -> return early (do nothing)
        if (!needsJs) {
          return;
        }

        // On handling a needsJs request -> js_processed++
        stats.js_processed++;

        try {
          // Wait for page to load
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

          const data: Partial<CrawledData> = {
            url,
            timestampISO: new Date().toISOString(),
          };

          // Extract critical fields using Playwright
          data.serviceTitle = await ParseUtils.extractServiceTitle(null, page);
          data.provider = await ParseUtils.extractProvider(null, page);
          data.priceText = await ParseUtils.extractPriceText(null, page);

          console.log(`[Playwright] ✓ Extracted (JS fallback): ${url}`);
          await Dataset.pushData(data as CrawledData);
        } catch (error) {
          console.error(`[Playwright] Error processing ${url}:`, error);
        }
      },
      launchContext: {
        launchOptions: {
          headless: true,
        },
      },
      preNavigationHooks: [
        async ({ page }) => {
          // Set User-Agent
          await page.setExtraHTTPHeaders({
            'User-Agent': 'DedoxHybrid/1.0 (+contact@dedox.ai)',
          });

          // Random delay before navigation (200-600ms)
          const delay = Math.floor(Math.random() * 400) + 200;
          await new Promise(resolve => setTimeout(resolve, delay));
        },
        async ({ page }) => {
          // Abort image/font/media/stylesheet requests for politeness
          await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
              route.abort();
            } else {
              route.continue();
            }
          });
        },
      ],
    });
  }

  /**
   * Runs crawlers sequentially: Cheerio first, then Playwright
   */
  async run(): Promise<void> {
    // Initialize crawlers and queue
    await this.initializeCrawlers();

    // Add start URLs to queue (seed URLs for Cheerio to process first)
    for (const url of this.config.startUrls) {
      await this.requestQueue.addRequest({ url });
    }

    // Execute CheerioCrawler first - processes all seed URLs
    console.log('\n[Cheerio] Starting fast pass...');
    await this.cheerioCrawler.run();

    // Validate Cheerio stats: http_ok + fallback_enqueued === seen
    const cheerioTotal = this.stats.http_ok + this.stats.fallback_enqueued;
    if (cheerioTotal !== this.stats.seen) {
      console.warn(`[Warning] Stats mismatch: seen=${this.stats.seen}, http_ok + fallback_enqueued=${cheerioTotal}`);
    }

    // Re-enqueue fallback URLs for Playwright (in case they were skipped by Cheerio)
    // This ensures Playwright has requests to process
    if (this.fallbackUrls.length > 0) {
      console.log(`\n[Hybrid] Re-enqueuing ${this.fallbackUrls.length} fallback URLs for Playwright...`);
      for (const url of this.fallbackUrls) {
        await this.requestQueue.addRequest({
          url,
          uniqueKey: `${url}#js-fallback`,
          userData: { needsJs: true },
        });
      }
    }

    // Execute PlaywrightCrawler after Cheerio finishes - only processes needsJs requests
    console.log('\n[Playwright] Starting JS fallback...');
    await this.playwrightCrawler.run();

    // Compute js_rate = round(js_processed / (http_ok + js_processed) * 100)
    const denominator = this.stats.http_ok + this.stats.js_processed;
    this.stats.js_rate = denominator > 0
      ? Math.round((this.stats.js_processed / denominator) * 100)
      : 0;

    // Log final stats
    this.logStats();
  }

  /**
   * Get current statistics
   */
  getStats(): HybridCrawlerStats {
    return { ...this.stats };
  }

  /**
   * Log statistics
   */
  private logStats(): void {
    console.log('\n📊 Hybrid Crawler Statistics:');
    console.log('─'.repeat(60));
    console.log(`seen:                ${this.stats.seen}`);
    console.log(`http_ok:             ${this.stats.http_ok}`);
    console.log(`fallback_enqueued:   ${this.stats.fallback_enqueued}`);
    console.log(`js_processed:        ${this.stats.js_processed}`);
    console.log(`js_rate:            ${this.stats.js_rate}%`);
    console.log('─'.repeat(60));

    if (this.fallbackUrls.length > 0) {
      console.log('\n🔗 Fallback URLs (max 10):');
      this.fallbackUrls.forEach((url, i) => {
        console.log(`  ${i + 1}. ${url}`);
      });
    }
  }
}
