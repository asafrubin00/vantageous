import { useState, useEffect, useCallback } from 'react';

const SECTIONS = ['Home', 'Markets', 'UK', 'World', 'Opinion', 'Tech'];
const REFRESH_INTERVAL = 20 * 60 * 1000;

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

export default function App() {
  const [section, setSection] = useState('Home');
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefing?section=${section.toLowerCase()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setArticles(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    fetchBriefing();
    const interval = setInterval(fetchBriefing, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchBriefing]);

  return (
    <div className="min-h-screen bg-dark font-body">
      {/* Header */}
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
          <nav className="flex gap-1 overflow-x-auto pb-1 -mb-4 scrollbar-none">
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`px-3 py-2 text-sm rounded-t-md whitespace-nowrap transition-colors ${
                  s === section
                    ? 'text-salmon border-b-2 border-salmon font-medium'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg p-4 mb-6 text-sm">
            Failed to load briefing: {error}
          </div>
        )}

        {loading && articles.length === 0 ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-dark-card border border-dark-border rounded-lg p-5 animate-pulse">
                <div className="h-5 bg-dark-border rounded w-3/4 mb-3" />
                <div className="h-3 bg-dark-border rounded w-full mb-2" />
                <div className="h-3 bg-dark-border rounded w-5/6" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {articles.map((article, i) => (
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

      {/* Footer */}
      <footer className="border-t border-dark-border mt-12 py-6 text-center text-gray-600 text-xs">
        Data sourced from Financial Times RSS &middot; Auto-refreshes every 20 minutes
      </footer>
    </div>
  );
}
