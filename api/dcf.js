// Discounted cash flow valuation for US-listed filers.
//
// Fundamentals come from SEC EDGAR's XBRL companyfacts API (free, no key, but the
// tagging is inconsistent between filers so every metric needs a fallback chain).
// Spot price comes from Yahoo's chart endpoint.

const UA = 'Vantageous DCF (rubin.asaf01@gmail.com)';
const DAY = 86400_000;

// Tag fallback chains, in priority order. First hit wins — these are alternatives
// for the same line item, not components to be summed.
const TAGS = {
  ocf: [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  ],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    // Verizon and other telecoms tag capex here. One word away from the entry
    // above, and its absence silently cost the whole sector.
    'PaymentsToAcquireOtherProductiveAssets',
    'PaymentsForCapitalImprovements',
    'PaymentsToAcquireOtherPropertyPlantAndEquipment',
  ],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ],
  shortTermInvestments: [
    'ShortTermInvestments',
    'MarketableSecuritiesCurrent',
    'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
    'OtherShortTermInvestments',
  ],
  longTermDebt: [
    'LongTermDebtNoncurrent',
    'LongTermDebtAndCapitalLeaseObligations',
    'LongTermDebt',
  ],
  shortTermDebt: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  coverShares: ['EntityCommonStockSharesOutstanding'],
  // Banks, insurers and REITs report no usable capital expenditure, so free cash
  // flow cannot be built for them at all. What they do report is dividends, which
  // is the basis of the standard alternative model for exactly these filers.
  dividendPerShare: [
    'CommonStockDividendsPerShareDeclared',
    'CommonStockDividendsPerShareCashPaid',
  ],
};

// Ordinary synonyms for capital expenditure. Anything outside this set is a
// narrower line item (REIT capital improvements, for one) that understates real
// investment spend, so it is worth flagging when it ends up driving the model.
const STANDARD_CAPEX = new Set([
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
  // Despite the "Other", this is Verizon's whole capital programme — roughly $17bn
  // against $37bn of operating cash flow — not a subset of a larger line.
  'PaymentsToAcquireOtherProductiveAssets',
  'PaymentsToAcquireOtherPropertyPlantAndEquipment',
]);

let tickerMapCache = null;

async function tickerToCik(ticker) {
  if (!tickerMapCache) {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) throw new Error(`SEC ticker map unavailable (${r.status})`);
    const raw = await r.json();
    tickerMapCache = new Map(
      Object.values(raw).map((e) => [e.ticker.toUpperCase(), { cik: e.cik_str, name: e.title }])
    );
  }
  // EDGAR writes class shares as BRK-B; people type BRK.B.
  return tickerMapCache.get(ticker.toUpperCase()) || tickerMapCache.get(ticker.toUpperCase().replace('.', '-'));
}

// A ticker can point at an entity that holds the listing but not the history. XOM
// resolves to ExxonMobil Holdings Corp, a successor registrant with 10-Qs and an
// 8-K12B but no 10-K, while three decades of filings sit under Exxon Mobil Corp on
// a different CIK the ticker map never mentions. EDGAR's company search, restricted
// to filers that have actually filed a 10-K, can find the entity holding the history.
const CORPORATE_SUFFIXES = /\b(holdings?|corp(oration)?|inc(orporated)?|company|co|group|plc|ltd|limited|llc|lp|nv|sa|ag|the)\b\.?/gi;

const squash = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// EDGAR matches company names by prefix, so a compound registrant name like
// "ExxonMobil" never matches the registrant "EXXON MOBIL CORP". Progressively
// shorter prefixes give the prefix match something to bite on.
function searchTerms(name) {
  const stripped = name.replace(CORPORATE_SUFFIXES, ' ').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const first = stripped.split(' ')[0] ?? '';
  const terms = [stripped, first, first.slice(0, 8), first.slice(0, 6), first.slice(0, 5)];
  return [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 4))];
}

async function findFilingEntity(name, excludeCik) {
  for (const term of searchTerms(name)) {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(term)}&type=10-K&dateb=&owner=include&count=10&action=getcompany&output=atom`;
    let xml;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      xml = await r.text();
    } catch { continue; }

    const ciks = [...xml.matchAll(/<cik>(\d+)<\/cik>/g)].map((m) => +m[1]);
    const names = [...xml.matchAll(/<conformed-name>([^<]+)<\/conformed-name>/g)].map((m) => m[1]);

    for (let i = 0; i < ciks.length; i++) {
      // Only accept a candidate whose name genuinely extends the search term, so a
      // short prefix cannot quietly substitute an unrelated company.
      if (ciks[i] !== excludeCik && names[i] && squash(names[i]).startsWith(squash(term))) {
        return { cik: ciks[i], name: names[i] };
      }
    }
  }
  return null;
}

async function companyFacts(cik) {
  const padded = String(cik).padStart(10, '0');
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, {
    headers: { 'User-Agent': UA },
  });
  if (!r.ok) throw new Error(`No EDGAR filings found (${r.status})`);
  return r.json();
}

// Filers switch tags mid-history — NVDA reports capex under
// PaymentsToAcquirePropertyPlantAndEquipment through 2012 and
// PaymentsToAcquireProductiveAssets from 2022. Taking only the first tag that
// exists would silently truncate the series to a dead decade, so merge every tag
// in the chain and let priority settle the periods where they overlap.
function resolve(facts, chain, unit) {
  const entries = [];
  chain.forEach((tag, prio) => {
    for (const ns of ['us-gaap', 'dei']) {
      const found = facts[ns]?.[tag]?.units?.[unit];
      if (found?.length) entries.push(...found.map((e) => ({ ...e, tag, prio })));
    }
  });
  return entries.length ? { entries } : null;
}

// A given period appears in several filings — restated in later 10-Ks, and possibly
// under more than one tag. Prefer the higher-priority tag, then the latest filing.
function better(a, b) {
  if (!a) return b;
  if (a.prio !== b.prio) return a.prio < b.prio ? a : b;
  return a.filed > b.filed ? a : b;
}

// Dividend tags need a different rule from the rest. Prologis reports
// CommonStockDividendsPerShareDeclared as $0.02, $0.00, $0.01, $0.03 while its
// actual dividend sits in CommonStockDividendsPerShareCashPaid at $3.16 to $4.04 —
// both tags covering the same years. Tag priority would pick the artifact and value
// the company at a fiftieth of its dividend, so within a period the larger figure
// wins across tags, while restatements of the same tag still resolve by filing date.
function betterDividend(a, b) {
  if (!a) return b;
  if (a.tag === b.tag) return a.filed > b.filed ? a : b;
  return a.val >= b.val ? a : b;
}

function dedupeByPeriod(entries, keyFn, pick = better) {
  const best = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    best.set(k, pick(best.get(k), e));
  }
  return [...best.values()];
}

function annualSeries(entries, pick = better) {
  const annual = entries.filter((e) => {
    if (e.form !== '10-K' || !e.start) return false;
    const days = (Date.parse(e.end) - Date.parse(e.start)) / DAY;
    return days >= 330 && days <= 400; // exclude quarterly rows carried inside a 10-K
  });
  return dedupeByPeriod(annual, (e) => `${e.start}:${e.end}`, pick).sort((a, b) => a.end.localeCompare(b.end));
}

// The last 10-K can be nearly a year old. Roll it forward using year-to-date figures
// from the interim filings: TTM = last full year + current YTD - prior-year same YTD.
function trailingTwelveMonths(entries, latestAnnual, pick = better) {
  if (!latestAnnual) return null;
  const durations = dedupeByPeriod(
    entries.filter((e) => e.start),
    (e) => `${e.start}:${e.end}`,
    pick
  );

  const ytd = durations
    .filter((e) => e.end > latestAnnual.end && Date.parse(e.end) - Date.parse(e.start) < 360 * DAY)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!ytd) return null;

  const span = Date.parse(ytd.end) - Date.parse(ytd.start);
  const priorEnd = Date.parse(ytd.end) - 365 * DAY;
  const prior = durations.find(
    (e) =>
      Math.abs(Date.parse(e.end) - priorEnd) < 20 * DAY &&
      Math.abs(Date.parse(e.end) - Date.parse(e.start) - span) < 20 * DAY
  );
  if (!prior) return null;

  return { val: latestAnnual.val + ytd.val - prior.val, through: ytd.end, ytdSpanDays: Math.round(span / DAY) };
}

function latestInstant(entries) {
  const instants = dedupeByPeriod(entries.filter((e) => !e.start), (e) => e.end);
  if (!instants.length) return null;
  return instants.sort((a, b) => b.end.localeCompare(a.end))[0];
}

// Dividends per share are already a per-share figure, so a dividend discount model
// needs no share count and no net debt bridge — the discounted stream is the value
// of a share directly. That lets it reuse the same projection maths as the cash flow
// model by passing a net debt of zero against a single share.
function dividendPlan(facts) {
  const ref = resolve(facts, TAGS.dividendPerShare, 'USD/shares');
  if (!ref) return null;

  const annual = annualSeries(ref.entries, betterDividend);
  if (!annual.length) return null;

  const history = annual.map((e) => ({ periodEnd: e.end, dividendPerShare: e.val, tag: e.tag }));
  const latestFy = history[history.length - 1];
  const ttmRaw = trailingTwelveMonths(ref.entries, annual[annual.length - 1], betterDividend);
  const ttm = ttmRaw ? { dividendPerShare: ttmRaw.val, through: ttmRaw.through } : null;
  const avg3 = history.slice(-3).reduce((s, h) => s + h.dividendPerShare, 0) / Math.min(3, history.length);

  return { history, latestFy, ttm, avg3, tag: annual[annual.length - 1].tag };
}

async function spotPrice(ticker) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!r.ok) return null;
  const meta = (await r.json())?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  return { price: meta.regularMarketPrice, currency: meta.currency, exchange: meta.fullExchangeName };
}

// Growth fades linearly from the initial rate to the terminal rate across the
// forecast window, rather than stepping off a cliff in the final year.
function growthPath(initial, terminal, years) {
  return Array.from({ length: years }, (_, i) =>
    years === 1 ? terminal : initial + ((terminal - initial) * i) / (years - 1)
  );
}

function valueFrom(baseFcf, path, wacc, terminalGrowth, netDebt, shares) {
  let fcf = baseFcf;
  let pvExplicit = 0;
  const rows = [];

  path.forEach((g, i) => {
    const year = i + 1;
    fcf = fcf * (1 + g);
    const discount = (1 + wacc) ** year;
    const pv = fcf / discount;
    pvExplicit += pv;
    rows.push({ year, growth: g, fcf, pv });
  });

  const terminalValue = (fcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const pvTerminal = terminalValue / (1 + wacc) ** path.length;
  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue - netDebt;

  return {
    rows,
    pvExplicit,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
    perShare: equityValue / shares,
    terminalShare: pvTerminal / enterpriseValue,
  };
}

// What initial growth rate would justify today's price? Monotonic in growth, so bisect.
function impliedGrowth(price, baseFcf, terminal, years, wacc, netDebt, shares) {
  const perShareAt = (g) =>
    valueFrom(baseFcf, growthPath(g, terminal, years), wacc, terminal, netDebt, shares).perShare;

  let lo = -0.5;
  let hi = 1.0;
  if (perShareAt(lo) > price || perShareAt(hi) < price) return null; // price outside solvable range

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (perShareAt(mid) < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
  const wacc = num(req.query.wacc, 9) / 100;
  const terminalGrowth = num(req.query.terminalGrowth, 2.5) / 100;
  const initialGrowth = num(req.query.growth, 8) / 100;
  const years = Math.min(Math.max(Math.round(num(req.query.years, 10)), 1), 20);
  const basis = req.query.basis === 'avg3' || req.query.basis === 'lastFy' ? req.query.basis : 'ttm';

  if (wacc <= terminalGrowth) {
    return res.status(400).json({
      error: 'Discount rate must exceed terminal growth, otherwise terminal value is infinite.',
    });
  }

  try {
    const match = await tickerToCik(ticker);
    if (!match) {
      return res.status(404).json({ error: `${ticker.toUpperCase()} is not a US SEC filer — this tool covers US-listed stocks only.` });
    }

    const warnings = [];
    const sources = {};

    // Read the mapped entity, and if it turns out to hold the listing but not the
    // filings, follow the name to the registrant that does.
    const read = async (entity) => {
      const { facts } = await companyFacts(entity.cik);
      const ocfRef = resolve(facts, TAGS.ocf, 'USD');
      const capexRef = resolve(facts, TAGS.capex, 'USD');
      return {
        facts,
        ocfRef,
        capexRef,
        ocfAnnual: ocfRef ? annualSeries(ocfRef.entries) : [],
        capexAnnual: capexRef ? annualSeries(capexRef.entries) : [],
      };
    };

    let entity = { cik: match.cik, name: match.name };
    let read1 = await read(entity);
    let substituted = null;

    // Only a filer with no annual cash flow at all is a candidate for having its
    // history filed under another registrant. A missing capex tag is a different
    // thing entirely — every bank lacks one — and searching EDGAR for a
    // predecessor that does not exist cost them around a minute each.
    if (!read1.ocfAnnual.length) {
      const alt = await findFilingEntity(match.name, match.cik);
      if (alt) {
        const read2 = await read(alt);
        if (read2.ocfAnnual.length) {
          substituted = { from: match.name, to: alt.name, cik: alt.cik };
          entity = alt;
          read1 = read2;
        }
      }
    }

    const { facts, ocfRef, capexRef, ocfAnnual, capexAnnual } = read1;

    if (!ocfRef) return res.status(422).json({ error: `No operating cash flow reported in EDGAR for ${entity.name}.` });

    // The filers a cash flow model cannot touch — banks, insurers, REITs, utilities
    // tagging capex privately — are precisely the ones a dividend discount model is
    // meant for. Building that instead is a better answer than refusing, provided it
    // is labelled as a different model rather than passed off as the same one.
    const buildDividendModel = (because) => {
      const dp = dividendPlan(facts);
      if (!dp) return null;

      let base;
      let basisUsed = basis;
      let through;
      if (basis === 'ttm' && dp.ttm) { base = dp.ttm.dividendPerShare; through = dp.ttm.through; }
      else if (basis === 'avg3') { base = dp.avg3; through = dp.latestFy.periodEnd; basisUsed = 'avg3'; }
      else { base = dp.latestFy.dividendPerShare; basisUsed = 'lastFy'; through = dp.latestFy.periodEnd; }
      if (basis === 'ttm' && !dp.ttm) { base = dp.latestFy.dividendPerShare; basisUsed = 'lastFy'; through = dp.latestFy.periodEnd; }

      if (!(base > 0)) return null;
      sources.dividendPerShare = dp.tag;

      return {
        model: 'dividend-discount',
        because,
        history: dp.history,
        base,
        basisUsed,
        through,
        netDebt: 0,
        shares: 1,
        latestPeriodEnd: dp.latestFy.periodEnd,
        alternativeBases: {
          ttm: dp.ttm?.dividendPerShare ?? null,
          lastFy: dp.latestFy.dividendPerShare,
          avg3: dp.avg3,
        },
      };
    };

    let plan = null;

    if (!capexRef) {
      plan = buildDividendModel(`${entity.name} reports no capital expenditure, so free cash flow cannot be built from its filings.`);
      if (!plan) {
        return res.status(422).json({
          error: `${entity.name} reports neither capital expenditure nor dividends per share.`,
          detail:
            'Free cash flow cannot be built without capital expenditure, and the dividend discount model that would normally cover such a filer needs a dividend history this one does not report.',
          ticker: ticker.toUpperCase(),
          company: entity.name,
        });
      }
    }

    if (substituted) {
      warnings.push(
        `${ticker.toUpperCase()} maps to ${substituted.from}, which has no 10-K history. Figures are taken from ${substituted.to} (CIK ${substituted.cik}), the registrant holding the filings.`
      );
    }

    if (!plan && (!ocfAnnual.length || !capexAnnual.length)) {
      return res.status(422).json({
        error: `No annual (10-K) cash flow history found for ${entity.name}.`,
        detail:
          'The ticker resolved to a SEC registrant with little or no filing history — often a recently reorganised entity — and no predecessor registrant with a 10-K history could be matched to it.',
        ticker: ticker.toUpperCase(),
        company: entity.name,
      });
    }

    if (!plan) {
      // Pair the two series by fiscal period end so a missing year can't misalign them.
      const capexByEnd = new Map(capexAnnual.map((e) => [e.end, e]));
      const history = ocfAnnual
        .filter((o) => capexByEnd.has(o.end))
        .map((o) => {
          const c = capexByEnd.get(o.end);
          const capex = Math.abs(c.val);
          return { periodEnd: o.end, operatingCashFlow: o.val, capex, freeCashFlow: o.val - capex, capexTag: c.tag };
        });

      if (!history.length) return res.status(422).json({ error: 'Could not align cash flow and capex periods.' });

      const latestFy = history[history.length - 1];
      const latestOcfYear = +ocfAnnual[ocfAnnual.length - 1].end.slice(0, 4);
      const capexLagYears = latestOcfYear - +latestFy.periodEnd.slice(0, 4);

      // A filer can keep reporting cash flow long after it stops tagging capex —
      // Prologis dropped PaymentsForCapitalImprovements after 2018. Valuing recent
      // cash against decade-old investment spend would be worse than not answering,
      // so fall through to dividends, which such filers do still report.
      if (capexLagYears >= 2) {
        plan = buildDividendModel(
          `${entity.name} last reported capital expenditure for ${latestFy.periodEnd.slice(0, 4)} but has cash flow through ${latestOcfYear}, so recent free cash flow cannot be built.`
        );
        if (!plan) {
          return res.status(422).json({
            error: `${entity.name} last reported capital expenditure for ${latestFy.periodEnd.slice(0, 4)}, but has cash flow through ${latestOcfYear}.`,
            detail:
              'Free cash flow cannot be built for recent periods, so any valuation would mix stale investment spend with a current balance sheet. This filer reports no dividend history either, so the model that would normally cover it is unavailable.',
            ticker: ticker.toUpperCase(),
            company: entity.name,
            history,
          });
        }
      } else {
        sources.operatingCashFlow = ocfAnnual[ocfAnnual.length - 1].tag;
        sources.capex = latestFy.capexTag;

        if (!STANDARD_CAPEX.has(latestFy.capexTag)) {
          warnings.push(
            `Capex read from the narrower tag "${latestFy.capexTag}" — this filer does not report a standard capital expenditure line, so free cash flow may be overstated.`
          );
        }

        // Anchor both trailing calculations to the same fiscal period, or a filer whose
        // two series end in different years would produce a spliced, meaningless TTM.
        const ocfAnchor = ocfAnnual.find((e) => e.end === latestFy.periodEnd);
        const capexAnchor = capexAnnual.find((e) => e.end === latestFy.periodEnd);
        const ocfTtm = trailingTwelveMonths(ocfRef.entries, ocfAnchor);
        const capexTtm = trailingTwelveMonths(capexRef.entries, capexAnchor);
        const ttm =
          ocfTtm && capexTtm && ocfTtm.through === capexTtm.through
            ? { freeCashFlow: ocfTtm.val - Math.abs(capexTtm.val), through: ocfTtm.through }
            : null;

        const avg3 = history.slice(-3).reduce((s, h) => s + h.freeCashFlow, 0) / Math.min(3, history.length);

        let base;
        let basisUsed = basis;
        let through;
        if (basis === 'ttm' && ttm) { base = ttm.freeCashFlow; through = ttm.through; }
        else if (basis === 'avg3') { base = avg3; through = latestFy.periodEnd; }
        else {
          base = latestFy.freeCashFlow;
          basisUsed = 'lastFy';
          through = latestFy.periodEnd;
          if (basis === 'ttm') warnings.push('Interim filings were insufficient to build a trailing-twelve-month figure; fell back to the last full fiscal year.');
        }

        plan = {
          model: 'free-cash-flow',
          history,
          base,
          basisUsed,
          through,
          latestPeriodEnd: latestFy.periodEnd,
          alternativeBases: { ttm: ttm?.freeCashFlow ?? null, lastFy: latestFy.freeCashFlow, avg3 },
        };
      }
    }

    if (plan.history.length < 3) {
      warnings.push(`Only ${plan.history.length} year(s) of filing history available — growth assumptions have little to anchor to.`);
    }

    const monthsStale = (Date.now() - Date.parse(plan.latestPeriodEnd)) / (30 * DAY);
    if (plan.basisUsed === 'lastFy' && monthsStale > 9) {
      warnings.push(`Last fiscal year ended ${plan.latestPeriodEnd}, roughly ${Math.round(monthsStale)} months ago.`);
    }

    if (plan.model === 'dividend-discount') {
      warnings.push(
        `${plan.because} Valued instead on its dividend stream, which counts only cash actually paid out — a filer returning capital through buybacks will look cheaper on this basis than it is.`
      );
    }

    const cashRef = resolve(facts, TAGS.cash, 'USD');
    const stiRef = resolve(facts, TAGS.shortTermInvestments, 'USD');
    const ltdRef = resolve(facts, TAGS.longTermDebt, 'USD');
    const stdRef = resolve(facts, TAGS.shortTermDebt, 'USD');

    const pick = (ref) => (ref ? latestInstant(ref.entries) : null);
    const cash = pick(cashRef);
    const sti = pick(stiRef);
    const ltd = pick(ltdRef);
    const std = pick(stdRef);

    sources.cash = cash?.tag ?? null;
    sources.shortTermInvestments = sti?.tag ?? null;
    sources.longTermDebt = ltd?.tag ?? null;
    sources.shortTermDebt = std?.tag ?? null;

    const totalCash = (cash?.val ?? 0) + (sti?.val ?? 0);
    const totalDebt = (ltd?.val ?? 0) + (std?.val ?? 0);
    const netDebt = totalDebt - totalCash;
    if (!ltd && !std) warnings.push('No debt tags found in EDGAR; net debt treated as cash only.');

    // Diluted weighted-average shares is the denominator that matches EPS: it covers
    // every share class and existing dilution. The cover-page count is reported
    // alongside it because buybacks make it drift below the weighted average.
    const dilRef = resolve(facts, TAGS.dilutedShares, 'shares');
    const coverRef = resolve(facts, TAGS.coverShares, 'shares');
    const diluted = dilRef ? annualSeries(dilRef.entries).slice(-1)[0] ?? latestInstant(dilRef.entries) : null;
    const cover = coverRef ? latestInstant(coverRef.entries) : null;
    const shares = diluted?.val ?? cover?.val;
    if (!shares && plan.model === 'free-cash-flow') {
      return res.status(422).json({ error: 'No share count reported in EDGAR for this filer.' });
    }
    sources.shares = diluted?.tag ?? cover?.tag ?? null;

    // The cash flow model values the whole business, so it needs the net debt bridge
    // and a share count. Dividends per share are already per-share and already net of
    // everything the company owes, so that model takes neither.
    if (plan.model === 'free-cash-flow') {
      plan.netDebt = netDebt;
      plan.shares = shares;
    }

    if (plan.base <= 0) {
      // A cash flow model can fall back to dividends here, but a dividend model has
      // nowhere left to go.
      if (plan.model === 'free-cash-flow') {
        const fallback = buildDividendModel(
          `${entity.name} has negative free cash flow on the selected basis, so a cash flow valuation cannot produce a meaningful figure.`
        );
        if (fallback) {
          fallback.netDebt = 0;
          fallback.shares = 1;
          warnings.push(
            `${fallback.because} Valued instead on its dividend stream, which counts only cash actually paid out.`
          );
          plan = fallback;
        }
      }
      if (plan.base <= 0) {
        return res.status(422).json({
          error:
            plan.model === 'free-cash-flow'
              ? `${entity.name} has negative free cash flow on the selected basis, and reports no dividends to value instead.`
              : `${entity.name} pays no dividend, so there is no stream to discount.`,
          baseValue: plan.base,
          ticker: ticker.toUpperCase(),
          company: entity.name,
          history: plan.history,
        });
      }
    }

    const quote = await spotPrice(ticker);
    const { base: baseValue, netDebt: modelNetDebt, shares: modelShares } = plan;

    const base = valueFrom(
      baseValue,
      growthPath(initialGrowth, terminalGrowth, years),
      wacc,
      terminalGrowth,
      modelNetDebt,
      modelShares
    );

    // Sensitivity: the point estimate is far less informative than the spread.
    const waccAxis = [-2, -1, 0, 1, 2].map((d) => +(wacc + d / 100).toFixed(4)).filter((w) => w > terminalGrowth);
    const tgAxis = [-1, -0.5, 0, 0.5, 1].map((d) => +(terminalGrowth + d / 100).toFixed(4));
    const grid = waccAxis.map((w) =>
      tgAxis.map((g) =>
        w <= g
          ? null
          : +valueFrom(baseValue, growthPath(initialGrowth, g, years), w, g, modelNetDebt, modelShares).perShare.toFixed(2)
      )
    );

    const price = quote?.price ?? null;
    const upside = price ? base.perShare / price - 1 : null;
    let verdict = null;
    if (upside !== null) {
      if (upside > 0.2) verdict = 'undervalued';
      else if (upside < -0.2) verdict = 'overvalued';
      else verdict = 'fairly valued';
    }

    if (base.terminalShare > 0.8) {
      warnings.push(
        `${Math.round(base.terminalShare * 100)}% of the valuation sits in the terminal value — the result is driven by assumptions beyond year ${years}, not by the forecast.`
      );
    }

    const implied =
      price !== null ? impliedGrowth(price, baseValue, terminalGrowth, years, wacc, modelNetDebt, modelShares) : null;

    const isDividendModel = plan.model === 'dividend-discount';
    const streamName = isDividendModel ? 'dividends per share' : 'free cash flow';

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      company: entity.name,
      cik: entity.cik,
      quote,
      model: {
        kind: plan.model,
        label: isDividendModel ? 'Dividend discount' : 'Discounted free cash flow',
        stream: streamName,
        // Present when the cash flow model could not be built, explaining what
        // forced the switch rather than leaving the reader to infer it.
        because: plan.because ?? null,
      },
      assumptions: {
        wacc,
        terminalGrowth,
        initialGrowth,
        years,
        basis: plan.basisUsed,
        baseValue: plan.base,
        // Kept under its original name so existing consumers keep working; for the
        // dividend model it carries a per-share dividend, not a cash flow.
        baseFreeCashFlow: plan.base,
        baseFreeCashFlowThrough: plan.through,
      },
      inputs: {
        shares: shares ?? null,
        dilutedShares: diluted?.val ?? null,
        coverPageShares: cover?.val ?? null,
        cash: cash?.val ?? 0,
        shortTermInvestments: sti?.val ?? 0,
        totalDebt,
        netDebt,
        // The dividend model discounts a per-share stream, so neither figure above
        // enters the valuation; both are reported for context only.
        usedInValuation: !isDividendModel,
        asOf: cash?.end ?? null,
      },
      history: plan.history,
      alternativeBases: plan.alternativeBases,
      valuation: {
        perShare: +base.perShare.toFixed(2),
        enterpriseValue: base.enterpriseValue,
        equityValue: base.equityValue,
        pvExplicit: base.pvExplicit,
        pvTerminal: base.pvTerminal,
        terminalShare: +base.terminalShare.toFixed(4),
        projection: base.rows.map((r) => ({
          year: r.year,
          growth: +r.growth.toFixed(4),
          value: isDividendModel ? +r.fcf.toFixed(4) : Math.round(r.fcf),
          freeCashFlow: isDividendModel ? null : Math.round(r.fcf),
          presentValue: isDividendModel ? +r.pv.toFixed(4) : Math.round(r.pv),
        })),
      },
      verdict: { rating: verdict, upside: upside === null ? null : +upside.toFixed(4) },
      reverseDcf: {
        impliedInitialGrowth: implied === null ? null : +implied.toFixed(4),
        note:
          implied === null
            ? 'Current price is outside the range solvable with these assumptions.'
            : `At a ${(wacc * 100).toFixed(1)}% discount rate, today's price implies ${streamName} growing ${(implied * 100).toFixed(1)}% initially, fading to ${(terminalGrowth * 100).toFixed(1)}% over ${years} years.`,
      },
      sensitivity: { waccAxis, terminalGrowthAxis: tgAxis, grid },
      sources,
      warnings,
      disclaimer: 'Model output from public filings. Not investment advice.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'DCF failed', detail: err.message });
  }
}
