import { HybridCrawler } from './hybrid.js';
import { Dataset } from 'crawlee';

async function main() {
  const startUrls = [
    'https://spolosug.se/',
    'https://rorjour247.se/',
  ];

  console.log('🚀 Starting Hybrid Crawler...\n');
  console.log(`Target URLs: ${startUrls.length}`);
  startUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
  console.log('');

  const crawler = new HybridCrawler({
    startUrls,
    maxRequestsPerCrawl: 10,
    requestHandlerTimeoutSecs: 60,
  });

  try {
    await crawler.run();

    console.log('\n✅ Hybrid crawling completed!\n');
    console.log('📊 Extracted Data:');
    console.log('─'.repeat(60));

    // Get all data from the dataset
    const data = await Dataset.getData();
    for (const item of data.items) {
      console.log(`\n📍 URL: ${item.url}`);
      console.log(`   Timestamp: ${item.timestamp}`);
      if (item.serviceTitle) console.log(`   Service Title: ${item.serviceTitle}`);
      if (item.provider) console.log(`   Provider: ${item.provider}`);
      if (item.priceText) console.log(`   Price Text: ${item.priceText}`);
    }

    // Show final stats
    const stats = crawler.getStats();
    console.log('\n📈 Final Statistics:');
    console.log(`   Seen: ${stats.seen}`);
    console.log(`   HTTP/Static: ${stats.http_ok}`);
    console.log(`   Fallback Enqueued: ${stats.fallback_enqueued}`);
    console.log(`   JS Processed: ${stats.js_processed}`);
    console.log(`   JS Rate: ${stats.js_rate}%`);

    console.log('\n💾 Full results saved to: storage/datasets/default/');
  } catch (error) {
    console.error('❌ Error during crawling:', error);
    process.exit(1);
  }
}

main();

