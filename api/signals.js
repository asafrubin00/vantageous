import Parser from 'rss-parser';

const FEEDS = [
  // Financial Times
  'https://www.ft.com/rss/home',
  'https://www.ft.com/markets?format=rss',
  'https://www.ft.com/world?format=rss',
  'https://www.ft.com/technology?format=rss',
  // BBC
  'http://feeds.bbci.co.uk/news/business/rss.xml',
  'http://feeds.bbci.co.uk/news/world/rss.xml',
  'http://feeds.bbci.co.uk/news/technology/rss.xml',
  // The Guardian
  'https://www.theguardian.com/uk/business/rss',
  'https://www.theguardian.com/world/rss',
  'https://www.theguardian.com/technology/rss',
  // CNBC
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  'https://www.cnbc.com/id/10001147/device/rss/rss.html',
  'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  // Yahoo Finance
  'https://finance.yahoo.com/news/rssindex',
  // MarketWatch
  'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
  'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
  // Reuters
  'https://feeds.reuters.com/reuters/businessNews',
  'https://feeds.reuters.com/reuters/technologyNews',
  'https://feeds.reuters.com/reuters/worldNews',
  // The Economist
  'https://www.economist.com/finance-and-economics/rss.xml',
  'https://www.economist.com/business/rss.xml',
  // AP News
  'https://feeds.apnews.com/apnews/business',
  'https://feeds.apnews.com/apnews/technology',
  'https://feeds.apnews.com/apnews/worldnews',
  // Seeking Alpha
  'https://seekingalpha.com/market_currents.xml',
  // Investopedia
  'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline',
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
    const results = await Promise.allSettled(FEEDS.map((url) => parser.parseURL(url)));

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

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ signals, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate signals', detail: err.message });
  }
}
