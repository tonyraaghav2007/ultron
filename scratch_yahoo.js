const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: ['media:content']
  }
});

async function testYahooNews() {
  const feed = await parser.parseURL('https://news.search.yahoo.com/rss?p=technology');
  console.log(feed.items[0]);
}

testYahooNews();
