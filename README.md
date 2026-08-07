# Vantageous

An AI-powered market intelligence dashboard that pulls from 9 reputable news sources, identifies investment signals in real-time, and presents them as structured, filterable trade ideas.

Live at [vantageous.vercel.app](https://vantageous.vercel.app)

## What it does

- Fetches the latest headlines from Financial Times, BBC, Guardian, CNBC, The Economist, Yahoo Finance, MarketWatch, Seeking Alpha, and NPR simultaneously — 25 feeds in total, in parallel, in well under a second.
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

## Valuation mode

A discounted cash flow calculator for US-listed stocks. Enter a ticker, set your assumptions
— discount rate, initial free cash flow growth, terminal growth, forecast length, and which
cash flow basis to anchor on — and it returns a fair value per share against the live price.

Alongside the point estimate it shows:

- **Reverse DCF** — the growth rate today's price already implies. Usually more informative
  than the fair value itself, since it turns the question into one you can judge directly.
- **Sensitivity grid** — fair value across a range of discount rates and terminal growth
  rates. A DCF point estimate is one cell in a table that often spans 2–3x.
- **Free cash flow history**, and every model input with the XBRL tag it came from, so a bad
  extraction is visible rather than silent.

Fundamentals are pulled from SEC EDGAR's XBRL `companyfacts` API and the trailing-twelve-month
figure is rolled forward from interim filings, since the last 10-K can be nearly a year old.

The endpoint declines rather than guessing when a DCF would be invalid:

- **Banks and insurers** do not tag capital expenditure, so free cash flow cannot be built —
  a dividend discount or residual income model is the right tool for those.
- **Filers whose capex coverage has gone stale** (common for REITs, which tag property
  acquisitions rather than maintenance capex) would otherwise mix decade-old investment spend
  with a current balance sheet.
- **Negative free cash flow**, thin filing history, and terminal-value-dominated results are
  flagged explicitly.

Coverage is US SEC filers only.

### Watchlist

Starring a ticker keeps it on a watchlist, which becomes the landing surface of the
valuation view. Every entry is valued against whatever assumptions are currently set,
so moving the discount rate re-rates the whole list at once rather than one name at a
time, and the list sorts cheapest-first on upside.

The watchlist and the assumptions both persist in `localStorage` — assumptions are your
own view of risk and growth, and a saved list re-rated against defaults each session
would not be yours. Each ticker is requested separately rather than through a batch
endpoint, so entries cache independently at the CDN and a list that overlaps yesterday's
is mostly cache hits. Tickers the model cannot value are not offered a star, rather than
being saved as a permanent blank row.

## Stack

- Front end: React + Vite + Tailwind CSS
- AI analysis: Claude Sonnet via the Anthropic API
- Analyst ratings: Finnhub API
- Fundamentals: SEC EDGAR XBRL `companyfacts` (no key required)
- Prices: Yahoo Finance chart endpoint (no key required)
- News sources: RSS feeds parsed server-side via `rss-parser`
- Deployment: Vercel serverless functions

## Project structure

```text
.
├── api/
│   ├── signals.js       # fetches RSS feeds, runs Claude analysis, returns structured signals
│   ├── briefing.js      # fetches individual FT section feeds and keyword-filtered feeds
│   ├── rating.js        # proxies Finnhub analyst consensus ratings with 24h caching
│   └── dcf.js           # SEC EDGAR fundamentals + DCF, reverse DCF, and sensitivity grid
├── src/
│   └── App.jsx          # full single-file React app — signals, briefing, valuation, filter bar
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

Signal analysis is cached for 30 minutes at the CDN layer (`s-maxage=1800`) to avoid redundant Claude API calls, with a 24-hour `stale-while-revalidate` window. Fetching the feeds takes under a second; generating the analysis takes around a minute and accounts for essentially all of the response time. The revalidation window means a visitor is served the previous batch immediately while a fresh one builds in the background, so only a genuinely cold cache waits for the full call. Analyst ratings are cached for 24 hours. The Briefing feed refreshes every 20 minutes client-side.
DCF results are cached for an hour per ticker-and-assumption combination, and the valuation view
debounces assumption changes so dragging a slider fires one request rather than thirty.

## Notes on sources

Bloomberg does not publish a public RSS feed and is not included. Reuters, AP and Investopedia were previously listed here but have all withdrawn their public RSS feeds — their URLs no longer resolve, and every documented replacement returns 401, 404 or 406. They have been removed rather than left in place failing silently.

The signals endpoint reports per-publisher health with each response, and the Sources panel shows a red marker against any publisher whose feeds did not respond, so a feed going dark is visible rather than silently shrinking the input.

All signals are AI-generated and should not be relied upon for investment decisions.
