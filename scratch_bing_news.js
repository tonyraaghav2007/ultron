const Parser = require('rss-parser');
const parser = new Parser();

async function testBing() {
  const feed = await parser.parseURL('https://www.bing.com/news/search?q=technology&format=rss');
  console.log(feed.items[0]);
}

testBing();
