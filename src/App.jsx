import { useState, useEffect, useCallback } from 'react';

const SECTIONS = ['Home', 'Markets', 'UK', 'World', 'Opinion', 'Tech'];
const REFRESH_INTERVAL = 20 * 60 * 1000;
const STORAGE_KEY = 'ft-briefing-custom-filters';

const BUILT_IN_FILTERS = [
  { id: '__opinion', name: 'Opinion', type: 'feed', feedSection: 'opinion' },
  { id: '__south-africa', name: 'South Africa', type: 'keyword', keywords: ['south africa'] },
  {
    id: '__eu-expansion',
    name: 'EU Expansion',
    type: 'keyword',
    keywords: ['eu expansion', 'european union expansion', 'eu enlargement'],
  },
];

function loadCustomFilters() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCustomFilters(filters) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function matchesKeywords(article, keywords) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

function FilterModal({ onSave, onCancel }) {
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');

  const handleSave = () => {
    const trimmedName = name.trim();
    const parsedKeywords = keywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (!trimmedName || parsedKeywords.length === 0) return;
    onSave({ name: trimmedName, keywords: parsedKeywords });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-card border border-dark-border rounded-lg p-6 w-full max-w-md">
        <h2 className="font-headline text-salmon text-lg mb-4">Add Filter</h2>
        <label className="block text-gray-400 text-xs mb-1">Filter name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Climate"
          className="w-full bg-dark border border-dark-border rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-salmon/50 focus:outline-none mb-4"
        />
        <label className="block text-gray-400 text-xs mb-1">Keywords (comma separated)</label>
        <input
          type="text"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="e.g. climate change, global warming, net zero"
          className="w-full bg-dark border border-dark-border rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-salmon/50 focus:outline-none mb-6"
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-200 text-sm px-4 py-1.5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-salmon/20 text-salmon hover:bg-salmon/30 border border-salmon/30 rounded px-4 py-1.5 text-sm font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState('Home');
  const [activeFilter, setActiveFilter] = useState(null);
  const [articles, setArticles] = useState([]);
  const [homeArticles, setHomeArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [customFilters, setCustomFilters] = useState(loadCustomFilters);
  const [showModal, setShowModal] = useState(false);
  const [hoveredFilter, setHoveredFilter] = useState(null);

  const allFilters = [...BUILT_IN_FILTERS, ...customFilters];

  const fetchFeed = useCallback(async (feedSection) => {
    const res = await fetch(`/api/briefing?section=${feedSection}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFeed(section.toLowerCase());
      setArticles(data);
      setLastUpdated(new Date());

      if (section.toLowerCase() === 'home') {
        setHomeArticles(data);
      } else {
        fetchFeed('home').then(setHomeArticles).catch(() => {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [section, fetchFeed]);

  useEffect(() => {
    setActiveFilter(null);
    fetchBriefing();
    const interval = setInterval(fetchBriefing, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchBriefing]);

  const handleFilterClick = async (filter) => {
    if (activeFilter?.id === filter.id) {
      setActiveFilter(null);
      return;
    }
    setActiveFilter(filter);

    if (filter.type === 'feed') {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchFeed(filter.feedSection);
        setArticles(data);
        setLastUpdated(new Date());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleAddFilter = ({ name, keywords }) => {
    const newFilter = {
      id: `custom-${Date.now()}`,
      name,
      type: 'keyword',
      keywords,
    };
    const updated = [...customFilters, newFilter];
    setCustomFilters(updated);
    saveCustomFilters(updated);
    setShowModal(false);
  };

  const handleDeleteFilter = (id) => {
    const updated = customFilters.filter((f) => f.id !== id);
    setCustomFilters(updated);
    saveCustomFilters(updated);
    if (activeFilter?.id === id) setActiveFilter(null);
  };

  let displayedArticles = articles;
  if (activeFilter) {
    if (activeFilter.type === 'keyword') {
      displayedArticles = homeArticles.filter((a) =>
        matchesKeywords(a, activeFilter.keywords)
      );
    }
  }

  return (
    <div className="min-h-screen bg-dark font-body">
      <header className="border-b border-dark-border sticky top-0 bg-dark/95 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-headline text-salmon text-2xl sm:text-3xl tracking-tight">
                FT Morning Briefing
              </h1>
              <p className="text-gray-500 text-xs mt-1 font-body">
                {lastUpdated
                  ? `Last updated ${formatTimestamp(lastUpdated)}`
                  : 'Loading…'}
              </p>
            </div>
            <button
              onClick={fetchBriefing}
              disabled={loading}
              className="text-salmon-dim hover:text-salmon border border-dark-border hover:border-salmon/40 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Section tabs */}
          <nav className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`px-3 py-2 text-sm rounded-t-md whitespace-nowrap transition-colors ${
                  s === section && !activeFilter
                    ? 'text-salmon border-b-2 border-salmon font-medium'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </nav>

          {/* My Filters row */}
          <div className="flex items-center gap-2 overflow-x-auto pt-2 pb-1 -mb-4 scrollbar-none border-t border-dark-border/50 mt-1">
            <span className="text-gray-600 text-[11px] uppercase tracking-wider shrink-0 mr-1">
              My Filters
            </span>
            {allFilters.map((f) => (
              <div
                key={f.id}
                className="relative shrink-0"
                onMouseEnter={() => setHoveredFilter(f.id)}
                onMouseLeave={() => setHoveredFilter(null)}
              >
                <button
                  onClick={() => handleFilterClick(f)}
                  className={`px-2.5 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                    activeFilter?.id === f.id
                      ? 'text-salmon bg-salmon/10 border border-salmon/30 font-medium'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-dark-border'
                  }`}
                >
                  {f.name}
                </button>
                {!f.id.startsWith('__') && hoveredFilter === f.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFilter(f.id);
                    }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-dark-card border border-dark-border rounded-full text-gray-500 hover:text-red-400 hover:border-red-400/50 text-[10px] flex items-center justify-center transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setShowModal(true)}
              className="px-2.5 py-1.5 text-xs text-gray-600 hover:text-salmon border border-dashed border-dark-border hover:border-salmon/30 rounded whitespace-nowrap transition-colors shrink-0"
            >
              + Add Filter
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg p-4 mb-6 text-sm">
            Failed to load briefing: {error}
          </div>
        )}

        {loading && displayedArticles.length === 0 ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-dark-card border border-dark-border rounded-lg p-5 animate-pulse">
                <div className="h-5 bg-dark-border rounded w-3/4 mb-3" />
                <div className="h-3 bg-dark-border rounded w-full mb-2" />
                <div className="h-3 bg-dark-border rounded w-5/6" />
              </div>
            ))}
          </div>
        ) : displayedArticles.length === 0 && activeFilter?.type === 'keyword' ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-1">No articles match "{activeFilter.name}"</p>
            <p className="text-sm">Try broadening your keywords or check back later.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayedArticles.map((article, i) => (
              <article
                key={`${article.link}-${i}`}
                className="bg-dark-card border border-dark-border rounded-lg p-5 hover:border-salmon/30 transition-colors group"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <a
                    href={article.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-headline text-lg sm:text-xl text-gray-100 group-hover:text-salmon transition-colors leading-snug"
                  >
                    {article.title}
                  </a>
                  {article.pubDate && (
                    <span className="text-gray-500 text-xs whitespace-nowrap mt-1">
                      {timeAgo(article.pubDate)}
                    </span>
                  )}
                </div>

                {article.description && (
                  <p className="text-gray-400 text-sm leading-relaxed mb-3">
                    {article.description}
                  </p>
                )}

                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-salmon-dim hover:text-salmon text-sm font-medium transition-colors"
                >
                  Read full article &rarr;
                </a>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-dark-border mt-12 py-6 text-center text-gray-600 text-xs">
        Data sourced from Financial Times RSS &middot; Auto-refreshes every 20 minutes
      </footer>

      {showModal && (
        <FilterModal onSave={handleAddFilter} onCancel={() => setShowModal(false)} />
      )}
    </div>
  );
}
