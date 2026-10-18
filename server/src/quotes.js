// Market data from Yahoo Finance's public chart/search endpoints (no API key needed).
import { db } from './db.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) finance-tracker' };
const TTL_MS = 15 * 60 * 1000;

// Exchange suffix (country code) -> Yahoo suffix
const MARKET_SUFFIX = {
  PL: '.WA', US: '', UK: '.L', DE: '.DE', FR: '.PA', NL: '.AS', ES: '.MC', IT: '.MI',
  CH: '.SW', BE: '.BR', PT: '.LS', SE: '.ST', DK: '.CO', NO: '.OL', FI: '.HE', CZ: '.PR',
};

/** "PKN.PL" -> "PKN.WA", "AAPL.US" -> "AAPL", "CNDX.UK" -> "CNDX.L". Unknown formats pass through. */
export function toYahooSymbol(ticker) {
  const s = ticker.trim().toUpperCase();
  const m = s.match(/^(.+)\.([A-Z]{2})$/);
  if (!m || !(m[2] in MARKET_SUFFIX)) return s;
  return m[1] + MARKET_SUFFIX[m[2]];
}

async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Quote ${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error(`Quote ${symbol}: no data`);
  let price = meta.regularMarketPrice;
  let prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  let currency = meta.currency || 'USD';
  // London listings are often quoted in pence
  if (currency === 'GBp' || currency === 'GBX') {
    price /= 100;
    if (prev != null) prev /= 100;
    currency = 'GBP';
  }
  return { symbol, price, prev_close: prev, currency, name: meta.longName || meta.shortName || '' };
}

/** Cached quote; falls back to a stale cache entry if the fetch fails. */
export async function getQuote(symbol, { force = false } = {}) {
  const cached = db.prepare('SELECT * FROM price_cache WHERE symbol = ?').get(symbol);
  if (cached && !force && Date.now() - cached.fetched_at < TTL_MS) return { ...cached, stale: false };
  try {
    const q = await fetchQuote(symbol);
    db.prepare(`INSERT INTO price_cache (symbol, price, prev_close, currency, name, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, prev_close=excluded.prev_close,
                  currency=excluded.currency, name=excluded.name, fetched_at=excluded.fetched_at`)
      .run(q.symbol, q.price, q.prev_close, q.currency, q.name, Date.now());
    return { ...q, fetched_at: Date.now(), stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true, error: err.message };
    throw err;
  }
}

/** Rate to convert 1 unit of `from` into `to`. */
export async function fxRate(from, to, opts) {
  if (!from || from === to) return 1;
  const q = await getQuote(`${from}${to}=X`, opts);
  return q.price;
}

export async function searchSymbols(query) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Search: HTTP ${res.status}`);
  const json = await res.json();
  return (json.quotes || [])
    .filter((q) => q.symbol && q.quoteType !== 'OPTION')
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange || '',
      type: q.typeDisp || q.quoteType || '',
    }));
}
