import { ContentHarvester } from './content_harvester.js';
import { Dataset } from 'crawlee';

async function main() {
  const startUrls = [
    'https://spolosug.se/',
    'https://rorjour247.se/',
  ];

  console.log('🚀 Starting Content Harvester...\n');
  console.log(`Target URLs: ${startUrls.length}`);
  startUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
  console.log('');

  const harvester = new ContentHarvester({
    startUrls,
    maxRequestsPerCrawl: 10,
  });

  try {
    await harvester.run();

    console.log('\n✅ Content harvesting completed!\n');
    console.log('📊 Harvested Data:');
    console.log('─'.repeat(60));

    // Get all data from the dataset
    const dataset = await Dataset.open('content-harvest');
    const data = await dataset.getData();
    
    for (const item of data.items) {
      console.log(`\n📍 URL: ${item.url}`);
      console.log(`   Render Mode: ${item.render_mode}`);
      console.log(`   Fetched At: ${item.fetched_at}`);
      if (item.title) console.log(`   Title: ${item.title.substring(0, 80)}${item.title.length > 80 ? '...' : ''}`);
      if (item.main_text) {
        console.log(`   Main Text: ${item.main_text.substring(0, 150)}...`);
        console.log(`   Main Text Length: ${item.main_text.length} chars`);
      }
      if (item.headings) {
        const totalHeadings = (item.headings.h1?.length || 0) + (item.headings.h2?.length || 0) + (item.headings.h3?.length || 0);
        console.log(`   Headings: ${totalHeadings} total (H1: ${item.headings.h1?.length || 0}, H2: ${item.headings.h2?.length || 0}, H3: ${item.headings.h3?.length || 0})`);
      }
      if (item.links) {
        console.log(`   Links: ${item.links.internal?.length || 0} internal, ${item.links.external?.length || 0} external`);
      }
      if (item.contacts) {
        console.log(`   Contacts: ${item.contacts.emails?.length || 0} emails, ${item.contacts.phones?.length || 0} phones`);
      }
      if (item.jsonld && item.jsonld.length > 0) {
        console.log(`   JSON-LD: ${item.jsonld.length} schema(s) found`);
      }
      if (item.schema_types && item.schema_types.length > 0) {
        console.log(`   Schema Types: ${item.schema_types.join(', ')}`);
      }
      console.log(`   DOM Stats: ${item.dom_stats.words} words, ${item.dom_stats.chars} chars, ${item.dom_stats.node_count} nodes`);
      console.log(`   HTML Hash: ${item.html_hash.substring(0, 16)}...`);
    }

    console.log(`\n💾 Full results saved to: storage/datasets/content-harvest/`);
    console.log(`📈 Total items harvested: ${data.items.length}`);
  } catch (error) {
    console.error('❌ Error during harvesting:', error);
    process.exit(1);
  }
}

main();

