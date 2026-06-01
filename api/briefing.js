import Parser from 'rss-parser';

const FEEDS = {
  home: 'https://www.ft.com/rss/home',
  markets: 'https://www.ft.com/markets?format=rss',
  uk: 'https://www.ft.com/uk?format=rss',
  world: 'https://www.ft.com/world?format=rss',
  opinion: 'https://www.ft.com/opinion?format=rss',
  tech: 'https://www.ft.com/technology?format=rss',
};

export default async function handler(req, res) {
  const section = (req.query.section || 'home').toLowerCase();
  const feedUrl = FEEDS[section];

  if (!feedUrl) {
    return res.status(400).json({ error: `Unknown section: ${section}` });
  }

  try {
    const parser = new Parser();
    const feed = await parser.parseURL(feedUrl);
    const items = feed.items.slice(0, 12).map((item) => ({
      title: item.title || '',
      description: item.contentSnippet || item.content || item.description || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || '',
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch feed', detail: err.message });
  }
}
