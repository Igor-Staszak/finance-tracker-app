import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { db } from './db.js';
import { requireAuth, mountAuthRoutes } from './auth.js';
import trackers, { loadTracker } from './trackers.js';
import spending from './spending.js';
import portfolio, { computePortfolio } from './portfolio.js';
import piggy, { computePiggy } from './piggy.js';
import salary from './salary.js';

// the whole app (web + API) lives under this path; must match `base` in web/vite.config.ts
const BASE_PATH = '/finance-tracker';

const app = express();
app.set('trust proxy', 'loopback'); // behind nginx: req.ip is the real client
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

const site = express.Router();
app.get('/', (_req, res) => res.redirect(302, `${BASE_PATH}/`));
app.use(BASE_PATH, site);

mountAuthRoutes(site);
site.use('/api', requireAuth);
site.use('/api', trackers);
site.use('/api/trackers/:tid', loadTracker, spending);
site.use('/api', portfolio);
site.use('/api', piggy);
site.use('/api', salary);

// Net worth = piggybank + investments (personal, never shared)
site.get('/api/overview', async (req, res) => {
  const [p, pg] = await Promise.all([computePortfolio(req.user), computePiggy(req.user)]);
  res.json({
    base: p.base,
    investments: p.totals.value,
    savings: pg.total,
    netWorth: Math.round((p.totals.value + pg.total) * 100) / 100,
  });
});

// JSON backup of everything this user can see
site.get('/api/export', (req, res) => {
  const uid = req.user.id;
  const trackerIds = db.prepare('SELECT tracker_id FROM tracker_members WHERE user_id = ?').all(uid).map((r) => r.tracker_id);
  const inT = `(${trackerIds.map(() => '?').join(',') || 'NULL'})`;
  const dump = {
    user: req.user,
    trackers: db.prepare(`SELECT * FROM trackers WHERE id IN ${inT}`).all(...trackerIds),
    categories: db.prepare(`SELECT * FROM categories WHERE tracker_id IN ${inT}`).all(...trackerIds),
    transactions: db.prepare(`SELECT * FROM transactions WHERE tracker_id IN ${inT}`).all(...trackerIds),
    budgets: db.prepare(`SELECT * FROM budgets WHERE tracker_id IN ${inT}`).all(...trackerIds),
    holdings: db.prepare('SELECT * FROM holdings WHERE user_id = ?').all(uid),
    portfolio_snapshots: db.prepare('SELECT * FROM portfolio_snapshots WHERE user_id = ?').all(uid),
    piggy_accounts: db.prepare('SELECT * FROM piggy_accounts WHERE user_id = ?').all(uid),
    piggy_history: db.prepare(`SELECT h.* FROM piggy_history h JOIN piggy_accounts a ON a.id = h.account_id
                               WHERE a.user_id = ?`).all(uid),
    salary_months: db.prepare('SELECT * FROM salary_months WHERE user_id = ?').all(uid),
    salary_items: db.prepare(`SELECT i.* FROM salary_items i JOIN salary_months s ON s.id = i.salary_id
                              WHERE s.user_id = ?`).all(uid),
  };
  res.setHeader('Content-Disposition', `attachment; filename="finance-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
});

site.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web app (production)
const dist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(dist)) {
  site.use(express.static(dist));
  site.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => console.log(`Finance listening on http://${host}:${port}${BASE_PATH}/`));
