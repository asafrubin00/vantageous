// Reads and writes the shared valuation record.
//
// GET  /api/history?tickers=AAPL,T&fingerprint=9|8|2.5|10|ttm
// POST /api/history   { ticker, price, fairValue, upside, model, company, fingerprint }
//
// Writes come from ordinary use — whenever anyone values a company the result is
// filed — so the record thickens through use as well as through the daily job.

import { hasDatabase, recordSnapshot, markTracked, snapshotsFor, DEFAULT_FINGERPRINT } from '../lib/history.js';

const TICKER = /^[A-Z0-9.\-]{1,10}$/;

export default async function handler(req, res) {
  // The client keeps its own local copy, so a missing database degrades to
  // browser-only history rather than breaking the view.
  if (!hasDatabase()) {
    return res.status(200).json({ available: false, snapshots: {} });
  }

  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
      const ticker = String(body.ticker ?? '').toUpperCase();
      if (!TICKER.test(ticker)) return res.status(400).json({ error: 'valid ticker required' });

      const nums = ['price', 'fairValue', 'upside'].map((k) => Number(body[k]));
      if (nums.some((n) => !Number.isFinite(n))) {
        return res.status(400).json({ error: 'price, fairValue and upside must be numbers' });
      }
      const [price, fairValue, upside] = nums;

      await recordSnapshot({
        ticker,
        price,
        fairValue,
        upside,
        model: String(body.model ?? 'free-cash-flow').slice(0, 40),
        company: body.company ? String(body.company).slice(0, 120) : null,
        fingerprint: String(body.fingerprint ?? DEFAULT_FINGERPRINT).slice(0, 60),
      });
      await markTracked(ticker);

      return res.status(200).json({ available: true, recorded: true });
    }

    const raw = String(req.query.tickers ?? req.query.ticker ?? '');
    const tickers = raw.split(',').map((t) => t.trim().toUpperCase()).filter((t) => TICKER.test(t)).slice(0, 60);
    if (!tickers.length) return res.status(400).json({ error: 'tickers required' });

    const fingerprint = String(req.query.fingerprint ?? DEFAULT_FINGERPRINT).slice(0, 60);
    const snapshots = await snapshotsFor(tickers, fingerprint);

    // Short cache: the record changes at most daily, but a reader flicking between
    // tickers should not re-query for each one.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ available: true, fingerprint, snapshots });
  } catch (err) {
    // History is an enhancement; if it is broken the valuation view must still work.
    return res.status(200).json({ available: false, error: err.message, snapshots: {} });
  }
}
