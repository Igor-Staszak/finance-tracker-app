// User accounts: registration, login sessions (httpOnly cookie), password hashing with scrypt.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, createTracker, claimLegacyData, personalName } from './db.js';
import { createCaptcha, checkCaptcha } from './captcha.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'fin_session';
const SESSION_DAYS = 180;
const REGISTRATION_OPEN = process.env.ALLOW_REGISTRATION !== '0';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = stored.split('$');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: SESSION_DAYS * 864e5,
  });
}

function userFromRequest(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.name, u.base_currency, s.expires_at
                          FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  const { expires_at: _, ...user } = row;
  return user;
}

// Simple brute-force protection: 10 failed logins per IP per 15 minutes
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  return f && f.count >= 10 && Date.now() - f.first < 15 * 60e3;
}
function recordFailure(ip) {
  // forget expired entries so the map doesn't grow forever
  if (failures.size > 1000) for (const [k, v] of failures) if (Date.now() - v.first > 15 * 60e3) failures.delete(k);
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 15 * 60e3) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export function mountAuthRoutes(app) {
  app.get('/api/me', (req, res) => {
    const user = userFromRequest(req);
    res.json({ user, registrationOpen: REGISTRATION_OPEN });
  });

  app.get('/api/captcha', (_req, res) => {
    if (!REGISTRATION_OPEN) return res.status(403).json({ error: 'Registration is closed on this server' });
    res.set('Cache-Control', 'no-store').json(createCaptcha());
  });

  app.post('/api/register', async (req, res) => {
    if (!REGISTRATION_OPEN) return res.status(403).json({ error: 'Registration is closed on this server' });
    const username = String(req.body?.username || '').trim();
    const name = String(req.body?.name || '').trim() || username;
    const password = String(req.body?.password || '');
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username: 3–32 characters, letters, digits, . _ -' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must have at least 8 characters' });
    if (!checkCaptcha(req.body?.captcha_id, req.body?.captcha)) {
      return res.status(400).json({ error: 'The characters from the picture are wrong. Try the new picture.' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'This username is taken' });
    }
    const hash = await hashPassword(password);
    const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const lang = req.body?.lang === 'pl' ? 'pl' : 'en';
    let id;
    try {
      id = Number(db.prepare('INSERT INTO users (username, name, password_hash) VALUES (?, ?, ?)').run(username, name.slice(0, 60), hash).lastInsertRowid);
    } catch {
      return res.status(409).json({ error: 'This username is taken' }); // same name registered meanwhile
    }
    // the first account inherits data created before accounts existed; everyone else starts with a fresh Personal tracker
    const claimed = isFirst && claimLegacyData(id);
    if (!claimed) createTracker(id, personalName(lang), 'PLN', lang);
    startSession(res, id);
    res.json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const ip = req.ip;
    if (tooManyFailures(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    // unknown users still pay for a hash, so response time doesn't reveal which usernames exist
    if (!(await verifyPassword(password, user?.password_hash ?? DUMMY_HASH)) || !user) {
      recordFailure(ip);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    failures.delete(ip);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    startSession(res, user.id);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.put('/api/account', requireAuth, async (req, res) => {
    const { name, base_currency, current_password, new_password } = req.body ?? {};
    // validate everything first, so a rejected request changes nothing
    if (name != null && !String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty' });
    const ccy = base_currency != null ? String(base_currency).toUpperCase() : null;
    if (ccy != null && !/^[A-Z]{3}$/.test(ccy)) return res.status(400).json({ error: 'Currency must be a 3-letter code' });
    if (new_password != null) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!(await verifyPassword(String(current_password || ''), row.password_hash))) {
        return res.status(400).json({ error: 'Current password is wrong' });
      }
      if (String(new_password).length < 8) return res.status(400).json({ error: 'New password must have at least 8 characters' });
    }

    if (name != null) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim().slice(0, 60), req.user.id);
    if (ccy != null) db.prepare('UPDATE users SET base_currency = ? WHERE id = ?').run(ccy, req.user.id);
    if (new_password != null) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(new_password)), req.user.id);
      // log out other devices
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, sha256(req.cookies[COOKIE]));
    }
    res.json(db.prepare('SELECT id, username, name, base_currency FROM users WHERE id = ?').get(req.user.id));
  });
}
