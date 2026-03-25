const fetch = require('node-fetch');
const Parser = require('rss-parser');
const p = new Parser({ customFields: { item: [['description', 'description']] } });

(async () => {
  const feed = await p.parseURL('https://api.nevobo.nl/export/vereniging/ckl9x7n/programma.rss');
  
  // Group all home matches by venue, and for each get the speelveld from the detail page
  const venueData = {};
  const homeItems = feed.items.filter(i => {
    const title = i.title || '';
    return title.match(/:\s*VTC Woerden/);
  });
  
  console.log(`Found ${homeItems.length} home matches total`);
  const limit = Math.min(homeItems.length, 40);
  
  for (let i = 0; i < limit; i++) {
    const url = homeItems[i].link || homeItems[i].guid;
    const content = homeItems[i].description || homeItems[i].contentSnippet || homeItems[i].content || '';
    const locMatch = content.match(/Speellocatie:\s*([^,]+)/);
    const venueName = locMatch ? locMatch[1].trim() : 'unknown';
    
    try {
      const res = await fetch(url);
      const text = await res.text();
      const svMatch = text.match(/"speelveld":"([^"]+)"/);
      const fieldSlug = svMatch ? svMatch[1].split('/').pop() : null;
      
      if (!venueData[venueName]) venueData[venueName] = { fields: new Set(), count: 0 };
      venueData[venueName].count++;
      if (fieldSlug) venueData[venueName].fields.add(fieldSlug);
    } catch (_) {}
  }
  
  console.log('\nLocaties en velden:');
  for (const [name, data] of Object.entries(venueData).sort((a,b) => b[1].count - a[1].count)) {
    console.log(`\n  ${name} (${data.count} wedstrijden)`);
    for (const f of [...data.fields].sort()) {
      const pretty = f.replace(/-/g, ' ').replace(/^(.)/, c => c.toUpperCase());
      console.log(`    - ${pretty} (slug: ${f})`);
    }
  }
})();
