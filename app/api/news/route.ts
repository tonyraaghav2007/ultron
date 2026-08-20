import { NextResponse } from 'next/server';
import Parser from 'rss-parser';

const parser = new Parser({
  customFields: {
    item: ['media:content']
  }
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const topic = searchParams.get('topic') || 'Top Headlines';
  
  try {
    let feed;
    try {
      const cleanTopic = topic.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const flipboardUrl = (cleanTopic === 'topheadlines' || cleanTopic === 'general') 
          ? 'https://flipboard.com/topic/news.rss' 
          : `https://flipboard.com/topic/${cleanTopic}.rss`;
      feed = await parser.parseURL(flipboardUrl);
    } catch(e) {
      // Fallback to Google News if flipboard topic doesn't exist
      const googleUrl = (topic.toLowerCase() === 'top headlines' || topic.toLowerCase() === 'general')
          ? 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en'
          : `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`;
      feed = await parser.parseURL(googleUrl);
    }

    const rawItems = feed.items.slice(0, 5);
    const articles = await Promise.all(rawItems.map(async (item: any) => {
      let imageUrl = null;
      
      // Check flipboard image
      if (item['media:content'] && item['media:content']['$'] && item['media:content']['$'].url) {
        imageUrl = item['media:content']['$'].url;
      } 
      // If we used Google news fallback, try to parse
      else if (item.link && item.link.includes('news.google.com')) {
        try {
          const res = await fetch(item.link, { 
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
              signal: AbortSignal.timeout(2000)
          });
          const html = await res.text();
          const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          if (match && match[1]) imageUrl = match[1];
        } catch (err) {}
      }

      return {
        title: item.title,
        link: item.link,
        snippet: item.contentSnippet || item.content,
        pubDate: item.pubDate,
        image: imageUrl || null
      };
    }));

    return NextResponse.json({ success: true, articles });
  } catch (error: any) {
    console.error("News fetch error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
