const Parser = require('rss-parser');
const parser = new Parser();

async function test() {
  const feed = await parser.parseURL('https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en');
  const item = feed.items[0];
  console.log('Title:', item.title);
  console.log('Link:', item.link);
  
  const res = await fetch(item.link);
  const html = await res.text();
  const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  console.log('Image:', match ? match[1] : 'No image found');
}
test();
