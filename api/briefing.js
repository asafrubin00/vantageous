import Parser from 'rss-parser';

const FT_FEEDS = {
  home: 'https://www.ft.com/rss/home',
  markets: 'https://www.ft.com/markets?format=rss',
  uk: 'https://www.ft.com/uk?format=rss',
  world: 'https://www.ft.com/world?format=rss',
  opinion: 'https://www.ft.com/opinion?format=rss',
  tech: 'https://www.ft.com/technology?format=rss',
};

const EXTRA_FEEDS = [
  'http://feeds.bbci.co.uk/news/business/rss.xml',
  'http://feeds.bbci.co.uk/news/world/rss.xml',
  'https://www.theguardian.com/uk/business/rss',
  'https://www.theguardian.com/world/rss',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  'https://finance.yahoo.com/news/rssindex',
  'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
  'https://feeds.reuters.com/reuters/businessNews',
  'https://feeds.reuters.com/reuters/worldNews',
  'https://www.economist.com/finance-and-economics/rss.xml',
  'https://feeds.apnews.com/apnews/business',
];

function mapItem(item) {
  return {
    title: item.title || '',
    description: item.contentSnippet || item.content || item.description || '',
    link: item.link || '',
    pubDate: item.pubDate || item.isoDate || '',
  };
}

export default async function handler(req, res) {
  const section = (req.query.section || 'home').toLowerCase();
  const mode = req.query.mode;

  if (mode === 'all') {
    try {
      const parser = new Parser();
      const allUrls = [...Object.values(FT_FEEDS), ...EXTRA_FEEDS];
      const results = await Promise.allSettled(allUrls.map((url) => parser.parseURL(url)));
      const seen = new Set();
      const items = [];
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        for (const item of result.value.items) {
          const key = item.link || item.guid || item.title;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(mapItem(item));
        }
      }
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(items);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch feeds', detail: err.message });
    }
  }

  const feedUrl = FT_FEEDS[section];
  if (!feedUrl) {
    return res.status(400).json({ error: `Unknown section: ${section}` });
  }

  try {
    const parser = new Parser();
    const feed = await parser.parseURL(feedUrl);
    const items = feed.items.slice(0, 12).map(mapItem);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch feed', detail: err.message });
  }
}
