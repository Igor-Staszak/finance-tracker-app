// Creates (or re-creates) a demo account with ~6 months of realistic sample data.
// Run from the server folder:  node scripts/seed-demo.js        (uses DB_PATH like the app)
// Optional: DEMO_PASSWORD=... to choose the password; otherwise a random one is printed.
// Re-running deletes the previous demo users ("demo", "demo-ania") and everything they own.
import crypto from 'node:crypto';
import { db, createTracker } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { getQuote, fxRate } from '../src/quotes.js';

const MONTHS = 6;
const LANG = 'pl';
const password = process.env.DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');

// deterministic randomness, so every run produces the same data
let seed = 20261019;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (min, max) => Math.round((min + rnd() * (max - min)) * 100) / 100;
const pick = (list) => list[Math.floor(rnd() * list.length)];
const pad = (n) => String(n).padStart(2, '0');

const now = new Date();
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const months = Array.from({ length: MONTHS }, (_, i) => {
  const d = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const isCurrent = i === MONTHS - 1;
  // last day that already happened, so random entries in the current month aren't dropped
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, days, last: isCurrent ? now.getDate() : days };
});
// only days that already happened
const date = (month, day) => {
  const s = `${month.key}-${pad(Math.min(day, month.days))}`;
  return s <= todayStr ? s : null;
};

// investments: [yahoo symbol, ticker as typed, name, quantity, fallback avg price, currency, bought at x% of today's price]
const HOLDINGS = [
  ['PKN.WA', 'PKN.PL', 'Orlen', 40, 58.4, 'PLN', 0.86],
  ['CDR.WA', 'CDR.PL', 'CD Projekt', 12, 205, 'PLN', 0.93],
  ['AAPL', 'AAPL.US', 'Apple', 6, 192.5, 'USD', 0.82],
  ['VWCE.DE', 'VWCE.DE', 'Vanguard FTSE All-World', 30, 117.8, 'EUR', 0.88],
  ['CNDX.L', 'CNDX.UK', 'iShares NASDAQ 100', 3, 1010, 'USD', 0.9],
];
// live prices (network) give believable gains; without them the fallback prices are used and the history chart is skipped
const live = new Map();
for (const [symbol, , , , , ccy] of HOLDINGS) {
  try {
    const q = await getQuote(symbol);
    live.set(symbol, { price: q.price, toPln: await fxRate(q.currency, 'PLN'), costToPln: await fxRate(ccy, 'PLN') });
  } catch (e) {
    console.warn(`No live price for ${symbol}: ${e.message}`);
  }
}

// hash first: nothing async may run while the transaction below holds the write lock
const demoHash = await hashPassword(password);
const aniaHash = await hashPassword(crypto.randomBytes(18).toString('base64url')); // nobody logs in as Ania

// ---------- reset ----------
let open = true;
db.exec('BEGIN');
try {
  db.prepare("DELETE FROM users WHERE username IN ('demo', 'demo-ania')").run();

  const addUser = (username, name, hash) => Number(db.prepare(
    'INSERT INTO users (username, name, password_hash, base_currency) VALUES (?, ?, ?, ?)',
  ).run(username, name, hash, 'PLN').lastInsertRowid);
  const demo = addUser('demo', 'Kasia (demo)', demoHash);
  const ania = addUser('demo-ania', 'Ania', aniaHash);

  const personal = createTracker(demo, 'Osobisty', 'PLN', LANG);
  createTracker(ania, 'Osobisty', 'PLN', LANG);
  const home = createTracker(demo, 'Dom', 'PLN', LANG);
  db.prepare("INSERT INTO tracker_members (tracker_id, user_id, role) VALUES (?, ?, 'member')").run(home, ania);

  const cat = (tracker, name) => db.prepare('SELECT id FROM categories WHERE tracker_id = ? AND name = ?').get(tracker, name).id;
  const C = (tracker) => ({
    food: cat(tracker, 'Zakupy spożywcze'), eat: cat(tracker, 'Restauracje'), transport: cat(tracker, 'Transport'),
    home: cat(tracker, 'Mieszkanie i rachunki'), health: cat(tracker, 'Zdrowie'), fun: cat(tracker, 'Rozrywka'),
    shop: cat(tracker, 'Zakupy'), other: cat(tracker, 'Inne'), salary: cat(tracker, 'Wynagrodzenie'),
  });
  const P = C(personal);
  const H = C(home);
  db.prepare('UPDATE categories SET monthly_limit = ? WHERE id = ?').run(900, P.eat);
  db.prepare('UPDATE categories SET monthly_limit = ? WHERE id = ?').run(600, P.shop);
  db.prepare('UPDATE categories SET monthly_limit = ? WHERE id = ?').run(1800, H.food);

  const insTx = db.prepare(`INSERT INTO transactions (tracker_id, date, amount, kind, category_id, note, created_by)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const tx = (tracker, d, amount, category, note, by = demo, kind = 'expense') => {
    if (!d) return null;
    return Number(insTx.run(tracker, d, amount, kind, category, note, by).lastInsertRowid);
  };
  const setBudget = db.prepare('INSERT INTO budgets (tracker_id, month, amount) VALUES (?, ?, ?)');

  for (const m of months) {
    // ---------- personal tracker ----------
    setBudget.run(personal, m.key, pick([4500, 4800, 5000]));
    tx(personal, date(m, 3), 89.99, P.home, 'Telefon + internet');
    tx(personal, date(m, 5), 43, P.fun, 'Netflix');
    tx(personal, date(m, 7), 23.99, P.fun, 'Spotify');
    tx(personal, date(m, 2), 110, P.transport, 'Bilet miesięczny');
    for (let d = 1; d <= m.days; d += 2 + Math.floor(rnd() * 2)) {
      tx(personal, date(m, d), between(18, 140), P.food, pick(['Biedronka', 'Lidl', 'Żabka', 'Piekarnia', 'Warzywniak']));
    }
    for (let i = 0; i < 5; i++) {
      tx(personal, date(m, 1 + Math.floor(rnd() * m.last)), between(25, 160), P.eat,
        pick(['Kawa z koleżanką', 'Lunch w pracy', 'Sushi', 'Pizza', 'Kebab', 'Obiad na mieście']));
    }
    for (let i = 0; i < 2; i++) tx(personal, date(m, 4 + i * 13), between(180, 260), P.transport, 'Orlen – paliwo');
    for (let i = 0; i < 3; i++) {
      tx(personal, date(m, 1 + Math.floor(rnd() * m.last)), between(60, 380), P.shop,
        pick(['Zalando', 'Rossmann', 'Empik – książki', 'Decathlon', 'Allegro']));
    }
    tx(personal, date(m, 12), between(30, 140), P.health, pick(['Apteka', 'Witaminy', 'Wizyta u dentysty']));
    tx(personal, date(m, 18), between(40, 120), P.fun, pick(['Kino', 'Koncert', 'Basen', 'Escape room']));
    if (rnd() > 0.5) tx(personal, date(m, 22), between(20, 90), P.other, pick(['Prezent', 'Fryzjer', 'Kwiaty']));
    if (rnd() > 0.6) tx(personal, date(m, 14), between(50, 300), null, 'Zwrot za bilety', demo, 'income');

    // ---------- shared "Dom" tracker (two people) ----------
    setBudget.run(home, m.key, 4200);
    tx(home, date(m, 1), 2300, H.home, 'Czynsz', ania);
    tx(home, date(m, 10), between(140, 220), H.home, 'Prąd');
    tx(home, date(m, 12), between(60, 110), H.home, 'Gaz', ania);
    for (let w = 0; w < 5; w++) {
      tx(home, date(m, 2 + w * 7), between(150, 420), H.food, pick(['Duże zakupy – Auchan', 'Kaufland', 'Lidl', 'Carrefour']), w % 2 ? ania : demo);
    }
    tx(home, date(m, 16), between(80, 450), H.shop, pick(['IKEA', 'Leroy Merlin', 'Środki czystości']), rnd() > 0.5 ? ania : demo);
    if (rnd() > 0.4) tx(home, date(m, 20), between(120, 260), H.eat, 'Kolacja we dwoje', rnd() > 0.5 ? ania : demo);

    // ---------- salary (posted as one income in the personal tracker) ----------
    if (!date(m, 1)) continue;
    const items = [
      ['earning', 'Wynagrodzenie podstawowe', 9200],
      ...(rnd() > 0.5 ? [['earning', 'Premia', pick([800, 1200, 1500])]] : []),
      ...(rnd() > 0.6 ? [['earning', 'Nadgodziny', between(300, 700)]] : []),
      ['cost', 'Dojazd', 110],
      ['cost', 'Parking', 150],
    ];
    const net = Math.round(items.reduce((a, [k, , v]) => a + (k === 'earning' ? v : -v), 0) * 100) / 100;
    const txId = tx(personal, `${m.key}-01`, net, P.salary, 'Wypłata (netto)', demo, 'income');
    const sid = Number(db.prepare('INSERT INTO salary_months (user_id, month, tracker_id, transaction_id, use_as_budget) VALUES (?, ?, ?, ?, 0)')
      .run(demo, m.key, personal, txId).lastInsertRowid);
    items.forEach(([kind, name, amount], i) =>
      db.prepare('INSERT INTO salary_items (salary_id, kind, name, amount, position) VALUES (?, ?, ?, ?, ?)').run(sid, kind, name, amount, i));
  }

  // ---------- piggybank: balances drift up over the months ----------
  const pots = [
    ['Gotówka', 'cash', 'PLN', 600, 900],
    ['Konto osobiste', 'bank', 'PLN', 3200, 4100],
    ['Konto oszczędnościowe', 'savings', 'PLN', 14000, 19500],
    ['Lokata 6M', 'deposit', 'PLN', 10000, 10260],
    ['Konto walutowe', 'other', 'EUR', 800, 1150],
  ];
  for (const [name, type, currency, from, to] of pots) {
    const points = months.map((m, i) => ({ d: date(m, 1) ?? todayStr, v: Math.round((from + ((to - from) * i) / (MONTHS - 1) + between(-150, 150)) * 100) / 100 }));
    points[points.length - 1] = { d: todayStr, v: to };
    const id = Number(db.prepare('INSERT INTO piggy_accounts (user_id, name, type, currency, balance) VALUES (?, ?, ?, ?, ?)')
      .run(demo, name, type, currency, to).lastInsertRowid);
    for (const p of points) db.prepare('INSERT INTO piggy_history (account_id, balance, date) VALUES (?, ?, ?)').run(id, p.v, p.d);
  }

  // ---------- investments ----------
  const insH = db.prepare('INSERT INTO holdings (user_id, symbol, ticker, name, quantity, avg_price, currency) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [symbol, ticker, name, qty, fallback, ccy, factor] of HOLDINGS) {
    const q = live.get(symbol);
    insH.run(demo, symbol, ticker, name, qty, q ? Math.round(q.price * factor * 100) / 100 : fallback, ccy);
  }
  db.exec('COMMIT');
  open = false;

  // history chart: weekly values ending at today's real value
  if (live.size === HOLDINGS.length) {
    let value = 0;
    let cost = 0;
    for (const [symbol, , , qty, , , factor] of HOLDINGS) {
      const q = live.get(symbol);
      value += q.price * qty * q.toPln;
      cost += Math.round(q.price * factor * 100) / 100 * qty * q.costToPln;
    }
    const start = new Date(`${months[0].key}-01T12:00:00`);
    const weeks = Math.floor((now - start) / (7 * 864e5));
    const ins = db.prepare('INSERT OR REPLACE INTO portfolio_snapshots (user_id, date, value, cost) VALUES (?, ?, ?, ?)');
    for (let w = 0; w <= weeks; w++) {
      const d = new Date(start.getTime() + w * 7 * 864e5);
      const progress = weeks ? w / weeks : 1;
      const v = cost + (value - cost) * progress + (w < weeks ? between(-0.03, 0.03) * cost : 0);
      ins.run(demo, d.toISOString().slice(0, 10), Math.round(v * 100) / 100, Math.round(cost * 100) / 100);
    }
  } else {
    console.warn('Portfolio history skipped (no price data).');
  }
} catch (e) {
  if (open) db.exec('ROLLBACK');
  throw e;
}

const count = db.prepare(`SELECT COUNT(*) AS n FROM transactions t JOIN tracker_members m ON m.tracker_id = t.tracker_id
                          WHERE m.user_id = (SELECT id FROM users WHERE username = 'demo')`).get().n;
console.log(`Demo account ready: ${count} transactions over ${MONTHS} months (${months[0].key} – ${months.at(-1).key}).`);
console.log(`  username: demo`);
console.log(`  password: ${password}`);
