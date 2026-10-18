import { Router } from 'express';
import { db } from './db.js';
import { fxRate } from './quotes.js';

const r = Router();
const TYPES = ['cash', 'bank', 'savings', 'deposit', 'other'];
const round2 = (n) => Math.round(n * 100) / 100;

function parseAccount(body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'Name is required' };
  const balance = Number(body.balance ?? 0);
  if (!Number.isFinite(balance)) return { error: 'Balance must be a number' };
  const type = TYPES.includes(body.type) ? body.type : 'other';
  const currency = String(body.currency || 'PLN').toUpperCase().slice(0, 3);
  return { value: { name, balance: round2(balance), type, currency } };
}

function recordHistory(accountId, balance) {
  // one entry per account per day; the latest edit of the day wins
  const existing = db.prepare("SELECT id FROM piggy_history WHERE account_id = ? AND date = date('now')").get(accountId);
  if (existing) db.prepare('UPDATE piggy_history SET balance = ? WHERE id = ?').run(balance, existing.id);
  else db.prepare('INSERT INTO piggy_history (account_id, balance) VALUES (?, ?)').run(accountId, balance);
}

export async function computePiggy(user) {
  const base = user.base_currency || 'PLN';
  const accounts = db.prepare('SELECT * FROM piggy_accounts WHERE user_id = ? ORDER BY type, name').all(user.id);
  const rates = {};
  for (const ccy of new Set(accounts.map((a) => a.currency))) {
    try { rates[ccy] = await fxRate(ccy, base); } catch { rates[ccy] = null; }
  }
  const rows = accounts.map((a) => ({
    ...a,
    fx: rates[a.currency],
    balanceBase: rates[a.currency] != null ? round2(a.balance * rates[a.currency]) : null,
  }));
  const byType = TYPES.map((t) => ({
    type: t,
    total: round2(rows.filter((a) => a.type === t).reduce((s, a) => s + (a.balanceBase ?? 0), 0)),
  })).filter((t) => t.total !== 0);
  const total = round2(rows.reduce((s, a) => s + (a.balanceBase ?? 0), 0));

  // total over time: on each date, sum each account's latest known balance (converted at today's rate)
  const hist = db.prepare(`SELECT h.* FROM piggy_history h JOIN piggy_accounts a ON a.id = h.account_id
                           WHERE a.user_id = ? ORDER BY h.date, h.id`).all(user.id);
  const ccyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const latest = new Map();
  const history = [];
  for (const date of [...new Set(hist.map((h) => h.date))]) {
    for (const h of hist.filter((x) => x.date === date)) latest.set(h.account_id, h.balance);
    let sum = 0;
    for (const [id, bal] of latest) {
      if (!ccyOf.has(id)) continue; // deleted account
      sum += bal * (rates[ccyOf.get(id)] ?? 0);
    }
    history.push({ date, total: round2(sum) });
  }

  return { base, accounts: rows, byType, total, history };
}

r.get('/piggy', async (req, res) => {
  res.json(await computePiggy(req.user));
});

r.post('/piggy', (req, res) => {
  const p = parseAccount(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  const info = db.prepare('INSERT INTO piggy_accounts (user_id, name, type, currency, balance) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, v.name, v.type, v.currency, v.balance);
  recordHistory(info.lastInsertRowid, v.balance);
  res.json(db.prepare('SELECT * FROM piggy_accounts WHERE id = ?').get(info.lastInsertRowid));
});

r.put('/piggy/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM piggy_accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const p = parseAccount({ ...cur, ...req.body });
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  db.prepare("UPDATE piggy_accounts SET name=?, type=?, currency=?, balance=?, updated_at=datetime('now') WHERE id=?")
    .run(v.name, v.type, v.currency, v.balance, cur.id);
  if (v.balance !== cur.balance) recordHistory(cur.id, v.balance);
  res.json(db.prepare('SELECT * FROM piggy_accounts WHERE id = ?').get(cur.id));
});

r.delete('/piggy/:id', (req, res) => {
  db.prepare('DELETE FROM piggy_accounts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default r;
