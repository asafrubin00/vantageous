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

### When free cash flow cannot be built

Banks, insurers, REITs and some utilities report no capital expenditure that can be read
from standard tags, so free cash flow cannot be constructed for them at all. These are
exactly the filers a dividend discount model is meant for, so rather than refusing, the
endpoint values the dividend stream instead and says plainly that it has done so — the
response carries the model used and why, and the view labels its inputs to match.

A dividend model counts only cash actually paid out, so a company returning capital
through buybacks looks cheaper on this basis than it is. That caveat is attached to
every such valuation rather than left for the reader to remember.

Dividend tags need their own selection rule. Prologis reports
`CommonStockDividendsPerShareDeclared` as $0.02, $0.00, $0.01 and $0.03 while its actual
dividend of $3.16 to $4.04 sits in `CommonStockDividendsPerShareCashPaid`, both tags
covering the same years. Tag priority alone picked the artifact and valued the company
at a fiftieth of its dividend, so within a period the larger figure wins across tags
while restatements of the same tag still resolve by filing date.

Across the 50 largest US listings, 42 are valued on free cash flow and 7 on dividends.
The one refusal is Amazon, which has negative free cash flow and pays no dividend, so
neither model applies.

The endpoint still declines rather than guessing where no model fits:

- **Filers with neither usable capital expenditure nor a dividend history** — there is no
  stream to discount either way.
- **Negative free cash flow with no dividend to fall back on.**
- Thin filing history and terminal-value-dominated results are flagged explicitly rather
  than refused.

Coverage is US SEC filers only.

Two things beyond the choice of model shape that coverage. A ticker sometimes points at an entity that
holds the listing but not the history — XOM maps to ExxonMobil Holdings Corp, a
successor registrant with no 10-K, while the filings sit under Exxon Mobil Corp on a
CIK the ticker map never mentions. Where the mapped entity has no annual history, the
registrant holding the filings is looked up by name and used instead, and the response
says so rather than quietly reporting another company's figures. Separately, capex
tagging varies enough that a single missing tag can cost a whole sector: Verizon reports
under `PaymentsToAcquireOtherProductiveAssets`, one word from a tag already in the chain.

### Multiples and business metrics

`/api/fundamentals` is deliberately independent of the valuation. A discounted cash flow
legitimately refuses plenty of companies — Amazon has negative free cash flow and pays no
dividend — and "no answer" is a poor result for one of the largest companies in the
market. Every company has revenue, earnings and a balance sheet, so every company is
placed on the same multiples: price to earnings, sales and book, EV to sales and EBITDA.
Because they are the same measures for everyone, two companies can be compared directly
rather than each being described in its own terms.

The same extraction answers the question a valuation alone cannot — not whether something
looks cheap, but why. Revenue growth year on year and over three years, gross, operating
and net margin, the three-year change in operating margin, return on equity, and net debt
to EBITDA, with revenue and operating margin shown by year.

A blank means the measure does not apply rather than that it failed: banks have no
meaningful EBITDA, and a loss-making company has no price-to-earnings. Where the valuation
refuses, these figures are shown anyway, so a refusal never leaves the reader with nothing.

### Valuation history chart

Price and fair value plotted together over the recorded history, both under the current
assumptions, so the gap between them can be read as a trend rather than the single number
the change column gives. Fair value moves only when new filings land, so most of the
movement is price — which is the point, since the gap is what changes.

### Watchlist

Starring a ticker keeps it on a watchlist, which becomes the landing surface of the
valuation view. Every entry is valued against whatever assumptions are currently set,
so moving the discount rate re-rates the whole list at once rather than one name at a
time, and the list sorts cheapest-first on upside.

Each successful valuation is snapshotted, and the list gains a change column comparing
today with the last day it was opened: how far the gap between price and fair value has
moved, and over how many days.

Fair value moves both when a company's filings change and when you move a slider, and
only the first is news. Every snapshot therefore records a fingerprint of the assumptions
behind it, and a change is only reported between snapshots sharing one. Dropping the
discount rate from 9% to 7% takes AT&T's fair value from $31.25 to $53.55 — reporting
that as a 94-point move in upside would be claiming the market did something the reader
did. Changing an assumption starts a fresh comparison instead, and switching back picks
the original series up again. One snapshot is kept per ticker per day per fingerprint,
capped at 60 per ticker and 100 tickers, evicting least-recently-updated.

History is per-browser and only accrues on days the list is opened — there is no server
or account behind it. A gap in visits is a gap in the record, and the change column says
how many days it is actually comparing rather than implying a daily series.

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

Signal analysis is cached for 30 minutes at the CDN layer (`s-maxage=1800`) to avoid redundant Claude API calls, with a 24-hour `stale-while-revalidate` window, so a visitor is served the previous batch immediately while a fresh one builds in the background.

Fetching the feeds takes under a second; the analysis accounts for essentially all of the remaining time. It runs as three concurrent calls over a round-robin split of the stories rather than one long call, which brought a cold response from roughly 65 seconds to 26 for the same number of stories analysed and the same output. Dealing the stories round-robin rather than in contiguous slices gives each batch the same spread of freshness. A failed batch now costs a few stories instead of the whole response, and the response reports how many batches ran and how many failed. Analyst ratings are cached for 24 hours. The Briefing feed refreshes every 20 minutes client-side.
DCF results are cached for an hour per ticker-and-assumption combination, and the valuation view
debounces assumption changes so dragging a slider fires one request rather than thirty.

## Notes on sources

Bloomberg does not publish a public RSS feed and is not included. Reuters, AP and Investopedia were previously listed here but have all withdrawn their public RSS feeds — their URLs no longer resolve, and every documented replacement returns 401, 404 or 406. They have been removed rather than left in place failing silently.

The signals endpoint reports per-publisher health with each response, and the Sources panel shows a red marker against any publisher whose feeds did not respond, so a feed going dark is visible rather than silently shrinking the input.

All signals are AI-generated and should not be relied upon for investment decisions.
