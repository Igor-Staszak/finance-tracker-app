import { Router } from 'express';
import { db } from './db.js';

// Mounted at /api/trackers/:tid after loadTracker, so req.tracker is set and membership is checked.
const r = Router({ mergeParams: true });
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return DATE_RE.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

const round2 = (n) => Math.round(n * 100) / 100;
const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function badRequest(res, msg) {
  res.status(400).json({ error: msg });
}

function parseTx(body, trackerId) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be a positive number' };
  const date = String(body.date || todayStr());
  if (!isRealDate(date)) return { error: 'Date must be YYYY-MM-DD' };
  const kind = body.kind === 'income' ? 'income' : 'expense';
  const category_id = body.category_id ? Number(body.category_id) : null;
  if (category_id && !db.prepare('SELECT 1 FROM categories WHERE id = ? AND tracker_id = ?').get(category_id, trackerId)) {
    return { error: 'Unknown category' };
  }
  return { value: { amount: round2(amount), date, kind, category_id, note: String(body.note || '').slice(0, 500) } };
}

// ---- categories ----
r.get('/categories', (req, res) => {
  // most-used categories first (last 90 days), so the add-expense form shows them on top
  res.json(db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM transactions t
                 WHERE t.category_id = c.id AND t.date >= date('now', '-90 days')) AS uses
    FROM categories c WHERE c.tracker_id = ? ORDER BY c.archived, uses DESC, c.name`).all(req.tracker.id));
});

// categorical palette in fixed order; new categories take the first unused slot
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
function nextColor(trackerId) {
  const used = new Set(db.prepare('SELECT color FROM categories WHERE archived = 0 AND tracker_id = ?').all(trackerId)
    .map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? '#898781';
}

r.get('/categories/next-color', (req, res) => res.json({ color: nextColor(req.tracker.id) }));

function parseCategory(c) {
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (!name) return { error: 'Name is required' };
  const limit = c.monthly_limit === '' || c.monthly_limit == null ? null : Number(c.monthly_limit);
  if (limit != null && (!Number.isFinite(limit) || limit < 0)) return { error: 'Limit must be 0 or more' };
  return { value: { name: name.slice(0, 60), icon: String(c.icon), color: String(c.color), limit } };
}

r.post('/categories', (req, res) => {
  const p = parseCategory({ icon: '•', color: nextColor(req.tracker.id), ...req.body });
  if (p.error) return badRequest(res, p.error);
  const v = p.value;
  try {
    const info = db.prepare('INSERT INTO categories (tracker_id, name, icon, color, monthly_limit) VALUES (?, ?, ?, ?, ?)')
      .run(req.tracker.id, v.name, v.icon, v.color, v.limit);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    badRequest(res, 'Category with this name already exists');
  }
});

r.put('/categories/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM categories WHERE id = ? AND tracker_id = ?').get(req.params.id, req.tracker.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const next = { ...cur, ...req.body };
  const p = parseCategory(next);
  if (p.error) return badRequest(res, p.error);
  const v = p.value;
  try {
    db.prepare('UPDATE categories SET name=?, icon=?, color=?, monthly_limit=?, archived=? WHERE id=?')
      .run(v.name, v.icon, v.color, v.limit, next.archived ? 1 : 0, cur.id);
  } catch {
    return badRequest(res, 'Category with this name already exists');
  }
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cur.id));
});

r.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ? AND tracker_id = ?').run(req.params.id, req.tracker.id);
  res.json({ ok: true });
});

// ---- transactions ----
const TX_SELECT = `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                          u.name AS created_by_name
                   FROM transactions t
                   LEFT JOIN categories c ON c.id = t.category_id
                   LEFT JOIN users u ON u.id = t.created_by`;

r.get('/transactions', (req, res) => {
  const { month, category_id, kind, q, member } = req.query;
  const where = ['t.tracker_id = ?'];
  const params = [req.tracker.id];
  if (month) { where.push("substr(t.date, 1, 7) = ?"); params.push(month); }
  if (category_id) { where.push('t.category_id = ?'); params.push(Number(category_id)); }
  if (kind) { where.push('t.kind = ?'); params.push(kind); }
  if (member) { where.push('t.created_by = ?'); params.push(Number(member)); }
  if (q) { where.push("t.note LIKE ? ESCAPE '\\'"); params.push(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`); }
  res.json(db.prepare(`${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC LIMIT 1000`).all(...params));
});

r.post('/transactions', (req, res) => {
  const p = parseTx(req.body, req.tracker.id);
  if (p.error) return badRequest(res, p.error);
  const v = p.value;
  // entries made offline carry a client_id; a retried sync must not create a duplicate
  const clientId = req.body.client_id ? String(req.body.client_id).slice(0, 64) : null;
  if (clientId) {
    const existing = db.prepare('SELECT id FROM transactions WHERE tracker_id = ? AND client_id = ?').get(req.tracker.id, clientId);
    if (existing) return res.json({ id: existing.id, ...v, duplicate: true });
  }
  const info = db.prepare(`INSERT INTO transactions (tracker_id, date, amount, kind, category_id, note, created_by, client_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.tracker.id, v.date, v.amount, v.kind, v.category_id, v.note, req.user.id, clientId);
  res.json({ id: Number(info.lastInsertRowid), ...v });
});

r.put('/transactions/:id', (req, res) => {
  const p = parseTx(req.body, req.tracker.id);
  if (p.error) return badRequest(res, p.error);
  const v = p.value;
  const info = db.prepare('UPDATE transactions SET date=?, amount=?, kind=?, category_id=?, note=? WHERE id=? AND tracker_id=?')
    .run(v.date, v.amount, v.kind, v.category_id, v.note, req.params.id, req.tracker.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ id: Number(req.params.id), ...v });
});

r.delete('/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ? AND tracker_id = ?').run(req.params.id, req.tracker.id);
  res.json({ ok: true });
});

// ---- monthly budget ("money prepared for the month") ----
r.get('/budgets/:month', (req, res) => {
  const b = db.prepare('SELECT * FROM budgets WHERE tracker_id = ? AND month = ?').get(req.tracker.id, req.params.month);
  res.json(b || { month: req.params.month, amount: null, note: '' });
});

r.put('/budgets/:month', (req, res) => {
  if (!MONTH_RE.test(req.params.month)) return badRequest(res, 'Month must be YYYY-MM');
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) return badRequest(res, 'Amount must be >= 0');
  db.prepare(`INSERT INTO budgets (tracker_id, month, amount, note) VALUES (?, ?, ?, ?)
              ON CONFLICT(tracker_id, month) DO UPDATE SET amount=excluded.amount, note=excluded.note`)
    .run(req.tracker.id, req.params.month, round2(amount), String(req.body.note || ''));
  res.json({ month: req.params.month, amount: round2(amount) });
});

// ---- statistics for the dashboard ----
r.get('/stats/month/:month', (req, res) => {
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return badRequest(res, 'Month must be YYYY-MM');
  const tid = req.tracker.id;

  const sumFor = (m, kind) =>
    db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE tracker_id=? AND substr(date,1,7)=? AND kind=?").get(tid, m, kind).s;
  const budgetFor = (m) => db.prepare('SELECT amount FROM budgets WHERE tracker_id = ? AND month = ?').get(tid, m)?.amount ?? null;

  const spent = sumFor(month, 'expense');
  const income = sumFor(month, 'income');
  const budget = budgetFor(month);
  const nDays = daysInMonth(month);

  const today = todayStr();
  const curMonth = today.slice(0, 7);
  const daysElapsed = month < curMonth ? nDays : month > curMonth ? 0 : Number(today.slice(8, 10));
  const daysLeft = nDays - daysElapsed + (month === curMonth ? 1 : 0); // include today when current month

  const byCategory = db.prepare(`
    SELECT c.id, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.icon, '•') AS icon,
           COALESCE(c.color, '#898781') AS color, c.monthly_limit,
           SUM(t.amount) AS total, COUNT(*) AS count
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.tracker_id = ? AND substr(t.date,1,7) = ? AND t.kind = 'expense'
    GROUP BY c.id ORDER BY total DESC`).all(tid, month);

  const dailyRows = db.prepare(`
    SELECT CAST(substr(date, 9, 2) AS INTEGER) AS day, SUM(amount) AS total
    FROM transactions WHERE tracker_id = ? AND substr(date,1,7) = ? AND kind = 'expense' GROUP BY day`).all(tid, month);
  const dailyMap = new Map(dailyRows.map((d) => [d.day, d.total]));
  let cum = 0;
  const daily = [];
  for (let d = 1; d <= nDays; d++) {
    const v = dailyMap.get(d) || 0;
    cum += v;
    daily.push({
      day: d,
      spent: round2(v),
      cumulative: d <= daysElapsed ? round2(cum) : null,
      pace: budget != null ? round2((budget / nDays) * d) : null,
    });
  }

  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    trend.push({ month: m, spent: round2(sumFor(m, 'expense')), income: round2(sumFor(m, 'income')), budget: budgetFor(m) });
  }

  // per-category per-day totals (for the stacked weekly chart)
  const dailyByCategory = db.prepare(`
    SELECT CAST(substr(date, 9, 2) AS INTEGER) AS day, category_id, SUM(amount) AS total
    FROM transactions WHERE tracker_id = ? AND substr(date,1,7) = ? AND kind = 'expense'
    GROUP BY day, category_id ORDER BY day`).all(tid, month).map((r) => ({ ...r, total: round2(r.total) }));

  const prevMonth = shiftMonth(month, -1);
  const prevByCategory = db.prepare(`
    SELECT c.id, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.icon, '•') AS icon,
           COALESCE(c.color, '#898781') AS color, SUM(t.amount) AS total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.tracker_id = ? AND substr(t.date,1,7) = ? AND t.kind = 'expense'
    GROUP BY c.id`).all(tid, prevMonth).map((r) => ({ ...r, total: round2(r.total) }));

  // who spent what (shared trackers)
  const byMember = db.prepare(`
    SELECT t.created_by AS id, COALESCE(u.name, 'Former member') AS name, SUM(t.amount) AS total, COUNT(*) AS count
    FROM transactions t LEFT JOIN users u ON u.id = t.created_by
    WHERE t.tracker_id = ? AND substr(t.date,1,7) = ? AND t.kind = 'expense'
    GROUP BY t.created_by ORDER BY total DESC`).all(tid, month).map((r) => ({ ...r, total: round2(r.total) }));

  const prevSpent = sumFor(prevMonth, 'expense');
  // fair comparison mid-month: last month up to the same day number
  const prevSpentToDate = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions
    WHERE tracker_id = ? AND substr(date,1,7) = ? AND kind = 'expense' AND CAST(substr(date,9,2) AS INTEGER) <= ?`)
    .get(tid, prevMonth, daysElapsed).s;
  const avgPerDay = daysElapsed > 0 ? spent / daysElapsed : 0;
  const remaining = budget != null ? budget - spent : null;

  res.json({
    month,
    budget,
    spent: round2(spent),
    income: round2(income),
    remaining: remaining != null ? round2(remaining) : null,
    usedPct: budget ? round2((spent / budget) * 100) : null,
    daysInMonth: nDays,
    daysElapsed,
    daysLeft,
    avgPerDay: round2(avgPerDay),
    projected: daysElapsed > 0 ? round2(avgPerDay * nDays) : null,
    safeDaily: remaining != null && daysLeft > 0 ? round2(Math.max(0, remaining) / daysLeft) : null,
    prevSpent: round2(prevSpent),
    prevSpentToDate: round2(prevSpentToDate),
    vsPrevPct: daysElapsed > 0 && prevSpentToDate > 0 ? round2(((spent - prevSpentToDate) / prevSpentToDate) * 100) : null,
    txCount: byCategory.reduce((a, c) => a + c.count, 0),
    biggest: db.prepare(`${TX_SELECT} WHERE t.tracker_id = ? AND substr(t.date,1,7)=? AND t.kind='expense'
                         ORDER BY amount DESC LIMIT 3`).all(tid, month),
    byCategory: byCategory.map((c) => ({ ...c, total: round2(c.total) })),
    byMember,
    daily,
    dailyByCategory,
    prevByCategory,
    trend,
  });
});

export default r;
