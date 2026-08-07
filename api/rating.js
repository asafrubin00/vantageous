export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  if (!process.env.FINNHUB_API_KEY) return res.status(200).json({ rating: null });

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${process.env.FINNHUB_API_KEY}`
    );
    if (!r.ok) return res.status(200).json({ rating: null });
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return res.status(200).json({ rating: null });

    const { strongBuy = 0, buy = 0, hold = 0, sell = 0, strongSell = 0 } = data[0];
    const total = strongBuy + buy + hold + sell + strongSell;
    if (total === 0) return res.status(200).json({ rating: null });

    const score = (strongBuy * 5 + buy * 4 + hold * 3 + sell * 2 + strongSell * 1) / total;
    let rating;
    if (score >= 4.5) rating = 'Strong Buy';
    else if (score >= 3.75) rating = 'Buy';
    else if (score >= 2.5) rating = 'Hold';
    else if (score >= 1.75) rating = 'Sell';
    else rating = 'Strong Sell';

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ rating, score: +score.toFixed(2) });
  } catch {
    return res.status(200).json({ rating: null });
  }
}
