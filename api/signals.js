import Parser from 'rss-parser';

// Feeds are tagged with their publisher so the response can report which sources
// actually contributed. Promise.allSettled swallows failures, and a feed that dies
// quietly is worse than one that dies loudly — the Reuters, AP and Investopedia
// feeds that used to sit in this list had been returning nothing for some time
// while the UI still advertised them as live sources.
const FEEDS = [
  { source: 'Financial Times', url: 'https://www.ft.com/rss/home' },
  { source: 'Financial Times', url: 'https://www.ft.com/markets?format=rss' },
  { source: 'Financial Times', url: 'https://www.ft.com/world?format=rss' },
  { source: 'Financial Times', url: 'https://www.ft.com/technology?format=rss' },
  { source: 'Financial Times', url: 'https://www.ft.com/companies?format=rss' },

  { source: 'BBC News', url: 'http://feeds.bbci.co.uk/news/business/rss.xml' },
  { source: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'BBC News', url: 'http://feeds.bbci.co.uk/news/technology/rss.xml' },

  { source: 'The Guardian', url: 'https://www.theguardian.com/uk/business/rss' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/technology/rss' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/business/economics/rss' },

  { source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/19746125/device/rss/rss.html' },

  { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },

  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
  { source: 'MarketWatch', url: 'https://www.marketwatch.com/rss/topstories' },

  { source: 'The Economist', url: 'https://www.economist.com/finance-and-economics/rss.xml' },
  { source: 'The Economist', url: 'https://www.economist.com/business/rss.xml' },

  { source: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml' },
  { source: 'Seeking Alpha', url: 'https://seekingalpha.com/feed.xml' },

  { source: 'NPR', url: 'https://feeds.npr.org/1006/rss.xml' },
];

const SYSTEM_PROMPT = `You are a senior financial analyst. Given a list of news headlines and snippets, identify market signals — stocks, ETFs, commodities, bonds, or currencies likely to move based on the news.

Return a JSON array. Each element corresponds to one news story with clear market implications. Skip opinion pieces or generic stories with no actionable angle. Include 1–4 instruments per story. Aim for 8–12 total story entries.

Shape of each element:
{
  "story": { "title": string, "link": string },
  "category": "geopolitics" | "tech" | "macro" | "energy" | "exec" | "rates" | "other",
  "industry": "financials" | "energy" | "technology" | "healthcare" | "consumer" | "industrials" | "real-estate" | "utilities" | "materials" | "media" | "defense" | "telecom" | "other",
  "region": string,
  "signals": [
    {
      "name": string,
      "ticker": string,
      "type": "stock" | "etf" | "commodity" | "bond" | "currency" | "crypto" | "index",
      "direction": "up" | "down",
      "confidence": "high" | "medium" | "low",
      "thesis": string,
      "caveats": string
    }
  ]
}

region should be a short string like "US", "Europe", "UK", "China", "Middle East", "Global", "Asia", "EM" etc.

Return only valid JSON — no markdown, no explanation outside the array.`;

export default async function handler(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const parser = new Parser();
    const results = await Promise.allSettled(FEEDS.map(({ url }) => parser.parseURL(url)));

    // Roll per-feed outcomes up to per-publisher health. A source counts as live
    // only if at least one of its feeds returned something.
    const health = new Map();
    results.forEach((result, i) => {
      const { source } = FEEDS[i];
      const entry = health.get(source) ?? { name: source, feeds: 0, failed: 0, items: 0 };
      entry.feeds++;
      if (result.status === 'fulfilled') entry.items += result.value.items.length;
      else entry.failed++;
      health.set(source, entry);
    });
    const sources = [...health.values()].map((s) => ({ ...s, ok: s.failed < s.feeds }));
    for (const s of sources) {
      if (s.failed) console.warn(`[signals] ${s.name}: ${s.failed}/${s.feeds} feeds failed`);
    }

    const seen = new Set();
    const items = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.items) {
        const key = item.link || item.guid || item.title;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          title: item.title || '',
          description: item.contentSnippet || item.description || '',
          link: item.link || '',
          pubDate: item.pubDate || item.isoDate || '',
        });
      }
    }

    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const top = items.slice(0, 25);

    const newsText = top
      .map((item, i) => `${i + 1}. ${item.title}\n${item.description}\nURL: ${item.link}`)
      .join('\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Here are today's top news stories:\n\n${newsText}\n\nIdentify market signals.`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(500).json({ error: 'Claude API error', detail: err });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text.trim();

    let signals;
    try {
      signals = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse Claude response as JSON');
      signals = JSON.parse(match[0]);
    }

    // Fetching the feeds takes well under a second; generating the analysis takes
    // around a minute, and that is the whole of the response time. Rather than
    // making a visitor wait for it, the CDN serves the last batch immediately and
    // rebuilds in the background. The previous one-hour revalidation window was
    // short enough that a quiet afternoon left the next visitor waiting the full
    // minute; a day means that effectively only a cold cache ever pays it. The
    // view shows when the batch was analysed and offers a manual refresh, so
    // slightly stale results are visible as such rather than passed off as live.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({ signals, sources, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate signals', detail: err.message });
  }
}
