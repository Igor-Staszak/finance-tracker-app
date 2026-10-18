// Salary calculator: per month, earnings minus the costs of earning them = net.
// Saving posts the net as one income transaction in a chosen tracker (kept in sync on every save),
// and optionally sets that tracker's budget ("money prepared") for the month.
import { Router } from 'express';
import { db } from './db.js';

const r = Router();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n) => Math.round(n * 100) / 100;
const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const isMember = (trackerId, userId) =>
  !!db.prepare('SELECT 1 FROM tracker_members WHERE tracker_id = ? AND user_id = ?').get(trackerId, userId);

function load(userId, month) {
  const s = db.prepare('SELECT * FROM salary_months WHERE user_id = ? AND month = ?').get(userId, month);
  if (!s) return null;
  const items = db.prepare('SELECT kind, name, amount FROM salary_items WHERE salary_id = ? ORDER BY position, id').all(s.id);
  return { ...s, items };
}

function summarize(month, s, extra = {}) {
  const items = s?.items ?? [];
  const earnings = round2(items.filter((i) => i.kind === 'earning').reduce((a, i) => a + i.amount, 0));
  const costs = round2(items.filter((i) => i.kind === 'cost').reduce((a, i) => a + i.amount, 0));
  // the linked income still exists? (it can be deleted by hand in History)
  const tx = s?.transaction_id ? db.prepare('SELECT id, tracker_id, amount FROM transactions WHERE id = ?').get(s.transaction_id) : null;
  return {
    month,
    saved: !!s,
    items,
    earnings,
    costs,
    net: round2(earnings - costs),
    tracker_id: s?.tracker_id ?? null,
    use_as_budget: !!s?.use_as_budget,
    posted: tx ? { transaction_id: tx.id, tracker_id: tx.tracker_id, amount: tx.amount } : null,
    ...extra,
  };
}

function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length > 60) return { error: 'Invalid list of items' };
  const items = [];
  for (const it of raw) {
    const name = String(it?.name ?? '').trim().slice(0, 60);
    const amount = Number(it?.amount);
    if (!['earning', 'cost'].includes(it?.kind)) return { error: 'Invalid item type' };
    if (!name && !amount) continue; // empty row
    if (!name) return { error: 'Every item needs a name' };
    if (!Number.isFinite(amount) || amount < 0) return { error: 'Amounts must be 0 or more' };
    items.push({ kind: it.kind, name, amount: round2(amount) });
  }
  return { items };
}

// one month (falls back to a copy of the previous month's items as a suggestion)
r.get('/salary/:month', (req, res) => {
  const { month } = req.params;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'Month must be YYYY-MM' });
  const s = load(req.user.id, month);
  if (s) return res.json(summarize(month, s));
  // suggestion: the most recent earlier month with a salary
  const prev = db.prepare('SELECT month FROM salary_months WHERE user_id = ? AND month < ? ORDER BY month DESC LIMIT 1').get(req.user.id, month);
  const template = prev ? load(req.user.id, prev.month) : null;
  res.json(summarize(month, null, template ? {
    suggestion: { from: prev.month, items: template.items, tracker_id: template.tracker_id, use_as_budget: !!template.use_as_budget },
  } : {}));
});

// last 12 months for the chart
r.get('/salary', (req, res) => {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const to = MONTH_RE.test(String(req.query.to)) ? String(req.query.to) : thisMonth;
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(to, i - 11));
  res.json(months.map((m) => {
    const s = summarize(m, load(req.user.id, m));
    return { month: m, earnings: s.earnings, costs: s.costs, net: s.net, saved: s.saved };
  }));
});

r.put('/salary/:month', (req, res) => {
  const { month } = req.params;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'Month must be YYYY-MM' });
  const p = parseItems(req.body?.items);
  if (p.error) return res.status(400).json({ error: p.error });
  const trackerId = req.body?.tracker_id ? Number(req.body.tracker_id) : null;
  if (trackerId && !isMember(trackerId, req.user.id)) return res.status(404).json({ error: 'Tracker not found' });
  const useAsBudget = !!req.body?.use_as_budget && !!trackerId;
  const note = String(req.body?.note || 'Salary (net)').slice(0, 100);

  const earnings = p.items.filter((i) => i.kind === 'earning').reduce((a, i) => a + i.amount, 0);
  const costs = p.items.filter((i) => i.kind === 'cost').reduce((a, i) => a + i.amount, 0);
  const net = round2(earnings - costs);

  db.exec('BEGIN');
  try {
    let s = db.prepare('SELECT * FROM salary_months WHERE user_id = ? AND month = ?').get(req.user.id, month);
    if (!s) {
      const id = db.prepare('INSERT INTO salary_months (user_id, month) VALUES (?, ?)').run(req.user.id, month).lastInsertRowid;
      s = db.prepare('SELECT * FROM salary_months WHERE id = ?').get(id);
    }
    db.prepare('DELETE FROM salary_items WHERE salary_id = ?').run(s.id);
    const ins = db.prepare('INSERT INTO salary_items (salary_id, kind, name, amount, position) VALUES (?, ?, ?, ?, ?)');
    p.items.forEach((it, i) => ins.run(s.id, it.kind, it.name, it.amount, i));

    // keep exactly one linked income transaction in the chosen tracker
    let txId = s.transaction_id;
    const existing = txId ? db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) : null;
    if (existing && (!trackerId || existing.tracker_id !== trackerId || net <= 0)) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.id);
      txId = null;
    } else if (!existing) {
      txId = null;
    }
    if (trackerId && net > 0) {
      const category = db.prepare(`SELECT id FROM categories WHERE tracker_id = ? AND archived = 0
                                   AND name IN ('Salary', 'Wynagrodzenie') LIMIT 1`).get(trackerId);
      if (txId) {
        db.prepare('UPDATE transactions SET amount = ?, note = ?, category_id = COALESCE(category_id, ?) WHERE id = ?')
          .run(net, note, category?.id ?? null, txId);
      } else {
        txId = Number(db.prepare(`INSERT INTO transactions (tracker_id, date, amount, kind, category_id, note, created_by)
                                  VALUES (?, ?, ?, 'income', ?, ?, ?)`)
          .run(trackerId, `${month}-01`, net, category?.id ?? null, note, req.user.id).lastInsertRowid);
      }
      if (useAsBudget) {
        db.prepare(`INSERT INTO budgets (tracker_id, month, amount) VALUES (?, ?, ?)
                    ON CONFLICT(tracker_id, month) DO UPDATE SET amount = excluded.amount`).run(trackerId, month, net);
      }
    }
    db.prepare('UPDATE salary_months SET tracker_id = ?, transaction_id = ?, use_as_budget = ? WHERE id = ?')
      .run(trackerId, txId, useAsBudget ? 1 : 0, s.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json(summarize(month, load(req.user.id, month)));
});

// remove the month's salary and the income it created (the budget is left as is)
r.delete('/salary/:month', (req, res) => {
  const s = db.prepare('SELECT * FROM salary_months WHERE user_id = ? AND month = ?').get(req.user.id, req.params.month);
  if (s) {
    if (s.transaction_id) db.prepare('DELETE FROM transactions WHERE id = ?').run(s.transaction_id);
    db.prepare('DELETE FROM salary_months WHERE id = ?').run(s.id);
  }
  res.json({ ok: true });
});

export default r;
