// Spending trackers and sharing them with other users.
import { Router } from 'express';
import { db, createTracker, personalName } from './db.js';

const r = Router();

function trackersFor(userId) {
  const rows = db.prepare(`
    SELECT t.id, t.name, t.currency, t.owner_id, m.role
    FROM trackers t JOIN tracker_members m ON m.tracker_id = t.id
    WHERE m.user_id = ? ORDER BY t.created_at, t.id`).all(userId);
  const members = db.prepare(`
    SELECT u.id, u.username, u.name, m.role FROM tracker_members m JOIN users u ON u.id = m.user_id
    WHERE m.tracker_id = ? ORDER BY m.role DESC, m.added_at`);
  return rows.map((t) => ({ ...t, members: members.all(t.id) }));
}

/** Loads req.tracker + req.role if the user is a member; 404 otherwise (don't reveal other trackers exist). */
export function loadTracker(req, res, next) {
  const row = db.prepare(`SELECT t.*, m.role FROM trackers t JOIN tracker_members m ON m.tracker_id = t.id
                          WHERE t.id = ? AND m.user_id = ?`).get(Number(req.params.tid), req.user.id);
  if (!row) return res.status(404).json({ error: 'Tracker not found' });
  req.tracker = row;
  next();
}

const ownerOnly = (req, res, next) =>
  req.tracker.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this' });

function parse(body) {
  const name = String(body?.name || '').trim();
  if (!name) return { error: 'Name is required' };
  const currency = String(body?.currency || 'PLN').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code' };
  return { value: { name: name.slice(0, 60), currency } };
}

r.get('/trackers', (req, res) => {
  // everyone needs at least one tracker (the app can't open without one); this happens when someone deleted
  // their own tracker and was then removed from, or left, every shared one
  if (!db.prepare('SELECT 1 FROM tracker_members WHERE user_id = ?').get(req.user.id)) {
    const lang = req.acceptsLanguages('pl', 'en') === 'pl' ? 'pl' : 'en';
    createTracker(req.user.id, personalName(lang), 'PLN', lang);
  }
  res.json(trackersFor(req.user.id));
});

r.post('/trackers', (req, res) => {
  const p = parse(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const id = createTracker(req.user.id, p.value.name, p.value.currency, req.body?.lang === 'pl' ? 'pl' : 'en');
  res.json(trackersFor(req.user.id).find((t) => t.id === id));
});

r.put('/trackers/:tid', loadTracker, ownerOnly, (req, res) => {
  const p = parse({ ...req.tracker, ...req.body });
  if (p.error) return res.status(400).json({ error: p.error });
  db.prepare('UPDATE trackers SET name = ?, currency = ? WHERE id = ?').run(p.value.name, p.value.currency, req.tracker.id);
  res.json(trackersFor(req.user.id).find((t) => t.id === req.tracker.id));
});

r.delete('/trackers/:tid', loadTracker, ownerOnly, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM tracker_members WHERE user_id = ?').get(req.user.id).n;
  if (count <= 1) return res.status(400).json({ error: 'You need at least one tracker. Create another one first.' });
  db.prepare('DELETE FROM trackers WHERE id = ?').run(req.tracker.id);
  res.json({ ok: true });
});

// share: add another user by username
r.post('/trackers/:tid/members', loadTracker, ownerOnly, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const user = db.prepare('SELECT id, username, name FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: `No user called "${username}". They need to register first.` });
  const exists = db.prepare('SELECT 1 FROM tracker_members WHERE tracker_id = ? AND user_id = ?').get(req.tracker.id, user.id);
  if (exists) return res.status(409).json({ error: `${user.name} already has access` });
  db.prepare("INSERT INTO tracker_members (tracker_id, user_id, role) VALUES (?, ?, 'member')").run(req.tracker.id, user.id);
  res.json(trackersFor(req.user.id).find((t) => t.id === req.tracker.id));
});

// owner removes a member, or a member leaves
r.delete('/trackers/:tid/members/:uid', loadTracker, (req, res) => {
  const uid = Number(req.params.uid);
  const self = uid === req.user.id;
  if (!self && req.tracker.role !== 'owner') return res.status(403).json({ error: 'Only the owner can remove people' });
  if (uid === req.tracker.owner_id) return res.status(400).json({ error: 'The owner cannot leave. Delete the tracker instead.' });
  db.prepare('DELETE FROM tracker_members WHERE tracker_id = ? AND user_id = ?').run(req.tracker.id, uid);
  res.json({ ok: true });
});

export default r;
