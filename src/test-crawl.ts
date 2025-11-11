import { WebsiteCrawler } from './crawler.js';
import { Dataset } from 'crawlee';

async function main() {
  const targetUrl = 'https://rorjour247.se/';
  console.log(`Starting crawler for ${targetUrl}...\n`);

  const crawler = new WebsiteCrawler({
    startUrls: [targetUrl],
    maxRequestsPerCrawl: 5,
    requestHandlerTimeoutSecs: 60,
  });

  try {
    await crawler.run();
    
    console.log('\n✅ Crawling completed!\n');
    console.log('📊 Extracted Data:');
    console.log('─'.repeat(60));
    
    // Get all data from the dataset
    const data = await Dataset.getData();
    for (const item of data.items) {
      console.log(`\n📍 URL: ${item.url}`);
      console.log(`   Timestamp: ${item.timestamp}`);
      
      if (item.metadata) {
        if (item.metadata.title) console.log(`   Title: ${item.metadata.title}`);
        if (item.metadata.description) console.log(`   Description: ${item.metadata.description?.substring(0, 100)}...`);
        if (item.metadata.headings && item.metadata.headings.length > 0) {
          console.log(`   Headings (${item.metadata.headings.length}): ${item.metadata.headings.slice(0, 5).join(', ')}${item.metadata.headings.length > 5 ? '...' : ''}`);
        }
        if (item.metadata.structuredData) {
          console.log(`   Structured Data: Found ${Array.isArray(item.metadata.structuredData) ? item.metadata.structuredData.length : 1} schema(s)`);
        }
      }
      
      if (item.policy) console.log(`   Policy: ${item.policy.substring(0, 150)}...`);
      if (item.terms) console.log(`   Terms: ${item.terms.substring(0, 150)}...`);
      if (item.prices && item.prices.length > 0) {
        console.log(`   Prices (${item.prices.length}): ${item.prices.slice(0, 5).join(', ')}${item.prices.length > 5 ? '...' : ''}`);
      } else {
        console.log(`   Prices: (none found)`);
      }
      if (item.availability) console.log(`   Availability: ${item.availability}`);
    }
    
    console.log('\n💾 Full results saved to: storage/datasets/default/');
  } catch (error) {
    console.error('❌ Error during crawling:', error);
    process.exit(1);
  }
}

main();

