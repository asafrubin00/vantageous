// Business metrics and valuation multiples for any US filer.
//
// Deliberately independent of the DCF. A discounted cash flow legitimately refuses
// plenty of companies — Amazon has negative free cash flow and pays no dividend — and
// "no answer" is a poor result for one of the largest companies in the market. Every
// company has revenue, earnings and a balance sheet, so every company can at least be
// placed on a multiple. The same extraction answers the other question a valuation
// alone cannot: not whether something looks cheap, but why.

import { TAGS, tickerToCik, companyFacts, resolve, annualSeries, latestInstant, spotPrice } from './dcf.js';

const METRIC_TAGS = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerExcludingAssessedTaxMember',
    // IFRS
    'Revenue',
  ],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  epsDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'DilutedEarningsLossPerShare'],
  equity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'Equity',
  ],
  dAndA: [
    'DepreciationDepletionAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'DepreciationAndAmortization',
    'DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
  ],
};

// Duration facts (revenue, earnings) keyed by period end; instant facts (equity) by date.
function annualByEnd(facts, chain, unit = 'USD') {
  const ref = resolve(facts, chain, unit);
  if (!ref) return { map: new Map(), tag: null };
  const series = annualSeries(ref.entries);
  if (series.length) return { map: new Map(series.map((e) => [e.end, e.val])), tag: series.at(-1).tag };
  // Balance-sheet items are instants, which annualSeries filters out.
  const instants = ref.entries.filter((e) => !e.start && e.form && /^(10-K|20-F|40-F)/.test(e.form));
  if (!instants.length) return { map: new Map(), tag: null };
  const byEnd = new Map();
  for (const e of instants) {
    const prev = byEnd.get(e.end);
    if (!prev || e.filed > prev.filed) byEnd.set(e.end, e);
  }
  return { map: new Map([...byEnd].map(([k, v]) => [k, v.val])), tag: [...byEnd.values()].at(-1)?.tag ?? null };
}

const pct = (n) => (Number.isFinite(n) ? +n.toFixed(4) : null);
const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? +(a / b).toFixed(2) : null);

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  try {
    const match = await tickerToCik(ticker);
    if (!match) {
      return res.status(404).json({ error: `${ticker.toUpperCase()} is not a US SEC filer.` });
    }

    let facts;
    try {
      ({ facts } = await companyFacts(match.cik));
    } catch (err) {
      if (/No EDGAR filings found/.test(err.message)) {
        return res.status(422).json({
          error: `${match.name} publishes no machine-readable financial data to EDGAR.`,
          ticker: ticker.toUpperCase(),
          company: match.name,
        });
      }
      throw err;
    }

    const sources = {};
    const series = {};
    for (const [name, chain] of Object.entries(METRIC_TAGS)) {
      const unit = name === 'epsDiluted' ? 'USD/shares' : 'USD';
      const { map, tag } = annualByEnd(facts, chain, unit);
      series[name] = map;
      sources[name] = tag;
    }

    // Build a per-year row from whichever periods have revenue — the one line every
    // operating company reports, and the anchor everything else is matched against.
    const years = [...series.revenue.keys()].sort();
    if (!years.length) {
      return res.status(422).json({
        error: `No annual revenue reported in EDGAR for ${match.name}.`,
        detail:
          'Funds, trusts and shell companies often report no revenue line, which leaves nothing to build margins or multiples from.',
        ticker: ticker.toUpperCase(),
        company: match.name,
      });
    }

    const annual = years.map((end) => {
      const revenue = series.revenue.get(end);
      const operatingIncome = series.operatingIncome.get(end) ?? null;
      const netIncome = series.netIncome.get(end) ?? null;
      const grossProfit = series.grossProfit.get(end) ?? null;
      const dAndA = series.dAndA.get(end) ?? null;
      return {
        periodEnd: end,
        revenue,
        grossProfit,
        operatingIncome,
        netIncome,
        dAndA,
        equity: series.equity.get(end) ?? null,
        epsDiluted: series.epsDiluted.get(end) ?? null,
        ebitda: Number.isFinite(operatingIncome) && Number.isFinite(dAndA) ? operatingIncome + dAndA : null,
        grossMargin: pct(Number.isFinite(grossProfit) ? grossProfit / revenue : NaN),
        operatingMargin: pct(Number.isFinite(operatingIncome) ? operatingIncome / revenue : NaN),
        netMargin: pct(Number.isFinite(netIncome) ? netIncome / revenue : NaN),
      };
    });

    const latest = annual.at(-1);
    const prior = annual.at(-2) ?? null;

    // Balance sheet and share count reuse the valuation's chains so the two views
    // cannot disagree about the same company.
    const pick = (chain, unit = 'USD') => {
      const ref = resolve(facts, chain, unit);
      return ref ? latestInstant(ref.entries) : null;
    };
    const cash = pick(TAGS.cash);
    const sti = pick(TAGS.shortTermInvestments);
    const ltd = pick(TAGS.longTermDebt);
    const std = pick(TAGS.shortTermDebt);
    const netDebt = (ltd?.val ?? 0) + (std?.val ?? 0) - ((cash?.val ?? 0) + (sti?.val ?? 0));

    const dilRef = resolve(facts, TAGS.dilutedShares, 'shares');
    const coverRef = resolve(facts, TAGS.coverShares, 'shares');
    const diluted = dilRef ? annualSeries(dilRef.entries).at(-1)?.val ?? null : null;
    const cover = coverRef ? latestInstant(coverRef.entries)?.val ?? null : null;
    let shares = diluted ?? cover;
    if (diluted && cover && (diluted / cover > 2 || diluted / cover < 0.5)) shares = cover;

    const quote = await spotPrice(ticker);
    const price = quote?.price ?? null;
    const marketCap = price && shares ? price * shares : null;
    const enterpriseValue = marketCap !== null ? marketCap + netDebt : null;

    const cagr = (from, to, years_) =>
      Number.isFinite(from) && Number.isFinite(to) && from > 0 && years_ > 0
        ? pct((to / from) ** (1 / years_) - 1)
        : null;

    const threeBack = annual.length >= 4 ? annual.at(-4) : null;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      company: match.name,
      cik: match.cik,
      quote,
      shares,
      marketCap,
      enterpriseValue,
      netDebt,
      // Multiples every company can be placed on, including those a DCF refuses.
      multiples: {
        priceEarnings: latest.epsDiluted && latest.epsDiluted > 0 ? ratio(price, latest.epsDiluted) : null,
        priceSales: ratio(marketCap, latest.revenue),
        priceBook: latest.equity ? ratio(marketCap, latest.equity) : null,
        evSales: ratio(enterpriseValue, latest.revenue),
        evEbitda: latest.ebitda && latest.ebitda > 0 ? ratio(enterpriseValue, latest.ebitda) : null,
      },
      // The "why does it look cheap" half.
      trends: {
        revenueGrowthYoY: prior ? pct(latest.revenue / prior.revenue - 1) : null,
        revenueCagr3y: threeBack ? cagr(threeBack.revenue, latest.revenue, 3) : null,
        grossMargin: latest.grossMargin,
        operatingMargin: latest.operatingMargin,
        netMargin: latest.netMargin,
        operatingMarginChange3y:
          threeBack && Number.isFinite(threeBack.operatingMargin) && Number.isFinite(latest.operatingMargin)
            ? pct(latest.operatingMargin - threeBack.operatingMargin)
            : null,
        returnOnEquity: latest.equity && latest.netIncome ? pct(latest.netIncome / latest.equity) : null,
        netDebtToEbitda: latest.ebitda && latest.ebitda > 0 ? +(netDebt / latest.ebitda).toFixed(2) : null,
      },
      annual: annual.slice(-8),
      sources,
      disclaimer: 'Figures from public filings. Not investment advice.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not build fundamentals', detail: err.message });
  }
}
