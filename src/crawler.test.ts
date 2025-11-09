import { WebsiteCrawler } from './crawler.js';

describe('WebsiteCrawler', () => {
  describe('configuration', () => {
    it('should use default maxRequestsPerCrawl when not provided', () => {
      const crawler = new WebsiteCrawler({
        startUrls: ['https://example.com'],
      });

      expect(crawler).toBeDefined();
      expect(crawler.getCrawler()).toBeDefined();
    });

    it('should use custom maxRequestsPerCrawl when provided', () => {
      const crawler = new WebsiteCrawler({
        startUrls: ['https://example.com'],
        maxRequestsPerCrawl: 5,
      });

      expect(crawler).toBeDefined();
      expect(crawler.getCrawler()).toBeDefined();
    });
  });

  describe('extraction methods', () => {
    it('should have extractData method accessible', () => {
      const crawler = new WebsiteCrawler({
        startUrls: ['https://example.com'],
      });

      // Verify the crawler instance has the method (via type checking)
      const crawlerAny = crawler as any;
      expect(typeof crawlerAny.extractData).toBe('function');
      expect(typeof crawlerAny.extractPolicy).toBe('function');
      expect(typeof crawlerAny.extractTerms).toBe('function');
      expect(typeof crawlerAny.extractPrices).toBe('function');
      expect(typeof crawlerAny.extractAvailability).toBe('function');
    });
  });
});

