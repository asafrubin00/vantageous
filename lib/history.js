// Persistent valuation history.
//
// Browser storage gave every device its own record and only accrued on days the app
// was opened. This is the shared, always-on version: snapshots live in Postgres, and
// a daily job records one for every tracked ticker whether or not anyone visits.
//
// Every snapshot carries the fingerprint of the assumptions behind it. Fair value
// moves both when a company's filings change and when a reader moves a slider, and
// only the first is news, so comparisons are only ever made within one fingerprint.

import { neon } from '@neondatabase/serverless';

export const DEFAULT_FINGERPRINT = '9|8|2.5|10|ttm';

export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

let sqlClient = null;
let schemaReady = null;

function client() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

// Created lazily rather than through a migration step — the schema is two small
// tables and this keeps the project deployable from a clean checkout.
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  const sql = client();
  schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS snapshots (
        ticker       text        NOT NULL,
        taken_on     date        NOT NULL,
        fingerprint  text        NOT NULL,
        price        numeric     NOT NULL,
        fair_value   numeric     NOT NULL,
        upside       numeric     NOT NULL,
        model        text        NOT NULL,
        company      text,
        PRIMARY KEY (ticker, taken_on, fingerprint)
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS tracked (
        ticker     text PRIMARY KEY,
        last_seen  timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS snapshots_ticker_fp ON snapshots (ticker, fingerprint, taken_on DESC)`;
  })().catch((err) => {
    schemaReady = null; // let a later request retry rather than failing forever
    throw err;
  });
  return schemaReady;
}

// One row per ticker per day per fingerprint. Re-running the same valuation an hour
// later is not a new observation, so the same day overwrites rather than appends.
export async function recordSnapshot({ ticker, price, fairValue, upside, model, company, fingerprint }) {
  await ensureSchema();
  const sql = client();
  await sql`
    INSERT INTO snapshots (ticker, taken_on, fingerprint, price, fair_value, upside, model, company)
    VALUES (${ticker}, CURRENT_DATE, ${fingerprint}, ${price}, ${fairValue}, ${upside}, ${model}, ${company ?? null})
    ON CONFLICT (ticker, taken_on, fingerprint)
    DO UPDATE SET price = EXCLUDED.price, fair_value = EXCLUDED.fair_value,
                  upside = EXCLUDED.upside, model = EXCLUDED.model, company = EXCLUDED.company`;
}

// Any ticker anyone values becomes tracked, which is what the daily job walks. That
// makes the record compound from ordinary use rather than needing a curated list.
export async function markTracked(ticker) {
  await ensureSchema();
  const sql = client();
  await sql`
    INSERT INTO tracked (ticker, last_seen) VALUES (${ticker}, now())
    ON CONFLICT (ticker) DO UPDATE SET last_seen = now()`;
}

export async function trackedTickers(limit = 60) {
  await ensureSchema();
  const sql = client();
  const rows = await sql`SELECT ticker FROM tracked ORDER BY last_seen DESC LIMIT ${limit}`;
  return rows.map((r) => r.ticker);
}

export async function snapshotsFor(tickers, fingerprint, days = 400) {
  await ensureSchema();
  const sql = client();
  const rows = await sql`
    SELECT ticker, taken_on, price, fair_value, upside, model
    FROM snapshots
    WHERE ticker = ANY(${tickers}) AND fingerprint = ${fingerprint}
      AND taken_on >= CURRENT_DATE - ${days}::int
    ORDER BY ticker, taken_on ASC`;

  const byTicker = {};
  for (const r of rows) {
    (byTicker[r.ticker] ??= []).push({
      d: typeof r.taken_on === 'string' ? r.taken_on.slice(0, 10) : new Date(r.taken_on).toISOString().slice(0, 10),
      p: Number(r.price),
      f: Number(r.fair_value),
      u: Number(r.upside),
      m: r.model,
    });
  }
  return byTicker;
}
