import { Router } from 'express';
import { db } from './db.js';
import { getQuote, fxRate, searchSymbols, toYahooSymbol } from './quotes.js';

const r = Router();
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const today = () => new Date().toISOString().slice(0, 10);

r.get('/symbols/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    // If it looks like an exchange-suffixed ticker, try the converted symbol first
    const results = await searchSymbols(q);
    const converted = toYahooSymbol(q);
    if (converted !== q.toUpperCase() && !results.some((x) => x.symbol === converted)) {
      try {
        const quote = await getQuote(converted);
        results.unshift({ symbol: converted, name: quote.name, exchange: 'converted ticker', type: '' });
      } catch { /* not a valid symbol */ }
    }
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

r.get('/quote/:symbol', async (req, res) => {
  try {
    res.json(await getQuote(req.params.symbol.toUpperCase()));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

r.get('/holdings', (req, res) => {
  res.json(db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY symbol').all(req.user.id));
});

function parseHolding(body) {
  const rawSymbol = String(body.symbol || '').trim();
  if (!rawSymbol) return { error: 'Symbol is required' };
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Quantity must be > 0' };
  const avg_price = Number(body.avg_price || 0);
  if (!Number.isFinite(avg_price) || avg_price < 0) return { error: 'Average price must be >= 0' };
  return {
    value: {
      symbol: toYahooSymbol(rawSymbol),
      ticker: String(body.ticker || (rawSymbol.toUpperCase() !== toYahooSymbol(rawSymbol) ? rawSymbol.toUpperCase() : '')),
      name: String(body.name || ''),
      quantity,
      avg_price,
    },
  };
}

r.post('/holdings', async (req, res) => {
  const p = parseHolding(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  let quote;
  try {
    quote = await getQuote(v.symbol);
  } catch {
    return res.status(400).json({ error: `Could not find a price for "${v.symbol}". Use the search to pick the right symbol.` });
  }
  const info = db.prepare(`INSERT INTO holdings (user_id, symbol, ticker, name, quantity, avg_price, currency)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, v.symbol, v.ticker, v.name || quote.name, v.quantity, v.avg_price, quote.currency);
  res.json(db.prepare('SELECT * FROM holdings WHERE id = ?').get(info.lastInsertRowid));
});

r.put('/holdings/:id', async (req, res) => {
  const p = parseHolding(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  const cur = db.prepare('SELECT * FROM holdings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  let currency = cur.currency;
  try { currency = (await getQuote(v.symbol)).currency; } catch { /* keep previous */ }
  db.prepare('UPDATE holdings SET symbol=?, ticker=?, name=?, quantity=?, avg_price=?, currency=? WHERE id=?')
    .run(v.symbol, v.ticker, v.name || cur.name, v.quantity, v.avg_price, currency, cur.id);
  res.json(db.prepare('SELECT * FROM holdings WHERE id = ?').get(req.params.id));
});

r.delete('/holdings/:id', (req, res) => {
  db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export async function computePortfolio(user, { force = false } = {}) {
  const base = user.base_currency || 'PLN';
  const holdings = db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY symbol').all(user.id);
  const errors = [];

  const rows = await Promise.all(holdings.map(async (h) => {
    let quote = null;
    let rate = null;
    try { quote = await getQuote(h.symbol, { force }); } catch (e) { errors.push(e.message); }
    const ccy = quote?.currency || h.currency || base;
    try { rate = await fxRate(ccy, base, { force }); } catch (e) { errors.push(e.message); }

    const price = quote?.price ?? null;
    const value = price != null ? price * h.quantity : null;
    const cost = h.avg_price * h.quantity;
    const valueBase = value != null && rate != null ? value * rate : null;
    const costBase = rate != null ? cost * rate : null;
    const dayChange = quote?.prev_close ? (price - quote.prev_close) * h.quantity : null;
    return {
      ...h,
      currency: ccy,
      price: round2(price),
      prev_close: quote?.prev_close ?? null,
      stale: quote?.stale ?? true,
      fetched_at: quote?.fetched_at ?? null,
      fx: rate,
      value: round2(value),
      cost: round2(cost),
      pl: value != null ? round2(value - cost) : null,
      plPct: value != null && cost > 0 ? round2(((value - cost) / cost) * 100) : null,
      valueBase: round2(valueBase),
      costBase: round2(costBase),
      plBase: valueBase != null && costBase != null ? round2(valueBase - costBase) : null,
      dayChangeBase: dayChange != null && rate != null ? round2(dayChange * rate) : null,
      dayChangePct: quote?.prev_close ? round2(((price - quote.prev_close) / quote.prev_close) * 100) : null,
    };
  }));

  const sum = (k) => rows.reduce((a, x) => a + (x[k] ?? 0), 0);
  const totalValue = sum('valueBase');
  const totalCost = sum('costBase');
  const totals = {
    value: round2(totalValue),
    cost: round2(totalCost),
    pl: round2(totalValue - totalCost),
    plPct: totalCost > 0 ? round2(((totalValue - totalCost) / totalCost) * 100) : null,
    dayChange: round2(sum('dayChangeBase')),
  };

  if (rows.length && rows.every((x) => x.valueBase != null)) {
    db.prepare(`INSERT INTO portfolio_snapshots (user_id, date, value, cost) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET value=excluded.value, cost=excluded.cost`)
      .run(user.id, today(), totals.value, totals.cost);
  }

  return { base, holdings: rows, totals, errors: [...new Set(errors)] };
}

r.get('/portfolio', async (req, res) => {
  const data = await computePortfolio(req.user, { force: req.query.refresh === '1' });
  const history = db.prepare('SELECT date, value, cost FROM portfolio_snapshots WHERE user_id = ? ORDER BY date').all(req.user.id);
  res.json({ ...data, history });
});

export default r;
