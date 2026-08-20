const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: ['media:content']
  }
});

async function testFlipboard() {
  const feed = await parser.parseURL('https://flipboard.com/topic/technology.rss');
  console.log(feed.items[0]);
}

testFlipboard();
