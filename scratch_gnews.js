const Parser = require('rss-parser');
const parser = new Parser();

async function testGoogleNews() {
  const feed = await parser.parseURL('https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en');
  const firstUrl = feed.items[0].link;
  console.log("Original URL:", firstUrl);
  
  try {
    const res = await fetch(firstUrl, { 
      redirect: 'manual', // or 'follow'
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    console.log("Status:", res.status);
    console.log("Location:", res.headers.get('location'));
    const text = await res.text();
    console.log("Text snippet:", text.substring(0, 500));
  } catch (err) {
    console.log("Error:", err);
  }
}

testGoogleNews();
