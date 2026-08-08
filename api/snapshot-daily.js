// Daily job: values every tracked company at the default assumptions and files the
// result, so the record compounds whether or not anyone opens the app. Browser
// storage could only ever record the days someone happened to visit.

import { hasDatabase, trackedTickers, recordSnapshot, DEFAULT_FINGERPRINT } from '../lib/history.js';
import dcf from './dcf.js';

// Calls the valuation handler directly rather than over HTTP — same process, no
// self-request, and no dependency on knowing the deployment's own URL.
function valuation(ticker) {
  return new Promise((resolve) => {
    const shim = {
      code: 200,
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(body) { resolve({ code: this.code, body }); return this; },
    };
    dcf({ query: { ticker } }, shim).catch((err) => resolve({ code: 500, body: { error: err.message } }));
  });
}

export default async function handler(req, res) {
  // Vercel signs cron invocations with CRON_SECRET when it is set. Without this the
  // endpoint would be an open trigger for a job that does real work.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  }

  if (!hasDatabase()) return res.status(200).json({ skipped: 'DATABASE_URL not configured' });

  const started = Date.now();
  try {
    const tickers = await trackedTickers();
    if (!tickers.length) return res.status(200).json({ tracked: 0, recorded: 0 });

    let recorded = 0;
    const skipped = [];

    // Sequential in small groups: EDGAR is a shared public service and this job has
    // all day to finish, so there is nothing to gain from hammering it.
    for (let i = 0; i < tickers.length; i += 4) {
      const group = tickers.slice(i, i + 4);
      const results = await Promise.all(group.map(valuation));

      for (let j = 0; j < group.length; j++) {
        const ticker = group[j];
        const { code, body } = results[j];

        // A refusal is a legitimate outcome, not a failure — some filers genuinely
        // cannot be valued. Recording nothing keeps the series honest.
        if (code !== 200 || !body?.quote?.price || body?.verdict?.upside === null || body?.verdict?.upside === undefined) {
          skipped.push({ ticker, reason: (body?.error ?? `status ${code}`).slice(0, 90) });
          continue;
        }

        await recordSnapshot({
          ticker,
          price: body.quote.price,
          fairValue: body.valuation.perShare,
          upside: body.verdict.upside,
          model: body.model?.kind ?? 'free-cash-flow',
          company: body.company,
          fingerprint: DEFAULT_FINGERPRINT,
        });
        recorded++;
      }
    }

    return res.status(200).json({
      tracked: tickers.length,
      recorded,
      skipped,
      seconds: +((Date.now() - started) / 1000).toFixed(1),
    });
  } catch (err) {
    return res.status(500).json({ error: 'snapshot job failed', detail: err.message });
  }
}
