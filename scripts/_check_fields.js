const fetch = require('node-fetch');
const Parser = require('rss-parser');
const p = new Parser({ customFields: { item: [['description', 'description']] } });

(async () => {
  const feed = await p.parseURL('https://api.nevobo.nl/export/vereniging/ckl9x7n/programma.rss');
  const homeItems = feed.items.filter(i => {
    const c = i.description || i.contentSnippet || i.content || '';
    return c.includes('Thijs van der Polshal');
  });
  
  const fields = new Set();
  const halls = new Set();
  const matchFields = [];
  const limit = Math.min(homeItems.length, 20);
  
  for (let i = 0; i < limit; i++) {
    const url = homeItems[i].link || homeItems[i].guid;
    const title = homeItems[i].title?.replace(/^\d+\s+\w+\s+\d+:\d+:\s*/, '') || '?';
    try {
      const res = await fetch(url);
      const text = await res.text();
      const svMatch = text.match(/"speelveld":"([^"]+)"/);
      const shMatch = text.match(/"speelzaal":"([^"]+)"/);
      const fieldName = svMatch ? svMatch[1].split('/').pop() : null;
      if (svMatch) fields.add(fieldName);
      if (shMatch) halls.add(shMatch[1].split('/').pop());
      matchFields.push({ title, field: fieldName });
    } catch (_) {}
  }
  
  console.log('Speelzalen:', [...halls]);
  console.log('Speelvelden:', [...fields].sort());
  console.log('\nWedstrijd → veld:');
  for (const m of matchFields) {
    console.log(`  ${m.title} → ${m.field}`);
  }
})();
