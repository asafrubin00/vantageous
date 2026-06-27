# Vantageous

An AI-powered market intelligence dashboard that pulls from 11+ reputable news sources, identifies investment signals in real-time, and presents them as structured, filterable trade ideas.

Live at [vantageous.vercel.app](https://vantageous.vercel.app)

## What it does

- Fetches the latest headlines from Financial Times, Reuters, BBC, Guardian, CNBC, AP, The Economist, Yahoo Finance, MarketWatch, Seeking Alpha, and Investopedia simultaneously.
- Sends the top stories to Claude for structured signal extraction — identifying which instruments (equities, ETFs, commodities, FX, bonds, crypto, indices) are likely to move and in which direction, with a thesis and caveats for each.
- Displays signals as filterable cards, organised by confidence, category, industry, region, and asset type.
- Surfaces analyst consensus ratings (Strong Buy through Strong Sell) per equity ticker, pulled from Finnhub and cached to avoid redundant lookups.
- Identifies top picks — the highest-confidence signals from the current batch — and pinches them to the top of the feed.
- Shows trending tickers across the current signal set, ranked by mention count and net directional bias.

## Filters and search

The filter bar sits at the top of the page and stays pinned as you scroll. It includes:

- **Category** — Geopolitics, Tech, Macro, Energy, Rates, Exec Moves, Other
- **Industry** — Financials, Technology, Energy, Healthcare, Consumer, Industrials, Real Estate, Defense, Media, Materials, Utilities, Telecom
- **Region** — Global, US, UK, Europe, Asia, China, Middle East, EM
- **Asset** — Equities, ETFs, Commodities, Bonds, FX, Crypto, Indices
- **Direction** — Up or Down
- **Confidence** — High, Medium, Low
- **Analyst Rating** — Strong Buy, Buy, Hold, Sell, Strong Sell (filters live as ratings load)
- **Search** — free-text search across tickers, company names, and story headlines

Trending tickers and sources are accessible from the filter bar without cluttering the main view.

## Briefing mode

A second mode provides a clean reading surface for the underlying news, with FT section tabs (Home, Markets, UK, World, Opinion, Tech) and a custom keyword filter system. Saved filters are stored in localStorage.

## Stack

- Front end: React + Vite + Tailwind CSS
- AI analysis: Claude Sonnet via the Anthropic API
- Analyst ratings: Finnhub API
- News sources: RSS feeds parsed server-side via `rss-parser`
- Deployment: Vercel serverless functions

## Project structure

```text
.
├── api/
│   ├── signals.js       # fetches RSS feeds, runs Claude analysis, returns structured signals
│   ├── briefing.js      # fetches individual FT section feeds and keyword-filtered feeds
│   └── rating.js        # proxies Finnhub analyst consensus ratings with 24h caching
├── src/
│   └── App.jsx          # full single-file React app — signals view, briefing view, filter bar
├── index.html
├── vite.config.js
├── tailwind.config.js
└── vercel.json
```

## Running locally

You will need API keys for Anthropic and optionally Finnhub.

```bash
git clone https://github.com/asafrubin00/ft-briefing.git
cd ft-briefing
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=your_key_here
FINNHUB_API_KEY=your_key_here   # optional — analyst ratings will be hidden if omitted
```

Then run with the Vercel CLI so the serverless API functions are available locally:

```bash
vercel dev
```

The app will be available at `http://localhost:3000`.

## Caching

Signal analysis is cached for 30 minutes at the CDN layer (`s-maxage=1800`) to avoid redundant Claude API calls. Analyst ratings are cached for 24 hours. The Briefing feed refreshes every 20 minutes client-side.

## Notes on sources

Bloomberg does not publish a public RSS feed and is not included. All signals are AI-generated and should not be relied upon for investment decisions.
