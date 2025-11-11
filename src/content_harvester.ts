import { CheerioCrawler, PlaywrightCrawler, RequestQueue, Dataset } from 'crawlee';
import { Page } from 'playwright';
import type { CheerioAPI } from 'cheerio';
import { z } from 'zod';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { createHash } from 'crypto';

// Zod schema for ContentDoc
const ContentDocSchema = z.object({
  url: z.string(),
  fetched_at: z.string(), // ISO
  http_status: z.number().optional(),
  content_type: z.string().optional(),
  canonical_url: z.string().optional(),
  lang: z.string().optional(),
  title: z.string().optional(),
  meta_description: z.string().optional(),
  og: z.record(z.string(), z.string()).default({}),
  meta: z.record(z.string(), z.string()).default({}),
  main_text: z.string().optional(),
  all_text_excerpt: z.string().optional(),
  headings: z.object({
    h1: z.array(z.string()).default([]),
    h2: z.array(z.string()).default([]),
    h3: z.array(z.string()).default([]),
  }).default({ h1: [], h2: [], h3: [] }),
  text_blocks: z.array(z.string()).default([]),
  jsonld: z.array(z.unknown()).default([]),
  microdata_present: z.boolean().optional(),
  schema_types: z.array(z.string()).default([]),
  links: z.object({
    internal: z.array(z.string()).default([]),
    external: z.array(z.string()).default([]),
    canonicalized: z.boolean().default(false),
  }).default({ internal: [], external: [], canonicalized: false }),
  contacts: z.object({
    emails: z.array(z.string()).default([]),
    phones: z.array(z.string()).default([]),
  }).optional(),
  evidence: z.array(z.string()).default([]),
  dom_stats: z.object({
    words: z.number(),
    chars: z.number(),
    node_count: z.number(),
  }),
  html_hash: z.string(),
  render_mode: z.enum(['http', 'js']),
});

export type ContentDoc = z.infer<typeof ContentDocSchema>;

export interface ContentHarvesterConfig {
  startUrls: string[];
  maxRequestsPerCrawl?: number;
  httpConcurrency?: number;
  jsConcurrency?: number;
}

// Utility functions
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.substring(0, maxLen) : str;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeUrl(url: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(url, base);
    // Remove fragment
    resolved.hash = '';
    return resolved.href;
  } catch {
    return url;
  }
}

function extractEmails(text: string): string[] {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const matches = text.match(emailRegex) || [];
  return [...new Set(matches)].filter(e => e.length < 100); // Sanity check
}

function extractPhones(text: string): string[] {
  // Match phone-like patterns (Swedish + international)
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
  const matches = text.match(phoneRegex) || [];
  return [...new Set(matches)].slice(0, 20); // Limit
}

function findPriceLike(text: string): string | undefined {
  // Look for price patterns: numbers with currency symbols or "kr", "sek", etc.
  const pricePattern = /[\d\s.,]+(?:kr|sek|€|\$|£|:-)/i;
  const match = text.match(pricePattern);
  return match ? truncate(match[0], 400) : undefined;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Extract text using Readability (Cheerio path)
function extractMainTextWithReadability(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url, contentType: 'text/html' });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article && article.textContent) {
      return normalizeWhitespace(article.textContent);
    }
  } catch {
    // Fallback to manual extraction
  }
  return null;
}

// Fallback: extract largest text blocks
function extractLargestTextBlocks($: CheerioAPI, maxBlocks: number = 5): string[] {
  const blocks: Array<{ text: string; length: number }> = [];
  
  // Try main/article/[role=main] first
  const mainSelectors = ['main', 'article', '[role="main"]'];
  for (const selector of mainSelectors) {
    $(selector).each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text.length > 100) {
        blocks.push({ text, length: text.length });
      }
    });
  }
  
  // Fallback to largest paragraphs/divs
  if (blocks.length === 0) {
    $('p, div').each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text.length > 200) {
        blocks.push({ text, length: text.length });
      }
    });
  }
  
  // Sort by length and take top N
  blocks.sort((a, b) => b.length - a.length);
  return blocks.slice(0, maxBlocks).map(b => truncate(b.text, 2000));
}

// Extract headings
function extractHeadings($: CheerioAPI | null, page?: Page): Promise<{ h1: string[]; h2: string[]; h3: string[] }> {
  if ($) {
    // Cheerio path
    const h1: string[] = [];
    const h2: string[] = [];
    const h3: string[] = [];
    
    $('h1').each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text) h1.push(text);
    });
    $('h2').each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text) h2.push(text);
    });
    $('h3').each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text) h3.push(text);
    });
    
    return Promise.resolve({
      h1: [...new Set(h1)],
      h2: [...new Set(h2)],
      h3: [...new Set(h3)],
    });
  }
  
  // Playwright path
  if (!page) return Promise.resolve({ h1: [], h2: [], h3: [] });
  
  return (async () => {
    const h1: string[] = [];
    const h2: string[] = [];
    const h3: string[] = [];
    
    const h1Elements = await page.locator('h1').all();
    for (const el of h1Elements) {
      const text = await el.textContent();
      if (text) h1.push(normalizeWhitespace(text));
    }
    
    const h2Elements = await page.locator('h2').all();
    for (const el of h2Elements) {
      const text = await el.textContent();
      if (text) h2.push(normalizeWhitespace(text));
    }
    
    const h3Elements = await page.locator('h3').all();
    for (const el of h3Elements) {
      const text = await el.textContent();
      if (text) h3.push(normalizeWhitespace(text));
    }
    
    return {
      h1: [...new Set(h1)],
      h2: [...new Set(h2)],
      h3: [...new Set(h3)],
    };
  })();
}

// Extract JSON-LD
function extractJsonLd($: CheerioAPI | null, page?: Page): Promise<unknown[]> {
  if ($) {
    // Cheerio path
    const jsonld: unknown[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).text();
        const parsed = JSON.parse(text);
        const stringified = JSON.stringify(parsed);
        if (stringified.length <= 150000) {
          jsonld.push(parsed);
        }
      } catch {
        // Skip invalid JSON
      }
    });
    return Promise.resolve(jsonld);
  }
  
  // Playwright path
  if (!page) return Promise.resolve([]);
  
  return (async () => {
    const jsonld: unknown[] = [];
    const scripts = await page.locator('script[type="application/ld+json"]').all();
    for (const script of scripts) {
      try {
        const text = await script.textContent();
        if (text) {
          const parsed = JSON.parse(text);
          const stringified = JSON.stringify(parsed);
          if (stringified.length <= 150000) {
            jsonld.push(parsed);
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }
    return jsonld;
  })();
}

// Extract schema types from JSON-LD
function extractSchemaTypes(jsonld: unknown[]): string[] {
  const types = new Set<string>();
  function traverse(obj: unknown): void {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        const record = obj as Record<string, unknown>;
        if (record['@type'] && typeof record['@type'] === 'string') {
          types.add(record['@type']);
        }
        Object.values(record).forEach(traverse);
      }
    }
  }
  jsonld.forEach(traverse);
  return Array.from(types);
}

// Extract links
function extractLinks($: CheerioAPI | null, page: Page | undefined, baseUrl: string): Promise<{
  internal: string[];
  external: string[];
  canonicalized: boolean;
}> {
  const baseDomain = extractDomain(baseUrl);
  const internal: string[] = [];
  const external: string[] = [];
  
  if ($) {
    // Cheerio path
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const normalized = normalizeUrl(href, baseUrl);
        const domain = extractDomain(normalized);
        if (domain === baseDomain) {
          internal.push(normalized);
        } else if (domain) {
          external.push(normalized);
        }
      }
    });
    
    return Promise.resolve({
      internal: [...new Set(internal)].slice(0, 200),
      external: [...new Set(external)].slice(0, 200),
      canonicalized: true,
    });
  }
  
  // Playwright path
  if (!page) return Promise.resolve({ internal: [], external: [], canonicalized: false });
  
  return (async () => {
    const links = await page.locator('a[href]').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href) {
        const normalized = normalizeUrl(href, baseUrl);
        const domain = extractDomain(normalized);
        if (domain === baseDomain) {
          internal.push(normalized);
        } else if (domain) {
          external.push(normalized);
        }
      }
    }
    
    return {
      internal: [...new Set(internal)].slice(0, 200),
      external: [...new Set(external)].slice(0, 200),
      canonicalized: true,
    };
  })();
}

// Extract metadata (title, meta, og)
function extractMetadata($: CheerioAPI | null, page?: Page): Promise<{
  title?: string;
  meta_description?: string;
  lang?: string;
  canonical_url?: string;
  og: Record<string, string>;
  meta: Record<string, string>;
}> {
  if ($) {
    // Cheerio path
    const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || undefined;
    const meta_description = $('meta[name="description"]').attr('content') || 
                            $('meta[property="og:description"]').attr('content') || undefined;
    const lang = $('html').attr('lang') || undefined;
    const canonical_url = $('link[rel="canonical"]').attr('href') || undefined;
    
    const og: Record<string, string> = {};
    $('meta[property^="og:"]').each((_, el) => {
      const property = $(el).attr('property');
      const content = $(el).attr('content');
      if (property && content) {
        og[property] = content;
      }
    });
    
    const meta: Record<string, string> = {};
    const metaKeys = ['keywords', 'author', 'viewport', 'robots', 'theme-color', 'apple-mobile-web-app-title'];
    $('meta[name]').each((_, el) => {
      const name = $(el).attr('name');
      const content = $(el).attr('content');
      if (name && content && metaKeys.includes(name) && Object.keys(meta).length < 20) {
        meta[name] = content;
      }
    });
    
    return Promise.resolve({ title, meta_description, lang, canonical_url, og, meta });
  }
  
  // Playwright path
  if (!page) return Promise.resolve({ og: {}, meta: {} });
  
  return (async () => {
    const title = await page.title() || await page.locator('meta[property="og:title"]').getAttribute('content') || undefined;
    const meta_description = await page.locator('meta[name="description"]').getAttribute('content') ||
                            await page.locator('meta[property="og:description"]').getAttribute('content') || undefined;
    const lang = await page.locator('html').getAttribute('lang') || undefined;
    const canonical_url = await page.locator('link[rel="canonical"]').getAttribute('href') || undefined;
    
    const og: Record<string, string> = {};
    const ogMetas = await page.locator('meta[property^="og:"]').all();
    for (const meta of ogMetas) {
      const property = await meta.getAttribute('property');
      const content = await meta.getAttribute('content');
      if (property && content) {
        og[property] = content;
      }
    }
    
    const meta: Record<string, string> = {};
    const metaKeys = ['keywords', 'author', 'viewport', 'robots', 'theme-color', 'apple-mobile-web-app-title'];
    const metaElements = await page.locator('meta[name]').all();
    for (const el of metaElements) {
      const name = await el.getAttribute('name');
      const content = await el.getAttribute('content');
      if (name && content && metaKeys.includes(name) && Object.keys(meta).length < 20) {
        meta[name] = content;
      }
    }
    
    return { title, meta_description, lang, canonical_url, og, meta };
  })();
}

// Extract all visible text (for all_text_excerpt)
function extractAllText($: CheerioAPI | null, page?: Page): Promise<string> {
  if ($) {
    // Cheerio path - exclude script, style, noscript
    const body = $('body').clone();
    body.find('script, style, noscript').remove();
    const text = normalizeWhitespace(body.text());
    return Promise.resolve(truncate(text, 15000));
  }
  
  // Playwright path
  if (!page) return Promise.resolve('');
  
  return (async () => {
    const text = await page.evaluate(() => {
      const body = document.body.cloneNode(true) as HTMLElement;
      const scripts = body.querySelectorAll('script, style, noscript');
      scripts.forEach(el => el.remove());
      return body.innerText || '';
    });
    return truncate(normalizeWhitespace(text), 15000);
  })();
}

// Extract evidence
function extractEvidence(mainText: string, allText: string): string[] {
  const evidence: string[] = [];
  
  // First price-like string
  const price = findPriceLike(allText);
  if (price) evidence.push(price);
  
  // First 400 chars of main text (hero section)
  if (mainText) {
    evidence.push(truncate(mainText, 400));
  }
  
  // Terms/policy keywords
  const keywords = ['terms', 'policy', 'privacy', 'cookie', 'villkor', 'integritet'];
  const lowerText = allText.toLowerCase();
  for (const keyword of keywords) {
    const index = lowerText.indexOf(keyword);
    if (index !== -1) {
      const snippet = allText.substring(Math.max(0, index - 50), index + 200);
      evidence.push(truncate(normalizeWhitespace(snippet), 400));
      break; // Only first match
    }
  }
  
  return evidence.slice(0, 5); // Limit to 5 items
}

// Calculate DOM stats
function calculateDomStats($: CheerioAPI | null, page?: Page): Promise<{ words: number; chars: number; node_count: number }> {
  if ($) {
    // Cheerio path
    const body = $('body').clone();
    body.find('script, style, noscript').remove();
    const text = body.text();
    const words = text.split(/\s+/).filter(w => w.length > 0).length;
    const chars = text.length;
    const node_count = $('*').length;
    return Promise.resolve({ words, chars, node_count });
  }
  
  // Playwright path
  if (!page) return Promise.resolve({ words: 0, chars: 0, node_count: 0 });
  
  return (async () => {
    const stats = await page.evaluate(() => {
      const body = document.body.cloneNode(true) as HTMLElement;
      const scripts = body.querySelectorAll('script, style, noscript');
      scripts.forEach(el => el.remove());
      const text = body.innerText || '';
      const words = text.split(/\s+/).filter((w: string) => w.length > 0).length;
      const chars = text.length;
      const node_count = document.querySelectorAll('*').length;
      return { words, chars, node_count };
    });
    return stats;
  })();
}

// Handle cookie/consent overlays (Playwright)
async function handleCookieConsent(page: Page): Promise<void> {
  try {
    // Inject CSS to hide common consent overlays
    await page.addStyleTag({
      content: `
        [id*="cookie" i],
        [id*="consent" i],
        [class*="cookie" i],
        [class*="consent" i],
        [id*="gdpr" i],
        [class*="gdpr" i] {
          display: none !important;
        }
      `,
    });
    
    // Try clicking Accept buttons (Swedish/English)
    const acceptSelectors = [
      'button:has-text("Acceptera")',
      'button:has-text("Accept")',
      'button:has-text("Godkänn")',
      '[id*="accept"]',
      '[class*="accept"]',
      '[aria-label*="accept" i]',
    ];
    
    for (const selector of acceptSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          await button.click({ timeout: 1000 });
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        // Continue to next selector
      }
    }
  } catch {
    // Ignore errors
  }
}

export class ContentHarvester {
  private cheerioCrawler!: CheerioCrawler;
  private playwrightCrawler!: PlaywrightCrawler;
  private requestQueue!: RequestQueue;
  private dataset!: Dataset;
  private config: Required<ContentHarvesterConfig>;
  private fallbackUrls: string[] = [];

  constructor(config: ContentHarvesterConfig) {
    const httpConcurrency = config.httpConcurrency ?? (Number(process.env.HARVEST_HTTP_CONCURRENCY) || 10);
    const jsConcurrency = config.jsConcurrency ?? (Number(process.env.HARVEST_JS_CONCURRENCY) || 5);
    
    this.config = {
      startUrls: config.startUrls,
      maxRequestsPerCrawl: config.maxRequestsPerCrawl ?? 100,
      httpConcurrency,
      jsConcurrency,
    };
  }

  private async initializeCrawlers(): Promise<void> {
    this.requestQueue = await RequestQueue.open();
    this.dataset = await Dataset.open('content-harvest');
    
    const fallbackUrls = this.fallbackUrls;
    const dataset = this.dataset;
    const maxRequestsPerCrawl = this.config.maxRequestsPerCrawl;
    const httpConcurrency = this.config.httpConcurrency;
    const jsConcurrency = this.config.jsConcurrency;

    // CheerioCrawler (HTTP-first)
    this.cheerioCrawler = new CheerioCrawler({
      requestQueue: this.requestQueue,
      maxRequestsPerCrawl,
      maxConcurrency: httpConcurrency,
      requestHandler: async ({ request, $, response }) => {
        const url = request.url;
        const html = $.html();
        
        try {
          const doc: Partial<ContentDoc> = {
            url,
            fetched_at: new Date().toISOString(),
            http_status: response?.statusCode,
            content_type: response?.headers['content-type'],
            render_mode: 'http',
            og: {},
            meta: {},
            headings: { h1: [], h2: [], h3: [] },
            text_blocks: [],
            jsonld: [],
            schema_types: [],
            links: { internal: [], external: [], canonicalized: false },
            evidence: [],
            dom_stats: { words: 0, chars: 0, node_count: 0 },
            html_hash: '',
          };

          // Extract metadata
          const metadata = await extractMetadata($, undefined);
          Object.assign(doc, metadata);

          // Extract main text (try Readability first)
          const mainTextReadability = extractMainTextWithReadability(html, url);
          if (mainTextReadability) {
            doc.main_text = truncate(mainTextReadability, 10000);
          } else {
            // Fallback to largest blocks
            const blocks = extractLargestTextBlocks($);
            if (blocks.length > 0) {
              doc.main_text = truncate(blocks[0], 10000);
              doc.text_blocks = blocks.slice(1);
            }
          }

          // Extract all text
          doc.all_text_excerpt = await extractAllText($, undefined);

          // Extract headings
          doc.headings = await extractHeadings($, undefined);

          // Extract JSON-LD
          doc.jsonld = await extractJsonLd($, undefined);
          doc.schema_types = extractSchemaTypes(doc.jsonld);

          // Extract links
          doc.links = await extractLinks($, undefined, url);

          // Extract contacts (from main text + footer)
          const footerText = $('footer').text() + ' ' + (doc.main_text || '');
          const emails = extractEmails(footerText);
          const phones = extractPhones(footerText);
          if (emails.length > 0 || phones.length > 0) {
            doc.contacts = { emails, phones };
          }

          // Extract evidence
          doc.evidence = extractEvidence(doc.main_text || '', doc.all_text_excerpt || '');

          // Calculate DOM stats
          doc.dom_stats = await calculateDomStats($, undefined);

          // Calculate HTML hash
          const bodyHtml = $('body').html() || '';
          doc.html_hash = sha256(bodyHtml);

          // Check if critical fields are missing (title or main_text)
          if (!doc.title || !doc.main_text) {
            fallbackUrls.push(url);
            return; // Don't save, will be processed by Playwright
          }

          // Validate and save
          const validated = ContentDocSchema.parse(doc);
          await dataset.pushData(validated);
          console.log(`[HTTP] ✓ Harvested: ${url}`);
        } catch (error) {
          console.error(`[HTTP] Error harvesting ${url}:`, error);
          // Still add to fallback
          fallbackUrls.push(url);
        }
      },
      preNavigationHooks: [
        async ({ request }) => {
          request.headers = {
            ...request.headers,
            'User-Agent': 'ServiceHarvester/1.0 (+contact@example.org)',
          };
        },
      ],
    });

    // PlaywrightCrawler (JS fallback)
    this.playwrightCrawler = new PlaywrightCrawler({
      requestQueue: this.requestQueue,
      maxRequestsPerCrawl,
      maxConcurrency: jsConcurrency,
      requestHandler: async ({ request, page, response }) => {
        const url = request.url;
        const needsJs = request.userData?.needsJs === true;
        
        if (!needsJs) {
          return;
        }

        try {
          // Handle cookie/consent overlays
          await handleCookieConsent(page);

          // Wait for page to load
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

          const html = await page.content();
          const doc: Partial<ContentDoc> = {
            url,
            fetched_at: new Date().toISOString(),
            http_status: response?.status(),
            content_type: response?.headers()['content-type'],
            render_mode: 'js',
            og: {},
            meta: {},
            headings: { h1: [], h2: [], h3: [] },
            text_blocks: [],
            jsonld: [],
            schema_types: [],
            links: { internal: [], external: [], canonicalized: false },
            evidence: [],
            dom_stats: { words: 0, chars: 0, node_count: 0 },
            html_hash: '',
          };

          // Extract metadata
          const metadata = await extractMetadata(null, page);
          Object.assign(doc, metadata);

          // Extract main text (try Readability first)
          const mainTextReadability = extractMainTextWithReadability(html, url);
          if (mainTextReadability) {
            doc.main_text = truncate(mainTextReadability, 10000);
          } else {
            // Fallback: extract from main/article
            const mainText = await page.evaluate(() => {
              const main = (document.querySelector('main, article, [role="main"]') || document.body) as HTMLElement;
              return main.innerText || '';
            });
            if (mainText) {
              doc.main_text = truncate(normalizeWhitespace(mainText), 10000);
              // Extract text blocks
              const blocks = await page.evaluate(() => {
                const main = (document.querySelector('main, article, [role="main"]') || document.body) as HTMLElement;
                const paragraphs = Array.from(main.querySelectorAll('p, div'));
                return paragraphs
                  .map(p => (p as HTMLElement).innerText || '')
                  .filter(t => t.length > 200)
                  .sort((a, b) => b.length - a.length)
                  .slice(0, 5)
                  .map(t => t.substring(0, 2000));
              });
              doc.text_blocks = blocks;
            }
          }

          // Extract all text
          doc.all_text_excerpt = await extractAllText(null, page);

          // Extract headings
          doc.headings = await extractHeadings(null, page);

          // Extract JSON-LD
          doc.jsonld = await extractJsonLd(null, page);
          doc.schema_types = extractSchemaTypes(doc.jsonld);

          // Extract links
          doc.links = await extractLinks(null, page, url);

          // Extract contacts
          const footerText = await page.evaluate(() => {
            const footer = document.querySelector('footer');
            return footer ? footer.innerText : '';
          });
          const mainTextForContacts = doc.main_text || '';
          const emails = extractEmails(footerText + ' ' + mainTextForContacts);
          const phones = extractPhones(footerText + ' ' + mainTextForContacts);
          if (emails.length > 0 || phones.length > 0) {
            doc.contacts = { emails, phones };
          }

          // Extract evidence
          doc.evidence = extractEvidence(doc.main_text || '', doc.all_text_excerpt || '');

          // Calculate DOM stats
          doc.dom_stats = await calculateDomStats(null, page);

          // Calculate HTML hash
          const bodyHtml = await page.evaluate(() => document.body.innerHTML);
          doc.html_hash = sha256(bodyHtml);

          // Validate and save
          const validated = ContentDocSchema.parse(doc);
          await dataset.pushData(validated);
          console.log(`[JS] ✓ Harvested: ${url}`);
        } catch (error) {
          console.error(`[JS] Error harvesting ${url}:`, error);
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
            'User-Agent': 'ServiceHarvester/1.0 (+contact@example.org)',
          });

          // Random delay (200-600ms)
          const delay = Math.floor(Math.random() * 400) + 200;
          await new Promise(resolve => setTimeout(resolve, delay));
        },
        async ({ page }) => {
          // Abort image/font/media/stylesheet
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

  async run(): Promise<void> {
    await this.initializeCrawlers();

    // Add start URLs
    for (const url of this.config.startUrls) {
      await this.requestQueue.addRequest({ url });
    }

    // Run CheerioCrawler first
    console.log('\n[ContentHarvester] Starting HTTP-first pass...');
    await this.cheerioCrawler.run();

    // Re-enqueue fallback URLs for Playwright
    if (this.fallbackUrls.length > 0) {
      console.log(`\n[ContentHarvester] Re-enqueuing ${this.fallbackUrls.length} URLs for JS fallback...`);
      for (const url of this.fallbackUrls) {
        await this.requestQueue.addRequest({
          url,
          uniqueKey: `${url}#js-fallback`,
          userData: { needsJs: true },
        });
      }
    }

    // Run PlaywrightCrawler
    if (this.fallbackUrls.length > 0) {
      console.log('\n[ContentHarvester] Starting JS fallback...');
      await this.playwrightCrawler.run();
    }

    console.log('\n✅ Content harvesting completed!');
    console.log(`💾 Results saved to: storage/datasets/content-harvest/`);
  }
}

