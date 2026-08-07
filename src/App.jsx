import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS = ['Home', 'Markets', 'UK', 'World', 'Opinion', 'Tech'];
const REFRESH_INTERVAL = 20 * 60 * 1000;
const STORAGE_KEY = 'vantageous-custom-filters';

// Reuters, AP and Investopedia were listed here long after their public RSS feeds
// stopped resolving, so the app advertised sources it was reading nothing from.
// The signals endpoint now reports which publishers actually responded, and this
// list is only the fallback shown before that arrives.
const SOURCES = [
  'Financial Times', 'BBC News', 'The Guardian', 'CNBC', 'The Economist',
  'Yahoo Finance', 'MarketWatch', 'Seeking Alpha', 'NPR',
];

const SIGNAL_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'geopolitics', label: 'Geopolitics' },
  { id: 'tech', label: 'Tech' },
  { id: 'macro', label: 'Macro' },
  { id: 'energy', label: 'Energy' },
  { id: 'rates', label: 'Rates' },
  { id: 'exec', label: 'Exec Moves' },
  { id: 'other', label: 'Other' },
];

const SIGNAL_INDUSTRIES = [
  { id: 'all', label: 'All Industries' },
  { id: 'financials', label: 'Financials' },
  { id: 'technology', label: 'Technology' },
  { id: 'energy', label: 'Energy' },
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'consumer', label: 'Consumer' },
  { id: 'industrials', label: 'Industrials' },
  { id: 'real-estate', label: 'Real Estate' },
  { id: 'defense', label: 'Defense' },
  { id: 'media', label: 'Media' },
  { id: 'materials', label: 'Materials' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'telecom', label: 'Telecom' },
];

const ASSET_TYPES = [
  { id: 'all', label: 'All Assets' },
  { id: 'stock', label: 'Equities' },
  { id: 'etf', label: 'ETFs' },
  { id: 'commodity', label: 'Commodities' },
  { id: 'bond', label: 'Bonds' },
  { id: 'currency', label: 'FX' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'index', label: 'Indices' },
];

const REGION_OPTIONS = [
  { id: 'all', label: 'All Regions' },
  { id: 'Global', label: 'Global' },
  { id: 'US', label: 'US' },
  { id: 'UK', label: 'UK' },
  { id: 'Europe', label: 'Europe' },
  { id: 'Asia', label: 'Asia' },
  { id: 'China', label: 'China' },
  { id: 'Middle East', label: 'Middle East' },
  { id: 'EM', label: 'EM' },
];

const DIRECTION_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'up', label: '▲ Going Up' },
  { id: 'down', label: '▼ Going Down' },
];

const CONFIDENCE_LEVELS = [
  { id: 'all', label: 'All' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const ANALYST_RATINGS = [
  { id: 'all', label: 'All Ratings' },
  { id: 'Strong Buy', label: 'Strong Buy' },
  { id: 'Buy', label: 'Buy' },
  { id: 'Hold', label: 'Hold' },
  { id: 'Sell', label: 'Sell' },
  { id: 'Strong Sell', label: 'Strong Sell' },
];

function defaultFilters() {
  return {
    category: 'all', industry: 'all', assetType: 'all', region: 'all',
    direction: 'all', confidence: 'all', analystRating: 'all', search: '',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadCustomFilters() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveCustomFilters(f) { localStorage.setItem(STORAGE_KEY, JSON.stringify(f)); }

const WATCHLIST_KEY = 'vantageous.watchlist';
const ASSUMPTIONS_KEY = 'vantageous.assumptions';

function loadWatchlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((t) => typeof t === 'string') : [];
  } catch { return []; }
}
function saveWatchlist(list) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

// Assumptions persist alongside the watchlist. They are the user's own view of
// risk and growth, and a saved list re-rated against defaults every session would
// not be theirs. Unknown keys are dropped so an old stored shape cannot inject
// junk into the query string.
function loadAssumptions(defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(ASSUMPTIONS_KEY) || '{}');
    const merged = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (typeof saved[key] === typeof defaults[key]) merged[key] = saved[key];
    }
    return merged;
  } catch { return { ...defaults }; }
}
function saveAssumptions(a) {
  try { localStorage.setItem(ASSUMPTIONS_KEY, JSON.stringify(a)); } catch { /* private mode */ }
}

function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatTs(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function matchesKeywords(article, keywords) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  return keywords.some((kw) => text.includes(kw));
}

// ── Ratings context ───────────────────────────────────────────────────────────

const RatingsCtx = createContext({ ratings: new Map(), update: () => {} });

// Lets a ticker anywhere in the signal feed jump straight into the valuation view
// without threading a callback through every card and row between here and there.
const ValuationCtx = createContext(null);

// Only individual operating companies have the SEC filings a DCF needs. ETFs,
// commodities, currencies and indices have no cash flow statement to model.
const dcfEligible = (type, ticker) => !!ticker && type === 'stock';

function RatingsProvider({ children }) {
  const [ratings, setRatings] = useState(() => new Map());
  const update = useCallback((ticker, rating) => {
    setRatings((prev) => { const next = new Map(prev); next.set(ticker, rating); return next; });
  }, []);
  return <RatingsCtx.Provider value={{ ratings, update }}>{children}</RatingsCtx.Provider>;
}

const ratingCache = new Map();

function useRating(ticker, type) {
  const { update } = useContext(RatingsCtx);
  const eligible = !!ticker && !['commodity', 'bond', 'currency', 'crypto', 'index'].includes(type);
  const [rating, setRating] = useState(() => eligible ? ratingCache.get(ticker) ?? null : null);

  useEffect(() => {
    if (!eligible) return;
    if (ratingCache.has(ticker)) {
      const v = ratingCache.get(ticker);
      setRating(v); update(ticker, v); return;
    }
    let cancelled = false;
    fetch(`/api/rating?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const v = d.rating ?? null;
        ratingCache.set(ticker, v); setRating(v); update(ticker, v);
      })
      .catch(() => { if (!cancelled) { ratingCache.set(ticker, null); setRating(null); } });
    return () => { cancelled = true; };
  }, [ticker, eligible, update]);

  return rating;
}

// ── Logo ──────────────────────────────────────────────────────────────────────

function LogoMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 2.5 L16 25.5 L30 2.5" stroke="#FCD299" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="25.5" r="2.5" fill="#FCD299" />
    </svg>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function DirectionBadge({ direction }) {
  const up = direction === 'up';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded ${up ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/50' : 'bg-red-900/40 text-red-400 border border-red-800/50'}`}>
      {up ? '▲' : '▼'} {up ? 'UP' : 'DOWN'}
    </span>
  );
}

function ConfidencePip({ confidence }) {
  const colours = { high: 'bg-emerald-400', medium: 'bg-yellow-400', low: 'bg-gray-500' };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
      <span className={`w-1.5 h-1.5 rounded-full ${colours[confidence] || 'bg-gray-600'}`} />
      {confidence}
    </span>
  );
}

function CategoryBadge({ category }) {
  const map = {
    geopolitics: 'text-purple-300 bg-purple-900/25 border-purple-800/40',
    tech:        'text-blue-300 bg-blue-900/25 border-blue-800/40',
    macro:       'text-yellow-300 bg-yellow-900/25 border-yellow-800/40',
    energy:      'text-orange-300 bg-orange-900/25 border-orange-800/40',
    exec:        'text-pink-300 bg-pink-900/25 border-pink-800/40',
    rates:       'text-cyan-300 bg-cyan-900/25 border-cyan-800/40',
    other:       'text-gray-400 bg-gray-800/25 border-gray-700/40',
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded border ${map[category] || map.other}`}>
      {category}
    </span>
  );
}

function RatingBadge({ rating }) {
  if (!rating) return null;
  const isBull = rating.includes('Buy');
  const isBear = rating.includes('Sell');
  const cls = isBull
    ? 'text-emerald-300 bg-emerald-900/25 border-emerald-800/40'
    : isBear ? 'text-red-300 bg-red-900/25 border-red-800/40'
    : 'text-yellow-400 bg-yellow-900/20 border-yellow-800/40';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>{rating}</span>
  );
}

// ── Filter pill dropdown ──────────────────────────────────────────────────────

function FilterPill({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isActive = value !== 'all' && value !== '';
  const currentLabel = options.find((o) => o.id === value)?.label || 'All';

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-all ${
          isActive
            ? 'bg-salmon/10 border-salmon/35 text-salmon'
            : 'border-dark-border text-gray-500 hover:border-gray-600 hover:text-gray-300 bg-dark-card'
        }`}
      >
        <span className="text-[9px] uppercase tracking-widest font-semibold opacity-60">{label}</span>
        <span className="font-medium ml-0.5">{currentLabel}</span>
        <span className={`text-[9px] ml-0.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-[#1c1c1c] border border-dark-border rounded-lg shadow-2xl z-30 min-w-[150px] overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-dark/60 ${
                value === opt.id ? 'text-salmon font-semibold bg-salmon/5' : 'text-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange, onClear, activeCount, onTrending, onSources }) {
  return (
    <div className="border-t border-dark-border bg-dark/90 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 space-y-1.5">
        {/* Row 1: filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterPill label="Category"   options={SIGNAL_CATEGORIES} value={filters.category}      onChange={(v) => onChange('category', v)} />
          <FilterPill label="Industry"   options={SIGNAL_INDUSTRIES} value={filters.industry}      onChange={(v) => onChange('industry', v)} />
          <FilterPill label="Region"     options={REGION_OPTIONS}    value={filters.region}        onChange={(v) => onChange('region', v)} />
          <FilterPill label="Asset"      options={ASSET_TYPES}       value={filters.assetType}     onChange={(v) => onChange('assetType', v)} />
          <FilterPill label="Direction"  options={DIRECTION_OPTIONS} value={filters.direction}     onChange={(v) => onChange('direction', v)} />
          <FilterPill label="Confidence" options={CONFIDENCE_LEVELS} value={filters.confidence}    onChange={(v) => onChange('confidence', v)} />
          <FilterPill label="Analyst"    options={ANALYST_RATINGS}   value={filters.analystRating} onChange={(v) => onChange('analystRating', v)} />
          {activeCount > 0 && (
            <button onClick={onClear} className="text-[10px] text-gray-600 hover:text-salmon transition-colors ml-0.5 whitespace-nowrap">
              × clear ({activeCount})
            </button>
          )}
        </div>

        {/* Row 2: search + action buttons */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onChange('search', e.target.value)}
              placeholder="Search tickers, companies, commodities…"
              className="w-full bg-dark-card border border-dark-border rounded-md px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:border-gray-600 focus:outline-none transition-colors"
            />
            {filters.search && (
              <button
                onClick={() => onChange('search', '')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-[11px] leading-none"
              >✕</button>
            )}
          </div>
          <button
            onClick={onTrending}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 border border-dark-border hover:border-gray-600 rounded-md px-2.5 py-1.5 transition-colors whitespace-nowrap bg-dark-card"
          >
            <span className="text-xs">↑↓</span> Trending
          </button>
          <button
            onClick={onSources}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 border border-dark-border hover:border-gray-600 rounded-md px-2.5 py-1.5 transition-colors whitespace-nowrap bg-dark-card"
          >
            <span className="text-xs">◉</span> Sources
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Instrument row ────────────────────────────────────────────────────────────

function InstrumentRow({ sig }) {
  const rating = useRating(sig.ticker, sig.type);
  const openValuation = useContext(ValuationCtx);
  const valuable = dcfEligible(sig.type, sig.ticker) && openValuation;

  return (
    <div className="border border-dark-border/50 rounded p-3 bg-dark/30">
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <DirectionBadge direction={sig.direction} />
        <span className="text-gray-100 text-sm font-medium">{sig.name}</span>
        {sig.ticker && (
          // The faint border is the only cue that separates a valuable ticker from
          // an inert one — hover alone would leave this invisible on touch devices.
          valuable ? (
            <button
              onClick={() => openValuation(sig.ticker)}
              title={`Value ${sig.ticker} with a DCF`}
              className="text-salmon-dim hover:text-salmon text-[11px] font-mono bg-salmon/10 hover:bg-salmon/25 border border-salmon/25 hover:border-salmon/50 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
            >
              {sig.ticker}
            </button>
          ) : (
            <span className="text-salmon-dim text-[11px] font-mono bg-dark-border/40 border border-transparent px-1.5 py-0.5 rounded">
              {sig.ticker}
            </span>
          )
        )}
        {rating && <RatingBadge rating={rating} />}
        <span className="ml-auto shrink-0"><ConfidencePip confidence={sig.confidence} /></span>
      </div>
      <p className="text-gray-300 text-xs leading-relaxed mb-1">{sig.thesis}</p>
      {sig.caveats && <p className="text-gray-500 text-[11px] leading-relaxed">⚠ {sig.caveats}</p>}
    </div>
  );
}

// ── Signal card ───────────────────────────────────────────────────────────────

function SignalCard({ item, isTopPick = false, index = 0 }) {
  const [expanded, setExpanded] = useState(isTopPick);
  const visible = expanded ? item.signals : item.signals.slice(0, 2);

  return (
    <div
      className={`rounded-lg p-4 transition-colors animate-fade-in-up ${
        isTopPick
          ? 'bg-dark-card border border-salmon/25 hover:border-salmon/40'
          : 'bg-dark-card border border-dark-border hover:border-dark-border/60'
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {isTopPick && <span className="text-[10px] font-semibold text-salmon-dim uppercase tracking-widest">★ Top Pick</span>}
        <CategoryBadge category={item.category} />
        {item.industry && item.industry !== 'other' && (
          <span className="text-[10px] text-gray-500 border border-dark-border px-1.5 py-0.5 rounded capitalize">
            {item.industry.replace('-', ' ')}
          </span>
        )}
        {item.region && <span className="text-[10px] text-gray-500 uppercase tracking-wide">{item.region}</span>}
      </div>

      <a href={item.story.link} target="_blank" rel="noopener noreferrer"
        className="font-headline text-base text-gray-100 hover:text-salmon transition-colors leading-snug block mb-3"
      >
        {item.story.title} →
      </a>

      <div className="space-y-2">
        {visible.map((sig, i) => <InstrumentRow key={i} sig={sig} />)}
      </div>

      {item.signals.length > 2 && (
        <button onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-gray-500 hover:text-salmon-dim transition-colors"
        >
          {expanded ? '− less' : `+ ${item.signals.length - 2} more`}
        </button>
      )}
    </div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ signals, total }) {
  const { ups, downs, hot } = useMemo(() => {
    let ups = 0, downs = 0;
    const sectors = {};
    for (const item of signals) {
      if (item.category) sectors[item.category] = (sectors[item.category] || 0) + 1;
      for (const s of item.signals) { if (s.direction === 'up') ups++; else downs++; }
    }
    const hot = Object.entries(sectors).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
    return { ups, downs, hot };
  }, [signals]);

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] mb-4">
      <span className="text-gray-500">{signals.length}{total !== signals.length ? `/${total}` : ''} signal{signals.length !== 1 ? 's' : ''}</span>
      <span className="text-gray-700">·</span>
      <span className="text-emerald-400">▲ {ups}</span>
      <span className="text-red-400">▼ {downs}</span>
      {hot.length > 0 && <>
        <span className="text-gray-700">·</span>
        <span className="text-gray-500">Hot: <span className="text-gray-400 capitalize">{hot.join(', ')}</span></span>
      </>}
    </div>
  );
}

// ── Trending modal ────────────────────────────────────────────────────────────

function TrendingModal({ signals, onClose }) {
  const openValuation = useContext(ValuationCtx);
  const tickers = useMemo(() => {
    const counts = {};
    for (const item of signals) {
      for (const sig of item.signals) {
        if (!sig.ticker) continue;
        if (!counts[sig.ticker]) counts[sig.ticker] = { ticker: sig.ticker, name: sig.name, type: sig.type, count: 0, net: 0 };
        counts[sig.ticker].count++;
        counts[sig.ticker].net += sig.direction === 'up' ? 1 : -1;
      }
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 15);
  }, [signals]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-dark-card border border-dark-border rounded-xl p-6 w-full max-w-sm shadow-2xl animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-gray-200">Trending Tickers</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        {tickers.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">Loading signals…</p>
        ) : (
          <ul className="space-y-2.5">
            {tickers.map((t) => (
              <li key={t.ticker} className="flex items-center justify-between gap-3">
                {dcfEligible(t.type, t.ticker) && openValuation ? (
                  <button
                    onClick={() => { openValuation(t.ticker); onClose(); }}
                    title={`Value ${t.ticker} with a DCF`}
                    className="min-w-0 text-left group"
                  >
                    <span className="text-sm font-mono text-salmon-dim group-hover:text-salmon font-medium transition-colors">{t.ticker}</span>
                    <span className="text-gray-500 group-hover:text-gray-400 text-xs ml-2 truncate transition-colors">{t.name}</span>
                  </button>
                ) : (
                  <div className="min-w-0">
                    <span className="text-sm font-mono text-salmon-dim font-medium">{t.ticker}</span>
                    <span className="text-gray-500 text-xs ml-2 truncate">{t.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold ${t.net > 0 ? 'text-emerald-400' : t.net < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {t.net > 0 ? '▲' : t.net < 0 ? '▼' : '·'}
                  </span>
                  <span className="text-gray-600 text-xs">{t.count}×</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Sources modal ─────────────────────────────────────────────────────────────

function SourcesModal({ onClose, sources }) {
  // Prefer live health from the last signals fetch; fall back to the static list
  // before the first response lands.
  const rows = sources?.length
    ? sources.map((s) => ({ name: s.name, ok: s.ok, note: s.failed ? `${s.failed} of ${s.feeds} feeds down` : null }))
    : SOURCES.map((name) => ({ name, ok: true, note: null }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-dark-card border border-dark-border rounded-xl p-6 w-full max-w-sm shadow-2xl animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-gray-200">News Sources</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <ul className="space-y-2.5 mb-4">
          {rows.map((s) => (
            <li key={s.name} className="flex items-center gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.ok ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} />
              <span className={`text-sm ${s.ok ? 'text-gray-300' : 'text-gray-500'}`}>{s.name}</span>
              {s.note && <span className="text-[10px] text-gray-600 ml-auto">{s.note}</span>}
            </li>
          ))}
          <li className="flex items-center gap-2.5 opacity-40">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />
            <span className="text-gray-500 text-sm">Bloomberg (no public RSS)</span>
          </li>
        </ul>
        <p className="text-gray-600 text-xs leading-relaxed border-t border-dark-border pt-4">
          Not financial advice. All signals are AI-generated and should not be relied upon for investment decisions.
        </p>
      </div>
    </div>
  );
}

// ── Signals view ──────────────────────────────────────────────────────────────

function SignalsView({ filters, setFilters, onDataLoaded }) {
  const { ratings } = useContext(RatingsCtx);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSignals = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/signals');
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
      const json = await res.json();
      setData(json);
      onDataLoaded(json.signals || [], json.sources || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [onDataLoaded]);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  const filtered = useMemo(() => {
    if (!data?.signals) return [];
    const { category, industry, assetType, region, direction, confidence, analystRating, search } = filters;
    const q = search.trim().toLowerCase();

    return data.signals
      .filter((item) => {
        if (category !== 'all' && item.category !== category) return false;
        if (industry !== 'all' && item.industry !== industry) return false;
        if (region !== 'all' && item.region !== region) return false;
        if (assetType !== 'all' && !item.signals.some((s) => s.type === assetType)) return false;
        if (direction !== 'all' && !item.signals.some((s) => s.direction === direction)) return false;
        if (confidence !== 'all' && !item.signals.some((s) => s.confidence === confidence)) return false;
        if (analystRating !== 'all') {
          const hasMatch = item.signals.some((s) => ratings.get(s.ticker) === analystRating);
          if (!hasMatch) return false;
        }
        if (q) {
          const inTitle = item.story.title.toLowerCase().includes(q);
          const inSigs = item.signals.some((s) =>
            s.ticker?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q)
          );
          if (!inTitle && !inSigs) return false;
        }
        return true;
      })
      .map((item) => ({
        ...item,
        signals: item.signals.filter((s) => {
          if (assetType !== 'all' && s.type !== assetType) return false;
          if (direction !== 'all' && s.direction !== direction) return false;
          if (confidence !== 'all' && s.confidence !== confidence) return false;
          if (analystRating !== 'all' && ratings.get(s.ticker) !== analystRating) return false;
          return true;
        }),
      }))
      .filter((item) => item.signals.length > 0);
  }, [data, filters, ratings]);

  const topPicks = useMemo(() => filtered.filter((i) => i.signals.some((s) => s.confidence === 'high')).slice(0, 3), [filtered]);
  const rest = useMemo(() => filtered.filter((i) => !topPicks.includes(i)), [filtered, topPicks]);

  return (
    <div>
      {error && (
        <div className="text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg p-4 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          <p className="text-gray-500 text-xs animate-pulse mb-4">Reading {SOURCES.length} sources and analysing with AI… this can take up to a minute</p>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-dark-card border border-dark-border rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-dark-border rounded w-20 mb-3" />
              <div className="h-4 bg-dark-border rounded w-3/4 mb-3" />
              <div className="border border-dark-border/50 rounded p-3 space-y-2">
                <div className="h-3 bg-dark-border rounded w-1/3" />
                <div className="h-3 bg-dark-border rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-2">No signals match these filters</p>
          <button onClick={() => setFilters(defaultFilters())} className="text-sm underline hover:text-gray-300 transition-colors">Clear all filters</button>
        </div>
      ) : (
        <div>
          <SummaryBar signals={filtered} total={data?.signals?.length || 0} />

          {topPicks.length > 0 && (
            <>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[11px] text-salmon-dim uppercase tracking-widest font-semibold whitespace-nowrap">★ Top Picks</span>
                <div className="flex-1 border-t border-salmon/20" />
              </div>
              <div className="space-y-3 mb-5">
                {topPicks.map((item, i) => <SignalCard key={i} item={item} isTopPick index={i} />)}
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[11px] text-gray-600 uppercase tracking-widest whitespace-nowrap">All Signals</span>
                <div className="flex-1 border-t border-dark-border/40" />
              </div>
            </>
          )}

          <div className="space-y-3">
            {rest.map((item, i) => <SignalCard key={i} item={item} index={i + topPicks.length} />)}
          </div>

          {data && (
            <p className="text-center text-gray-700 text-[11px] mt-6">
              analysed {formatTs(new Date(data.fetchedAt))} ·{' '}
              <button onClick={fetchSignals} className="underline hover:text-gray-500 transition-colors">refresh</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Briefing view ─────────────────────────────────────────────────────────────

function FilterModal({ onSave, onCancel }) {
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const handleSave = () => {
    const n = name.trim();
    const kws = keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (!n || !kws.length) return;
    onSave({ name: n, keywords: kws });
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-card border border-dark-border rounded-lg p-6 w-full max-w-md">
        <h2 className="font-headline text-salmon text-lg mb-4">Add Filter</h2>
        <label className="block text-gray-400 text-xs mb-1">Filter name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Climate"
          className="w-full bg-dark border border-dark-border rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-salmon/50 focus:outline-none mb-4" />
        <label className="block text-gray-400 text-xs mb-1">Keywords (comma separated)</label>
        <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. climate change, net zero"
          className="w-full bg-dark border border-dark-border rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-salmon/50 focus:outline-none mb-6" />
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-200 text-sm px-4 py-1.5 transition-colors">Cancel</button>
          <button onClick={handleSave} className="bg-salmon/20 text-salmon hover:bg-salmon/30 border border-salmon/30 rounded px-4 py-1.5 text-sm font-medium transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

function BriefingView() {
  const [section, setSection] = useState('Home');
  const [activeFilter, setActiveFilter] = useState(null);
  const [articles, setArticles] = useState([]);
  const [allArticles, setAllArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [customFilters, setCustomFilters] = useState(loadCustomFilters);
  const [showModal, setShowModal] = useState(false);
  const [hoveredFilter, setHoveredFilter] = useState(null);

  const fetchFeed = useCallback(async (s) => {
    const r = await fetch(`/api/briefing?section=${s}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, []);

  const fetchAll = useCallback(async () => {
    const r = await fetch('/api/briefing?mode=all');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setArticles(await fetchFeed(section.toLowerCase()));
      setLastUpdated(new Date());
      fetchAll().then(setAllArticles).catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [section, fetchFeed, fetchAll]);

  useEffect(() => {
    setActiveFilter(null); refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [refresh]);

  const handleFilterClick = async (f) => {
    if (activeFilter?.id === f.id) { setActiveFilter(null); return; }
    setActiveFilter(f);
    if (f.type === 'keyword') return;
    setLoading(true); setError(null);
    try { setArticles(await fetchFeed(f.feedSection)); setLastUpdated(new Date()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleAdd = ({ name, keywords }) => {
    const nf = { id: `custom-${Date.now()}`, name, type: 'keyword', keywords };
    const upd = [...customFilters, nf];
    setCustomFilters(upd); saveCustomFilters(upd); setShowModal(false);
  };

  const handleDelete = (id) => {
    const upd = customFilters.filter((f) => f.id !== id);
    setCustomFilters(upd); saveCustomFilters(upd);
    if (activeFilter?.id === id) setActiveFilter(null);
  };

  const displayed = activeFilter?.type === 'keyword'
    ? allArticles.filter((a) => matchesKeywords(a, activeFilter.keywords))
    : articles;

  return (
    <div>
      <nav className="flex gap-1 overflow-x-auto scrollbar-none border-b border-dark-border/50 mb-3">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-3 py-2 text-sm whitespace-nowrap transition-colors ${s === section && !activeFilter ? 'text-salmon border-b-2 border-salmon font-medium' : 'text-gray-400 hover:text-gray-200'}`}
          >{s}</button>
        ))}
      </nav>

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-2 mb-3">
        <span className="text-gray-600 text-[11px] uppercase tracking-wider shrink-0 mr-1">My Filters</span>
        {customFilters.length === 0 && <span className="text-gray-600 text-xs italic">No filters yet</span>}
        {customFilters.map((f) => (
          <div key={f.id} className="relative shrink-0" onMouseEnter={() => setHoveredFilter(f.id)} onMouseLeave={() => setHoveredFilter(null)}>
            <button onClick={() => handleFilterClick(f)}
              className={`px-2.5 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${activeFilter?.id === f.id ? 'text-salmon bg-salmon/10 border border-salmon/30 font-medium' : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-dark-border'}`}
            >{f.name}</button>
            {hoveredFilter === f.id && (
              <button onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-dark-card border border-dark-border rounded-full text-gray-500 hover:text-red-400 text-[10px] flex items-center justify-center transition-colors"
              >✕</button>
            )}
          </div>
        ))}
        <button onClick={() => setShowModal(true)}
          className="px-2.5 py-1.5 text-xs text-gray-600 hover:text-salmon border border-dashed border-dark-border hover:border-salmon/30 rounded whitespace-nowrap transition-colors shrink-0"
        >+ Add Filter</button>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-gray-500 text-xs">{lastUpdated ? `Updated ${formatTs(lastUpdated)}` : 'Loading…'}</p>
        <button onClick={refresh} disabled={loading}
          className="text-salmon-dim hover:text-salmon border border-dark-border hover:border-salmon/40 rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-40"
        >{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg p-4 mb-4 text-sm">Failed: {error}</div>}

      {loading && displayed.length === 0 ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-dark-card border border-dark-border rounded-lg p-5 animate-pulse">
              <div className="h-5 bg-dark-border rounded w-3/4 mb-3" />
              <div className="h-3 bg-dark-border rounded w-full mb-2" />
              <div className="h-3 bg-dark-border rounded w-5/6" />
            </div>
          ))}
        </div>
      ) : displayed.length === 0 && activeFilter?.type === 'keyword' ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-1">No articles match "{activeFilter.name}"</p>
          <p className="text-sm">Try broadening your keywords.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayed.map((article, i) => (
            <article key={`${article.link}-${i}`} className="bg-dark-card border border-dark-border rounded-lg p-4 sm:p-5 hover:border-salmon/30 transition-colors group">
              <div className="flex items-start justify-between gap-3 mb-2">
                <a href={article.link} target="_blank" rel="noopener noreferrer"
                  className="font-headline text-base sm:text-lg text-gray-100 group-hover:text-salmon transition-colors leading-snug"
                >{article.title}</a>
                {article.pubDate && <span className="text-gray-500 text-xs whitespace-nowrap mt-1 shrink-0">{timeAgo(article.pubDate)}</span>}
              </div>
              {article.description && <p className="text-gray-400 text-sm leading-relaxed mb-3">{article.description}</p>}
              <a href={article.link} target="_blank" rel="noopener noreferrer" className="text-salmon-dim hover:text-salmon text-sm font-medium transition-colors">Read →</a>
            </article>
          ))}
        </div>
      )}

      {showModal && <FilterModal onSave={handleAdd} onCancel={() => setShowModal(false)} />}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

// ── Valuation (DCF) ───────────────────────────────────────────────────────────

const DCF_DEFAULTS = { wacc: 9, growth: 8, terminalGrowth: 2.5, years: 10, basis: 'ttm' };

const BASIS_LABELS = { ttm: 'Trailing 12m', lastFy: 'Last FY', avg3: '3yr average' };

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(n, digits = 1) {
  return n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

function Assumption({ label, value, onChange, min, max, step, suffix = '%', hint }) {
  return (
    <div className="bg-dark/40 border border-dark-border/60 rounded p-2.5">
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        <span className="text-[11px] text-gray-400">{label}</span>
        <span className="text-sm text-salmon font-mono shrink-0">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full h-1 accent-salmon cursor-pointer"
        aria-label={label}
      />
      {hint && <p className="text-[10px] text-gray-600 mt-1.5 leading-tight">{hint}</p>}
    </div>
  );
}

function VerdictCard({ data }) {
  const { verdict, valuation, quote } = data;
  const tone =
    verdict.rating === 'undervalued' ? 'text-emerald-400'
      : verdict.rating === 'overvalued' ? 'text-red-400'
        : 'text-gray-300';
  const border =
    verdict.rating === 'undervalued' ? 'border-emerald-500/30'
      : verdict.rating === 'overvalued' ? 'border-red-500/30'
        : 'border-dark-border';

  return (
    <div className={`bg-dark-card border ${border} rounded-lg p-4`}>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Fair value</p>
          <p className="font-headline text-3xl text-gray-100 leading-none">
            ${valuation.perShare.toFixed(2)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Market price</p>
          <p className="font-headline text-3xl text-gray-400 leading-none">
            {quote ? `$${quote.price.toFixed(2)}` : '—'}
          </p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-dark-border flex items-center gap-2 flex-wrap">
        <span className={`text-sm font-medium capitalize ${tone}`}>{verdict.rating ?? 'no price available'}</span>
        {verdict.upside !== null && (
          <span className={`text-sm font-mono ${tone}`}>{fmtPct(verdict.upside)}</span>
        )}
        <span className="text-[11px] text-gray-600 ml-auto">
          vs {BASIS_LABELS[data.assumptions.basis]} FCF of {fmtMoney(data.assumptions.baseFreeCashFlow)}
        </span>
      </div>
    </div>
  );
}

// The point estimate is the least reliable number on the page — this grid is what
// shows how much of it is assumption rather than analysis.
function SensitivityGrid({ sensitivity, price }) {
  const { waccAxis, terminalGrowthAxis, grid } = sensitivity;

  const cell = (v) => {
    if (v === null) return { className: 'text-gray-700', style: {} };
    if (!price) return { className: 'text-gray-300', style: {} };
    const up = v / price - 1;
    const mag = Math.min(Math.abs(up) / 0.5, 1);
    const rgb = up >= 0 ? '16,185,129' : '239,68,68';
    return {
      className: up >= 0 ? 'text-emerald-200' : 'text-red-200',
      style: { backgroundColor: `rgba(${rgb},${(0.06 + mag * 0.3).toFixed(3)})` },
    };
  };

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-4">
      <h3 className="text-sm text-gray-200 mb-1">Sensitivity</h3>
      <p className="text-[11px] text-gray-600 mb-3 leading-relaxed">
        Fair value per share across discount rate and terminal growth. The spread here matters
        more than any single cell.
      </p>
      <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
        <table className="w-full min-w-[420px] border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="text-left font-normal text-gray-600 p-1.5 whitespace-nowrap">
                Discount ↓ / Terminal →
              </th>
              {terminalGrowthAxis.map((g) => (
                <th key={g} className="font-mono font-normal text-gray-500 p-1.5 text-right">
                  {(g * 100).toFixed(1)}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={waccAxis[i]}>
                <td className="font-mono text-gray-500 p-1.5 whitespace-nowrap">
                  {(waccAxis[i] * 100).toFixed(1)}%
                </td>
                {row.map((v, j) => {
                  const { className, style } = cell(v);
                  return (
                    <td
                      key={terminalGrowthAxis[j]}
                      style={style}
                      className={`font-mono p-1.5 text-right rounded-sm ${className}`}
                    >
                      {v === null ? '—' : v.toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryStrip({ history }) {
  // Filers change tags mid-history and leave gaps — NVIDIA has 2010-2012 and then
  // nothing until 2022. Drawing those as neighbouring bars would imply a continuous
  // series, so only the unbroken run up to the latest year is charted.
  const contiguous = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const year = +history[i].periodEnd.slice(0, 4);
    if (contiguous.length && +contiguous[0].periodEnd.slice(0, 4) !== year + 1) break;
    contiguous.unshift(history[i]);
  }
  const omitted = history.length - contiguous.length;
  const recent = contiguous.slice(-8);
  const max = Math.max(...recent.map((h) => Math.abs(h.freeCashFlow)), 1);

  if (!recent.length) return null;

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-4">
      <h3 className="text-sm text-gray-200 mb-3">Free cash flow history</h3>
      <div className="flex items-end gap-1.5 h-24">
        {recent.map((h) => {
          const pct = Math.max((Math.abs(h.freeCashFlow) / max) * 100, 2);
          const negative = h.freeCashFlow < 0;
          return (
            <div key={h.periodEnd} className="flex-1 flex flex-col items-center justify-end h-full group">
              <span className="text-[9px] text-gray-500 mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {fmtMoney(h.freeCashFlow)}
              </span>
              <div
                className={`w-full rounded-sm ${negative ? 'bg-red-500/40' : 'bg-salmon/35 group-hover:bg-salmon/60'} transition-colors`}
                style={{ height: `${pct}%` }}
              />
              <span className="text-[9px] text-gray-600 mt-1">{h.periodEnd.slice(2, 4)}</span>
            </div>
          );
        })}
      </div>
      {omitted > 0 && (
        <p className="text-[10px] text-gray-600 mt-2.5 leading-tight">
          {omitted} earlier year{omitted === 1 ? '' : 's'} on file but not contiguous with this run —
          the filer changed or dropped its capex tag in between.
        </p>
      )}
    </div>
  );
}

function Provenance({ data }) {
  const { inputs, sources, assumptions, alternativeBases } = data;
  const row = (label, value, sub) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-dark-border/40 last:border-0">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-[11px] text-gray-300 font-mono text-right">
        {value}
        {sub && <span className="text-gray-600 ml-1.5">{sub}</span>}
      </span>
    </div>
  );

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-4">
      <h3 className="text-sm text-gray-200 mb-1">Model inputs</h3>
      <p className="text-[11px] text-gray-600 mb-3">Straight from SEC filings — check these if a result looks wrong.</p>
      {row('Base free cash flow', fmtMoney(assumptions.baseFreeCashFlow), `through ${assumptions.baseFreeCashFlowThrough ?? '—'}`)}
      {row('— trailing 12m', fmtMoney(alternativeBases.ttm))}
      {row('— last fiscal year', fmtMoney(alternativeBases.lastFy))}
      {row('— 3yr average', fmtMoney(alternativeBases.avg3))}
      {row('Cash & equivalents', fmtMoney(inputs.cash))}
      {row('Short-term investments', fmtMoney(inputs.shortTermInvestments))}
      {row('Total debt', fmtMoney(inputs.totalDebt))}
      {row('Net debt', fmtMoney(inputs.netDebt), inputs.asOf ? `as of ${inputs.asOf}` : '')}
      {row('Diluted shares', `${(inputs.shares / 1e9).toFixed(3)}B`)}
      {inputs.coverPageShares && row('Cover-page shares', `${(inputs.coverPageShares / 1e9).toFixed(3)}B`)}
      {row('Enterprise value', fmtMoney(data.valuation.enterpriseValue))}
      {row('Terminal value share', `${(data.valuation.terminalShare * 100).toFixed(0)}%`)}

      <details className="mt-3">
        <summary className="text-[11px] text-gray-600 hover:text-salmon-dim cursor-pointer transition-colors">
          XBRL tags used
        </summary>
        <div className="mt-2 space-y-1">
          {Object.entries(sources).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] text-gray-600">{k}</span>
              <span className="text-[10px] text-gray-500 font-mono text-right break-all">{v ?? '—'}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// Values every watched ticker against whatever assumptions are currently set, so
// changing the discount rate re-rates the whole list rather than just the open one.
// Requests go one per ticker rather than through a batch endpoint: each ticker then
// caches independently at the CDN, so a list that overlaps yesterday's is mostly hits.
function useWatchlistValuations(tickers, assumptions) {
  const [rows, setRows] = useState({});
  const key = tickers.join(',');
  const assumptionKey = JSON.stringify(assumptions);

  useEffect(() => {
    if (!tickers.length) { setRows({}); return; }
    let cancelled = false;

    const timer = setTimeout(async () => {
      setRows(Object.fromEntries(tickers.map((t) => [t, { state: 'loading' }])));
      const queue = [...tickers];

      // Four at a time — enough to feel instant, few enough not to stampede the
      // function on a long list.
      const worker = async () => {
        while (queue.length && !cancelled) {
          const ticker = queue.shift();
          try {
            const res = await fetch(`/api/dcf?${new URLSearchParams({ ticker, ...assumptions })}`);
            const json = await res.json();
            if (cancelled) return;
            setRows((prev) => ({ ...prev, [ticker]: res.ok ? { state: 'ok', data: json } : { state: 'error', error: json } }));
          } catch (err) {
            if (!cancelled) setRows((prev) => ({ ...prev, [ticker]: { state: 'error', error: { error: 'Could not reach the valuation service' } } }));
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, tickers.length) }, worker));
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, assumptionKey]);

  return rows;
}

function WatchlistPanel({ tickers, assumptions, onSelect, onRemove, heading = 'Watchlist' }) {
  const rows = useWatchlistValuations(tickers, assumptions);

  // Cheapest first, so the list answers "what looks interesting today" at a glance.
  // Anything without a verdict sorts to the bottom rather than pretending to rank.
  const ordered = [...tickers].sort((a, b) => {
    const up = (t) => rows[t]?.state === 'ok' ? rows[t].data.verdict.upside ?? -Infinity : -Infinity;
    return up(b) - up(a);
  });

  const done = tickers.filter((t) => rows[t] && rows[t].state !== 'loading').length;

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm text-gray-200">{heading}</h3>
        <span className="text-[10px] text-gray-600">
          {done < tickers.length ? `valuing ${done}/${tickers.length}…` : `${tickers.length} ticker${tickers.length === 1 ? '' : 's'} · your current assumptions`}
        </span>
      </div>

      <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
        <table className="w-full min-w-[420px] text-[11px] border-collapse">
          <thead>
            <tr className="text-gray-600">
              <th className="text-left font-normal p-1.5">Ticker</th>
              <th className="text-left font-normal p-1.5">Company</th>
              <th className="text-right font-normal p-1.5">Price</th>
              <th className="text-right font-normal p-1.5">Fair value</th>
              <th className="text-right font-normal p-1.5">Upside</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {ordered.map((ticker) => {
              const row = rows[ticker];
              const ok = row?.state === 'ok';
              const upside = ok ? row.data.verdict.upside : null;
              const tone = upside === null ? 'text-gray-600' : upside > 0 ? 'text-emerald-400' : 'text-red-400';

              return (
                <tr key={ticker} className="border-t border-dark-border/40 hover:bg-dark/40 transition-colors">
                  <td className="p-1.5">
                    <button
                      onClick={() => onSelect(ticker)}
                      className="font-mono text-salmon-dim hover:text-salmon transition-colors"
                    >
                      {ticker}
                    </button>
                  </td>
                  <td className="p-1.5 text-gray-400 max-w-[180px] truncate">
                    {row?.state === 'loading' ? <span className="text-gray-700">…</span>
                      : ok ? row.data.company
                        : <span className="text-gray-600">{row?.error?.company ?? '—'}</span>}
                  </td>
                  <td className="p-1.5 text-right font-mono text-gray-400">
                    {ok && row.data.quote ? `$${row.data.quote.price.toFixed(2)}` : '—'}
                  </td>
                  <td className="p-1.5 text-right font-mono text-gray-200">
                    {ok ? `$${row.data.valuation.perShare.toFixed(2)}` : '—'}
                  </td>
                  <td className={`p-1.5 text-right font-mono ${tone}`}>
                    {row?.state === 'loading' ? '' : upside === null ? 'n/a' : fmtPct(upside)}
                  </td>
                  <td className="p-1.5 text-right">
                    <button
                      onClick={() => onRemove(ticker)}
                      title={`Remove ${ticker} from watchlist`}
                      className="text-gray-700 hover:text-red-400 transition-colors leading-none"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* A DCF legitimately does not apply to some filers. Saying so beside the row
          is more useful than leaving a dash the reader has to interpret. */}
      {ordered.some((t) => rows[t]?.state === 'error') && (
        <div className="mt-3 pt-3 border-t border-dark-border/40 space-y-1">
          {ordered.filter((t) => rows[t]?.state === 'error').map((t) => (
            <p key={t} className="text-[10px] text-gray-600 leading-relaxed">
              <span className="font-mono text-gray-500">{t}</span> — {rows[t].error.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// The active ticker lives in App so the signals feed can set it. This view stays
// mounted across tab switches, so assumptions and results survive a trip to
// Signals and back rather than resetting and refetching.
function ValuationView({ ticker, onTicker }) {
  const [query, setQuery] = useState(ticker ?? '');
  const [assumptions, setAssumptions] = useState(() => loadAssumptions(DCF_DEFAULTS));
  const [watchlist, setWatchlist] = useState(loadWatchlist);

  useEffect(() => { if (ticker) setQuery(ticker); }, [ticker]);
  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);
  useEffect(() => { saveAssumptions(assumptions); }, [assumptions]);

  const watched = ticker ? watchlist.includes(ticker) : false;
  const toggleWatch = (t) =>
    setWatchlist((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));
  const removeWatch = (t) => setWatchlist((list) => list.filter((x) => x !== t));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (key, value) => setAssumptions((a) => ({ ...a, [key]: value }));

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);

    // Debounced so dragging a slider fires one request, not thirty.
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ ticker, ...assumptions });
        const res = await fetch(`/api/dcf?${qs}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) { setData(json); setError(null); }
        else { setError(json); setData(null); }
      } catch (err) {
        if (!cancelled) { setError({ error: 'Could not reach the valuation service', detail: err.message }); setData(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [ticker, assumptions]);

  const submit = (e) => {
    e.preventDefault();
    const t = query.trim().toUpperCase();
    if (t) onTicker(t);
  };

  return (
    <div>
      <form onSubmit={submit} className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ticker — e.g. AAPL, NVDA, T"
          className="flex-1 bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-salmon/50 transition-colors uppercase placeholder:normal-case"
          aria-label="Ticker symbol"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm bg-salmon/20 text-salmon hover:bg-salmon/30 transition-colors font-medium shrink-0"
        >
          Value it
        </button>
      </form>

      {/* The explainer only earns the space while there is nothing to show. With a
          watchlist saved, that becomes the landing surface instead. */}
      {!ticker && watchlist.length === 0 && (
        <div className="text-center py-16 px-4">
          <p className="font-headline text-xl text-gray-300 mb-2">Discounted cash flow</p>
          <p className="text-gray-600 text-sm max-w-md mx-auto leading-relaxed">
            Enter a US-listed ticker. Fundamentals come straight from SEC filings; you supply the
            assumptions. Covers US SEC filers only — and free-cash-flow DCF does not apply to
            banks or insurers.
          </p>
          <p className="text-gray-700 text-xs mt-3">Star a ticker to keep it on a watchlist here.</p>
        </div>
      )}

      {/* The controls render whenever there is anything to re-rate, not just when a
          ticker is open — a watchlist labelled "your current assumptions" with no
          way to reach those assumptions would be a dead end. */}
      {(ticker || watchlist.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* On narrow screens the verdict comes first — scrolling past five sliders
              to reach the answer is the wrong order on a phone. */}
          <div className="lg:col-span-2 space-y-3 order-2 lg:order-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
              <Assumption
                label="Discount rate (WACC)" value={assumptions.wacc} onChange={(v) => set('wacc', v)}
                min={4} max={20} step={0.5}
                hint="Your required annual return. Higher means you demand more compensation for risk."
              />
              <Assumption
                label="Initial FCF growth" value={assumptions.growth} onChange={(v) => set('growth', v)}
                min={-10} max={40} step={0.5}
                hint="Year-one growth, fading linearly to the terminal rate."
              />
              <Assumption
                label="Terminal growth" value={assumptions.terminalGrowth} onChange={(v) => set('terminalGrowth', v)}
                min={0} max={4} step={0.1}
                hint="Perpetual growth after the forecast. Above long-run GDP is not defensible."
              />
              <Assumption
                label="Forecast years" value={assumptions.years} onChange={(v) => set('years', v)}
                min={3} max={20} step={1} suffix="y"
                hint="Length of the explicit forecast before terminal value takes over."
              />
            </div>

            <div className="bg-dark/40 border border-dark-border/60 rounded p-2.5">
              <p className="text-[11px] text-gray-400 mb-2">Cash flow basis</p>
              <div className="flex gap-1">
                {Object.entries(BASIS_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => set('basis', key)}
                    className={`flex-1 px-2 py-1.5 text-[11px] rounded transition-colors ${
                      assumptions.basis === key
                        ? 'bg-salmon/20 text-salmon font-medium'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setAssumptions(DCF_DEFAULTS)}
              className="text-[11px] text-gray-600 hover:text-salmon-dim transition-colors"
            >
              Reset assumptions
            </button>
          </div>

          <div className="lg:col-span-3 space-y-4 order-1 lg:order-2">
            {loading && !data && !error && (
              <div className="text-center py-16 text-gray-500 text-sm">Pulling filings from SEC EDGAR…</div>
            )}

            {error && (
              <div className="bg-dark-card border border-red-500/30 rounded-lg p-4">
                <p className="text-red-400 text-sm mb-1">{error.error}</p>
                {error.detail && <p className="text-gray-500 text-[11px] leading-relaxed">{error.detail}</p>}
                {error.history?.length > 0 && (
                  <p className="text-gray-600 text-[11px] mt-2">
                    Last free cash flow on record: {fmtMoney(error.history.at(-1).freeCashFlow)} for{' '}
                    {error.history.at(-1).periodEnd}.
                  </p>
                )}
              </div>
            )}

            {data && (
              <div className={loading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                <div className="flex items-baseline gap-2 mb-3 flex-wrap">
                  <h2 className="font-headline text-xl text-gray-100">{data.company}</h2>
                  <span className="text-salmon-dim text-[11px] font-mono bg-dark-border/40 px-1.5 py-0.5 rounded">
                    {data.ticker}
                  </span>
                  {data.quote?.exchange && (
                    <span className="text-[10px] text-gray-600 uppercase tracking-wide">{data.quote.exchange}</span>
                  )}
                  <button
                    onClick={() => toggleWatch(data.ticker)}
                    title={watched ? `Remove ${data.ticker} from watchlist` : `Add ${data.ticker} to watchlist`}
                    aria-pressed={watched}
                    className={`text-sm leading-none transition-colors ${watched ? 'text-salmon' : 'text-gray-600 hover:text-salmon-dim'}`}
                  >
                    {watched ? '★' : '☆'}
                  </button>
                  {loading && <span className="text-[10px] text-gray-600 ml-auto">recalculating…</span>}
                </div>

                <div className="space-y-4">
                  <VerdictCard data={data} />

                  <div className="bg-dark-card border border-salmon/20 rounded-lg p-4">
                    <h3 className="text-sm text-gray-200 mb-1.5">What the price already assumes</h3>
                    <p className="text-gray-300 text-xs leading-relaxed">{data.reverseDcf.note}</p>
                    <p className="text-gray-600 text-[10px] mt-2 leading-relaxed">
                      Often more useful than the fair value above: rather than asking what the stock is
                      worth, it asks what you would have to believe to pay today's price.
                    </p>
                  </div>

                  {data.warnings.length > 0 && (
                    <div className="space-y-1.5">
                      {data.warnings.map((w, i) => (
                        <p key={i} className="text-gray-500 text-[11px] leading-relaxed bg-dark-card border border-dark-border rounded p-2.5">
                          ⚠ {w}
                        </p>
                      ))}
                    </div>
                  )}

                  <SensitivityGrid sensitivity={data.sensitivity} price={data.quote?.price} />
                  {data.history.length > 1 && <HistoryStrip history={data.history} />}
                  <Provenance data={data} />

                  <p className="text-gray-700 text-[10px] text-center leading-relaxed">
                    {data.disclaimer}
                  </p>
                </div>
              </div>
            )}

            {/* Sits below the open valuation, or stands alone when nothing is open. */}
            {watchlist.length > 0 && (
              <WatchlistPanel
                tickers={watchlist}
                assumptions={assumptions}
                onSelect={onTicker}
                onRemove={removeWatch}
                heading={ticker ? 'Watchlist · same assumptions' : 'Watchlist'}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState('signals');
  const [filters, setFilters] = useState(defaultFilters);
  const [showTrending, setShowTrending] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [signalsList, setSignalsList] = useState([]);
  const [sourceHealth, setSourceHealth] = useState([]);
  const [valuationTicker, setValuationTicker] = useState(null);

  const openValuation = useCallback((ticker) => {
    setValuationTicker(ticker.toUpperCase());
    setMode('valuation');
  }, []);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const activeCount = Object.entries(filters).filter(([k, v]) => k !== 'search' && v !== 'all').length + (filters.search ? 1 : 0);

  const handleDataLoaded = useCallback((signals, sources) => {
    setSignalsList(signals);
    setSourceHealth(sources);
  }, []);

  return (
    <RatingsProvider>
      <ValuationCtx.Provider value={openValuation}>
      <div className="min-h-screen bg-dark font-body">
        <header className="border-b border-dark-border sticky top-0 z-10 bg-dark/95 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <LogoMark className="w-6 h-[22px] shrink-0" />
                <div className="min-w-0">
                  <h1 className="font-headline text-salmon text-xl sm:text-2xl tracking-tight leading-none">Vantageous</h1>
                  <p className="text-gray-600 text-[10px] mt-0.5 hidden sm:block">AI-powered market intelligence</p>
                </div>
              </div>
              <div className="flex items-center bg-dark-card border border-dark-border rounded-lg p-0.5 gap-0.5 shrink-0">
                <button onClick={() => setMode('signals')}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded transition-colors ${mode === 'signals' ? 'bg-salmon/20 text-salmon font-medium' : 'text-gray-400 hover:text-gray-200'}`}
                >Signals</button>
                <button onClick={() => setMode('briefing')}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded transition-colors ${mode === 'briefing' ? 'bg-salmon/20 text-salmon font-medium' : 'text-gray-400 hover:text-gray-200'}`}
                >Briefing</button>
                <button onClick={() => setMode('valuation')}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded transition-colors ${mode === 'valuation' ? 'bg-salmon/20 text-salmon font-medium' : 'text-gray-400 hover:text-gray-200'}`}
                >Valuation</button>
              </div>
            </div>
          </div>

          {mode === 'signals' && (
            <FilterBar
              filters={filters}
              onChange={setFilter}
              onClear={() => setFilters(defaultFilters())}
              activeCount={activeCount}
              onTrending={() => setShowTrending(true)}
              onSources={() => setShowSources(true)}
            />
          )}
        </header>

        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-5">
          {mode === 'signals' && (
            <SignalsView filters={filters} setFilters={setFilters} onDataLoaded={handleDataLoaded} />
          )}
          {mode === 'briefing' && <BriefingView />}
          {/* Kept mounted rather than conditionally rendered so a ticker you were
              looking at is still there when you come back from the signal feed. */}
          <div className={mode === 'valuation' ? '' : 'hidden'}>
            <ValuationView ticker={valuationTicker} onTicker={setValuationTicker} />
          </div>
        </main>

        <footer className="border-t border-dark-border mt-12 py-5 text-center text-gray-700 text-[11px]">
          FT · BBC · Guardian · CNBC · Economist · Yahoo · MarketWatch & more · Analysis by Claude · Not financial advice
        </footer>

        {showTrending && <TrendingModal signals={signalsList} onClose={() => setShowTrending(false)} />}
        {showSources && <SourcesModal onClose={() => setShowSources(false)} sources={sourceHealth} />}
      </div>
      </ValuationCtx.Provider>
    </RatingsProvider>
  );
}
