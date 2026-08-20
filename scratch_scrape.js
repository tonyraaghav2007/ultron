const cheerio = require('cheerio');

async function scrapeGoogleNews() {
  const res = await fetch('https://news.google.com/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en');
  const html = await res.text();
  const $ = cheerio.load(html);
  
  const articles = [];
  $('article').slice(0, 5).each((i, el) => {
    const titleEl = $(el).find('a.JtKRv');
    const title = titleEl.text();
    const link = 'https://news.google.com' + titleEl.attr('href').replace('./', '/');
    const pubDate = $(el).find('time').attr('datetime');
    
    // find figure or img
    const imgEl = $(el).find('figure img');
    let image = imgEl.attr('src') || imgEl.attr('srcset');
    if (image && image.startsWith('/')) {
        image = 'https://news.google.com' + image;
    }
    
    articles.push({ title, link, pubDate, image });
  });
  
  console.log(articles);
}

scrapeGoogleNews();
