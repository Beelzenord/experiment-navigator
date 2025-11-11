import { PlaywrightCrawler, Dataset } from 'crawlee';
import { Page } from 'playwright';

export interface CrawledData {
  url: string;
  policy?: string;
  terms?: string;
  prices?: string[];
  availability?: string;
  timestamp?: Date; // Deprecated, use timestampISO
  timestampISO?: string; // ISO string timestamp
  metadata?: {
    title?: string;
    description?: string;
    headings?: string[];
    structuredData?: Record<string, unknown>;
  };
  // Critical fields for hybrid crawler
  serviceTitle?: string;
  provider?: string;
  priceText?: string;
}

export interface CrawlerConfig {
  startUrls: string[];
  maxRequestsPerCrawl?: number;
  requestHandlerTimeoutSecs?: number;
}

/**
 * Base crawler class for extracting policy, terms, prices, and availability
 */
export class WebsiteCrawler {
  private crawler: PlaywrightCrawler;
  private config: Required<CrawlerConfig>;

  constructor(config: CrawlerConfig) {
    this.config = {
      maxRequestsPerCrawl: config.maxRequestsPerCrawl ?? 10,
      requestHandlerTimeoutSecs: config.requestHandlerTimeoutSecs ?? 30,
      startUrls: config.startUrls,
    };

    const extractDataBound = this.extractData.bind(this);
    this.crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: this.config.maxRequestsPerCrawl,
      requestHandlerTimeoutSecs: this.config.requestHandlerTimeoutSecs,
      async requestHandler({ page, request }) {
        const data = await extractDataBound(page, request.url);
        await Dataset.pushData(data);
      },
    });
  }

  /**
   * Extracts policy, terms, prices, and availability from a page
   */
  protected async extractData(page: Page, url: string): Promise<CrawledData> {
    const data: CrawledData = {
      url,
      timestamp: new Date(),
    };

    try {
      // Wait for page to be fully loaded
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Extract metadata first (title, description, headings, structured data)
      data.metadata = await this.extractMetadata(page);

      // Extract policy (look for policy/privacy links or content)
      data.policy = await this.extractPolicy(page);

      // Extract terms (look for terms/conditions links or content)
      data.terms = await this.extractTerms(page);

      // Extract prices (look for price elements)
      data.prices = await this.extractPrices(page);

      // Extract availability (look for availability/stock information)
      data.availability = await this.extractAvailability(page);
    } catch (error) {
      console.error(`Error extracting data from ${url}:`, error);
    }

    return data;
  }

  /**
   * Extracts policy information from the page
   * Broad search for policy/privacy content including links, sections, and full text
   */
  protected async extractPolicy(page: Page): Promise<string | undefined> {
    const policyTexts: string[] = [];

    // Broad selector patterns for policy/privacy
    const linkSelectors = [
      'a[href*="policy" i]',
      'a[href*="privacy" i]',
      'a[href*="gdpr" i]',
      'a[href*="dataskydd" i]', // Swedish
      'a[href*="integritet" i]', // Swedish
      'a[href*="cookie" i]',
      'a[href*="sekretess" i]', // Swedish
    ];

    const contentSelectors = [
      '[class*="policy" i]',
      '[id*="policy" i]',
      '[class*="privacy" i]',
      '[id*="privacy" i]',
      '[class*="gdpr" i]',
      '[id*="gdpr" i]',
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      '[class*="dataskydd" i]',
      '[id*="dataskydd" i]',
      '[class*="integritet" i]',
      '[id*="integritet" i]',
      'section[class*="policy" i]',
      'section[id*="policy" i]',
      'div[class*="policy" i]',
      'div[id*="policy" i]',
      '[role="dialog"][class*="cookie" i]',
      '[role="dialog"][class*="privacy" i]',
    ];

    // Extract from links (get text and href)
    for (const selector of linkSelectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const element of elements) {
          const text = await element.textContent();
          const href = await element.getAttribute('href');
          if (text && text.trim().length > 0) {
            policyTexts.push(`${text.trim()}${href ? ` (${href})` : ''}`);
          }
        }
      } catch {
        // Continue if selector fails
      }
    }

    // Extract full content from policy-related sections
    for (const selector of contentSelectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const element of elements) {
          const text = await element.textContent();
          if (text) {
            const trimmed = text.trim();
            // Only include substantial content (more than just a few words)
            if (trimmed.length > 20) {
              policyTexts.push(trimmed);
            }
          }
        }
      } catch {
        // Continue if selector fails
      }
    }

    // Also search in page text for policy-related keywords
    try {
      const bodyText = await page.locator('body').textContent();
      if (bodyText) {
        const policyKeywords = [
          /privacy\s+policy[^.]{0,500}/gi,
          /dataskyddspolicy[^.]{0,500}/gi,
          /integritetspolicy[^.]{0,500}/gi,
          /cookie\s+policy[^.]{0,500}/gi,
          /gdpr[^.]{0,500}/gi,
        ];

        for (const pattern of policyKeywords) {
          const matches = bodyText.match(pattern);
          if (matches) {
            policyTexts.push(...matches.map(m => m.trim()));
          }
        }
      }
    } catch {
      // Continue if extraction fails
    }

    // Return combined text, deduplicated
    const uniqueTexts = [...new Set(policyTexts)];
    return uniqueTexts.length > 0 ? uniqueTexts.join('\n\n') : undefined;
  }

  /**
   * Extracts terms information from the page
   * Broad search for terms/conditions content including links, sections, and full text
   */
  protected async extractTerms(page: Page): Promise<string | undefined> {
    const termsTexts: string[] = [];

    // Broad selector patterns for terms/conditions
    const linkSelectors = [
      'a[href*="terms" i]',
      'a[href*="condition" i]',
      'a[href*="villkor" i]', // Swedish
      'a[href*="användarvillkor" i]', // Swedish
      'a[href*="köpvillkor" i]', // Swedish
      'a[href*="leveransvillkor" i]', // Swedish
      'a[href*="service" i]',
      'a[href*="agreement" i]',
      'a[href*="legal" i]',
    ];

    const contentSelectors = [
      '[class*="terms" i]',
      '[id*="terms" i]',
      '[class*="condition" i]',
      '[id*="condition" i]',
      '[class*="villkor" i]',
      '[id*="villkor" i]',
      '[class*="användarvillkor" i]',
      '[id*="användarvillkor" i]',
      '[class*="köpvillkor" i]',
      '[id*="köpvillkor" i]',
      '[class*="legal" i]',
      '[id*="legal" i]',
      'section[class*="terms" i]',
      'section[id*="terms" i]',
      'div[class*="terms" i]',
      'div[id*="terms" i]',
      'footer a[href*="terms" i]',
      'footer a[href*="villkor" i]',
    ];

    // Extract from links
    for (const selector of linkSelectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const element of elements) {
          const text = await element.textContent();
          const href = await element.getAttribute('href');
          if (text && text.trim().length > 0) {
            termsTexts.push(`${text.trim()}${href ? ` (${href})` : ''}`);
          }
        }
      } catch {
        // Continue if selector fails
      }
    }

    // Extract full content from terms-related sections
    for (const selector of contentSelectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const element of elements) {
          const text = await element.textContent();
          if (text) {
            const trimmed = text.trim();
            if (trimmed.length > 20) {
              termsTexts.push(trimmed);
            }
          }
        }
      } catch {
        // Continue if selector fails
      }
    }

    // Search in page text for terms-related keywords
    try {
      const bodyText = await page.locator('body').textContent();
      if (bodyText) {
        const termsKeywords = [
          /terms\s+and\s+conditions[^.]{0,500}/gi,
          /användarvillkor[^.]{0,500}/gi,
          /köpvillkor[^.]{0,500}/gi,
          /leveransvillkor[^.]{0,500}/gi,
          /service\s+terms[^.]{0,500}/gi,
        ];

        for (const pattern of termsKeywords) {
          const matches = bodyText.match(pattern);
          if (matches) {
            termsTexts.push(...matches.map(m => m.trim()));
          }
        }
      }
    } catch {
      // Continue if extraction fails
    }

    const uniqueTexts = [...new Set(termsTexts)];
    return uniqueTexts.length > 0 ? uniqueTexts.join('\n\n') : undefined;
  }

  /**
   * Extracts price information from the page
   * Comprehensive search for prices including structured data, attributes, and text patterns
   */
  protected async extractPrices(page: Page): Promise<string[]> {
    const prices: string[] = [];

    // Broad selector patterns for prices
    const selectors = [
      '[class*="price" i]',
      '[id*="price" i]',
      '[data-price]',
      '[data-price-value]',
      '[itemprop="price"]',
      '[itemprop="priceCurrency"]',
      '.price',
      '[class*="cost" i]',
      '[class*="pris" i]', // Swedish
      '[id*="pris" i]', // Swedish
      '[class*="prislista" i]', // Swedish
      '[class*="prisinformation" i]', // Swedish
      '[class*="prisuppgift" i]', // Swedish
      '[class*="amount" i]',
      '[class*="value" i]',
      '[class*="pricing" i]',
      '[class*="fee" i]',
      '[class*="charge" i]',
      '[class*="rate" i]',
      '[class*="tariff" i]',
      '[class*="quote" i]',
      '[class*="estimate" i]',
      '[data-testid*="price" i]',
      '[aria-label*="price" i]',
      '[aria-label*="pris" i]',
    ];

    // Extract from selectors
    for (const selector of selectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const element of elements) {
          // Try text content
          const text = await element.textContent();
          if (text) {
            const priceText = text.trim();
            if (this.isPriceLike(priceText)) {
              prices.push(priceText);
            }
          }

          // Try data attributes
          const dataPrice = await element.getAttribute('data-price') || 
                          await element.getAttribute('data-price-value');
          if (dataPrice && this.isPriceLike(dataPrice)) {
            prices.push(dataPrice);
          }

          // Try itemprop content
          const itempropPrice = await element.getAttribute('content');
          if (itempropPrice && this.isPriceLike(itempropPrice)) {
            prices.push(itempropPrice);
          }
        }
      } catch {
        // Continue if selector fails
      }
    }

    // Extract from structured data (JSON-LD)
    try {
      const jsonLdScripts = await page.locator('script[type="application/ld+json"]').all();
      for (const script of jsonLdScripts) {
        const content = await script.textContent();
        if (content) {
          try {
            const data = JSON.parse(content);
            const extracted = this.extractPricesFromStructuredData(data);
            prices.push(...extracted);
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    } catch {
      // Continue if extraction fails
    }

    // Extract price patterns from page text
    try {
      const bodyText = await page.locator('body').textContent();
      if (bodyText) {
        // Match various price patterns
        const pricePatterns = [
          /[\$€£¥₹]\s*\d+[\d,.\s]*/g,
          /\d+[\d,.\s]*\s*[\$€£¥₹]/g,
          /\d+[\d,.\s]*\s*(kr|sek|SEK|USD|EUR|GBP)/gi,
          /från\s*[\$€£¥₹]?\s*\d+[\d,.\s]*/gi, // Swedish "from X"
          /pris[:\s]+[\$€£¥₹]?\s*\d+[\d,.\s]*/gi, // Swedish "price: X"
        ];

        for (const pattern of pricePatterns) {
          const matches = bodyText.match(pattern);
          if (matches) {
            prices.push(...matches.map(m => m.trim()));
          }
        }
      }
    } catch {
      // Continue if extraction fails
    }

    return [...new Set(prices)]; // Remove duplicates
  }

  /**
   * Helper to check if text looks like a price
   */
  private isPriceLike(text: string): boolean {
    if (!text || text.length < 2) return false;
    // Must contain numbers
    return /\d/.test(text);
  }

  /**
   * Extract prices from structured data (JSON-LD, microdata)
   */
  private extractPricesFromStructuredData(data: unknown, prices: string[] = []): string[] {
    if (typeof data !== 'object' || data === null) return prices;

    if (Array.isArray(data)) {
      for (const item of data) {
        this.extractPricesFromStructuredData(item, prices);
      }
      return prices;
    }

    const obj = data as Record<string, unknown>;
    
    // Check common price fields
    const priceFields = ['price', 'priceCurrency', 'lowPrice', 'highPrice', 'offers', 'priceRange'];
    for (const field of priceFields) {
      if (field in obj) {
        const value = obj[field];
        if (typeof value === 'string' && this.isPriceLike(value)) {
          prices.push(value);
        } else if (typeof value === 'number') {
          prices.push(value.toString());
        } else if (typeof value === 'object' && value !== null) {
          this.extractPricesFromStructuredData(value, prices);
        }
      }
    }

    // Recursively search nested objects
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        this.extractPricesFromStructuredData(value, prices);
      }
    }

    return prices;
  }

  /**
   * Extracts availability information from the page
   * Comprehensive search for stock/availability information
   */
  protected async extractAvailability(page: Page): Promise<string | undefined> {
    const availabilityTexts: string[] = [];

    // Broad selector patterns for availability
    const selectors = [
      '[class*="availability" i]',
      '[id*="availability" i]',
      '[class*="stock" i]',
      '[id*="stock" i]',
      '[class*="lager" i]', // Swedish
      '[id*="lager" i]', // Swedish
      '[class*="tillgänglig" i]', // Swedish
      '[id*="tillgänglig" i]', // Swedish
      '[class*="in-stock" i]',
      '[class*="out-of-stock" i]',
      '[class*="in-stock" i]',
      '[class*="available" i]',
      '[class*="unavailable" i]',
      '[class*="sold-out" i]',
      '[class*="slut" i]', // Swedish "sold out"
      '[class*="slutsåld" i]', // Swedish "sold out"
      '[data-availability]',
      '[data-stock]',
      '[data-in-stock]',
      '[itemprop="availability"]',
      '[itemprop="inStock"]',
      '[aria-label*="stock" i]',
      '[aria-label*="availability" i]',
      '[aria-label*="lager" i]',
    ];

    // Extract from selectors
    for (const selector of selectors) {
      try {
        const elements = await page.locator(selector).all();
        for (const element of elements) {
          const text = await element.textContent();
          if (text) {
            const trimmed = text.trim();
            if (trimmed.length > 0) {
              availabilityTexts.push(trimmed);
            }
          }

          // Check data attributes
          const dataAttr = await element.getAttribute('data-availability') ||
                          await element.getAttribute('data-stock') ||
                          await element.getAttribute('data-in-stock');
          if (dataAttr) {
            availabilityTexts.push(dataAttr);
          }

          // Check itemprop content
          const itemprop = await element.getAttribute('content');
          if (itemprop) {
            availabilityTexts.push(itemprop);
          }
        }
      } catch {
        // Continue if selector fails
      }
    }

    // Search in page text for availability keywords
    try {
      const bodyText = await page.locator('body').textContent();
      if (bodyText) {
        const availabilityKeywords = [
          /(i\s+)?lager[^.]{0,100}/gi, // Swedish "in stock"
          /tillgänglig[^.]{0,100}/gi, // Swedish "available"
          /slutsåld[^.]{0,100}/gi, // Swedish "sold out"
          /in\s+stock[^.]{0,100}/gi,
          /out\s+of\s+stock[^.]{0,100}/gi,
          /available[^.]{0,100}/gi,
          /unavailable[^.]{0,100}/gi,
          /sold\s+out[^.]{0,100}/gi,
          /på\s+lager[^.]{0,100}/gi, // Swedish "in stock"
        ];

        for (const pattern of availabilityKeywords) {
          const matches = bodyText.match(pattern);
          if (matches) {
            availabilityTexts.push(...matches.map(m => m.trim()));
          }
        }
      }
    } catch {
      // Continue if extraction fails
    }

    const uniqueTexts = [...new Set(availabilityTexts)];
    return uniqueTexts.length > 0 ? uniqueTexts.join('; ') : undefined;
  }

  /**
   * Extracts metadata from the page (title, description, headings, structured data)
   */
  protected async extractMetadata(page: Page): Promise<CrawledData['metadata']> {
    const metadata: CrawledData['metadata'] = {};

    try {
      // Extract title
      const title = await page.title();
      if (title) metadata.title = title;

      // Extract meta description
      const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
      if (metaDescription) metadata.description = metaDescription;

      // Extract headings (h1-h6)
      const headings: string[] = [];
      for (const level of [1, 2, 3, 4, 5, 6]) {
        try {
          const headingElements = await page.locator(`h${level}`).all();
          for (const element of headingElements) {
            const text = await element.textContent();
            if (text && text.trim().length > 0) {
              headings.push(text.trim());
            }
          }
        } catch {
          // Continue if extraction fails
        }
      }
      if (headings.length > 0) metadata.headings = headings;

      // Extract structured data (JSON-LD)
      try {
        const jsonLdScripts = await page.locator('script[type="application/ld+json"]').all();
        const structuredData: Record<string, unknown>[] = [];
        for (const script of jsonLdScripts) {
          const content = await script.textContent();
          if (content) {
            try {
              const data = JSON.parse(content);
              structuredData.push(data);
            } catch {
              // Invalid JSON, skip
            }
          }
        }
        if (structuredData.length > 0) {
          metadata.structuredData = structuredData as unknown as Record<string, unknown>;
        }
      } catch {
        // Continue if extraction fails
      }
    } catch {
      // Return what we have
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Runs the crawler
   */
  async run(): Promise<void> {
    await this.crawler.run(this.config.startUrls);
  }

  /**
   * Gets the crawler instance (for advanced usage)
   */
  getCrawler(): PlaywrightCrawler {
    return this.crawler;
  }
}

