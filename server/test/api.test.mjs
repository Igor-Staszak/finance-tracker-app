// End-to-end API test: accounts, tracker isolation, sharing, migration claim.
// Run: node --test server/test/   (starts its own server on a temp DB)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/finance-tracker/api`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-test-'));
const DB = path.join(dir, 'test.db');
const CAPTCHA = 'ACE47'; // fixed answer for every captcha in tests (CAPTCHA_TEST_ANSWER)
let server;


// seed a v1 (pre-accounts) database to exercise the migration
if (process.env.V1_DB) fs.copyFileSync(process.env.V1_DB, DB);

class Client {
  cookie = '';
  async call(method, url, body) {
    // sign-ups need a solved captcha unless the test passes its own
    if (url === '/register' && body && !('captcha_id' in body)) {
      body = { ...body, captcha_id: (await this.get('/captcha')).body.id, captcha: CAPTCHA };
    }
    const res = await fetch(BASE + url, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  get(u) { return this.call('GET', u); }
  post(u, b) { return this.call('POST', u, b); }
  put(u, b) { return this.call('PUT', u, b); }
  del(u) { return this.call('DELETE', u); }
}

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', 'src/index.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DB_PATH: DB, PORT: String(PORT), CAPTCHA_TEST_ANSWER: CAPTCHA },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const anna = new Client();
const bob = new Client();
const eve = new Client();
let annaPersonal, bobPersonal, household;

test('register + me', async () => {
  assert.equal((await anna.get('/trackers')).status, 401);
  assert.equal((await anna.post('/register', { username: 'anna', name: 'Anna', password: 'short' })).status, 400);
  assert.equal((await anna.post('/register', { username: 'anna', name: 'Anna', password: 'password-anna' })).status, 200);
  assert.equal((await bob.post('/register', { username: 'ANNA', password: 'whatever123' })).status, 409, 'usernames are case-insensitive');
  assert.equal((await bob.post('/register', { username: 'bob', name: 'Bob', password: 'password-bob' })).status, 200);
  assert.equal((await eve.post('/register', { username: 'eve', name: 'Eve', password: 'password-eve' })).status, 200);
  const me = await anna.get('/me');
  assert.equal(me.body.user.username, 'anna');
  assert.equal(me.body.user.password_hash, undefined);
});

test('login / logout / wrong password', async () => {
  const c = new Client();
  assert.equal((await c.post('/login', { username: 'anna', password: 'nope-nope' })).status, 401);
  assert.equal((await c.post('/login', { username: 'Anna', password: 'password-anna' })).status, 200);
  assert.equal((await c.get('/trackers')).status, 200);
  await c.post('/logout', {});
  assert.equal((await c.get('/trackers')).status, 401);
});

test('each user gets a Personal tracker with default categories', async () => {
  const a = (await anna.get('/trackers')).body;
  const b = (await bob.get('/trackers')).body;
  assert.equal(a.length, 1);
  assert.equal(a[0].name, 'Personal');
  annaPersonal = a[0].id;
  bobPersonal = b[0].id;
  assert.notEqual(annaPersonal, bobPersonal);
  const cats = (await anna.get(`/trackers/${annaPersonal}/categories`)).body;
  assert.ok(cats.length >= 8);
});

test('users cannot see or touch each other\'s trackers', async () => {
  await anna.post(`/trackers/${annaPersonal}/transactions`, { amount: 50, note: 'anna secret' });
  assert.equal((await bob.get(`/trackers/${annaPersonal}/transactions`)).status, 404);
  assert.equal((await bob.get(`/trackers/${annaPersonal}/stats/month/2026-10`)).status, 404);
  assert.equal((await bob.post(`/trackers/${annaPersonal}/transactions`, { amount: 1 })).status, 404);
  // transaction id from anna's tracker via bob's tracker path must not work
  const annaTx = (await anna.get(`/trackers/${annaPersonal}/transactions`)).body[0];
  assert.equal((await bob.put(`/trackers/${bobPersonal}/transactions/${annaTx.id}`, { amount: 999 })).status, 404);
  await bob.del(`/trackers/${bobPersonal}/transactions/${annaTx.id}`);
  assert.equal((await anna.get(`/trackers/${annaPersonal}/transactions`)).body.length, 1, 'still there');
  // cannot use another tracker's category
  const annaCat = (await anna.get(`/trackers/${annaPersonal}/categories`)).body[0];
  assert.equal((await bob.post(`/trackers/${bobPersonal}/transactions`, { amount: 5, category_id: annaCat.id })).status, 400);
});

test('investments and piggybank are private', async () => {
  await anna.post('/piggy', { name: 'Anna cash', type: 'cash', balance: 100 });
  assert.equal((await bob.get('/piggy')).body.accounts.length, 0);
  const annaPot = (await anna.get('/piggy')).body.accounts[0];
  assert.equal((await bob.put(`/piggy/${annaPot.id}`, { balance: 0 })).status, 404);
  await bob.del(`/piggy/${annaPot.id}`);
  assert.equal((await anna.get('/piggy')).body.accounts.length, 1);
});

test('create a Household tracker and share it with bob', async () => {
  const h = await anna.post('/trackers', { name: 'Household', currency: 'PLN' });
  assert.equal(h.status, 200);
  household = h.body.id;
  assert.equal((await anna.post(`/trackers/${household}/members`, { username: 'nobody' })).status, 404);
  const shared = await anna.post(`/trackers/${household}/members`, { username: 'bob' });
  assert.equal(shared.status, 200);
  assert.deepEqual(shared.body.members.map((m) => m.username).sort(), ['anna', 'bob']);
  assert.equal((await anna.post(`/trackers/${household}/members`, { username: 'bob' })).status, 409);
  // bob sees both his personal and the shared one; anna's personal stays hidden
  const bobs = (await bob.get('/trackers')).body.map((t) => t.name);
  assert.deepEqual(bobs, ['Personal', 'Household']);
});

test('both contribute; stats split by person', async () => {
  await anna.post(`/trackers/${household}/transactions`, { amount: 100, date: '2026-10-05' });
  await bob.post(`/trackers/${household}/transactions`, { amount: 40, date: '2026-10-06' });
  await bob.put(`/trackers/${household}/budgets/2026-10`, { amount: 2000 });
  const s = (await anna.get(`/trackers/${household}/stats/month/2026-10`)).body;
  assert.equal(s.spent, 140);
  assert.equal(s.budget, 2000);
  assert.deepEqual(s.byMember.map((m) => [m.name, m.total]), [['Anna', 100], ['Bob', 40]]);
  const txs = (await bob.get(`/trackers/${household}/transactions?month=2026-10`)).body;
  assert.deepEqual(txs.map((t) => t.created_by_name).sort(), ['Anna', 'Bob']);
  // shared tracker spending does not leak into personal ones
  assert.equal((await bob.get(`/trackers/${bobPersonal}/stats/month/2026-10`)).body.spent, 0);
});

test('only the owner manages the tracker; members can leave', async () => {
  assert.equal((await bob.put(`/trackers/${household}`, { name: 'Bob house' })).status, 403);
  assert.equal((await bob.post(`/trackers/${household}/members`, { username: 'eve' })).status, 403);
  assert.equal((await bob.del(`/trackers/${household}`)).status, 403);
  const annaId = (await anna.get('/me')).body.user.id;
  assert.equal((await bob.del(`/trackers/${household}/members/${annaId}`)).status, 403);
  assert.equal((await anna.del(`/trackers/${household}/members/${annaId}`)).status, 400, 'owner cannot leave');
  const bobId = (await bob.get('/me')).body.user.id;
  assert.equal((await bob.del(`/trackers/${household}/members/${bobId}`)).status, 200);
  assert.equal((await bob.get(`/trackers/${household}/transactions`)).status, 404, 'access gone after leaving');
  // bob's past expenses stay in the household, still attributed
  const txs = (await anna.get(`/trackers/${household}/transactions`)).body;
  assert.ok(txs.some((t) => t.created_by_name === 'Bob'));
});

test('cannot delete your only tracker', async () => {
  assert.equal((await eve.del(`/trackers/${(await eve.get('/trackers')).body[0].id}`)).status, 400);
  assert.equal((await anna.del(`/trackers/${household}`)).status, 200);
});

test('legacy data is claimed by the first account only', { skip: !process.env.V1_DB }, async () => {
  const t = (await anna.get('/trackers')).body;
  const budget = (await anna.get(`/trackers/${t[0].id}/budgets/2026-10`)).body;
  assert.equal(budget.amount, 3000, 'pre-account budget moved to the first user');
  assert.equal((await bob.get('/trackers')).body.filter((x) => x.name === 'Personal').length, 1);
});

test('offline sync: retried create with the same client_id is stored once', async () => {
  const t = (await eve.get('/trackers')).body[0].id;
  const body = { amount: 12.5, note: 'offline coffee', client_id: 'c-123e4567-offline' };
  const first = await eve.post(`/trackers/${t}/transactions`, body);
  const again = await eve.post(`/trackers/${t}/transactions`, body);
  assert.equal(first.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.duplicate, true);
  const list = (await eve.get(`/trackers/${t}/transactions`)).body.filter((x) => x.note === 'offline coffee');
  assert.equal(list.length, 1);
  // same client_id in another tracker is a different entry
  const other = (await eve.post('/trackers', { name: 'Trip' })).body.id;
  assert.notEqual((await eve.post(`/trackers/${other}/transactions`, body)).body.id, first.body.id);
});

test('language: Polish sign-up gets Polish tracker name and categories', async () => {
  const ola = new Client();
  assert.equal((await ola.post('/register', { username: 'ola', name: 'Ola', password: 'password-ola', lang: 'pl' })).status, 200);
  const [tr] = (await ola.get('/trackers')).body;
  assert.equal(tr.name, 'Osobisty');
  const names = (await ola.get(`/trackers/${tr.id}/categories`)).body.map((c) => c.name);
  assert.ok(names.includes('Zakupy spożywcze') && names.includes('Wynagrodzenie'));
  const hh = (await ola.post('/trackers', { name: 'Dom', lang: 'pl' })).body;
  assert.ok((await ola.get(`/trackers/${hh.id}/categories`)).body.some((c) => c.name === 'Rozrywka'));
});


test('salary: earnings - costs = net, posted once as income, kept in sync', async () => {
  const u = new Client();
  await u.post('/register', { username: 'zofia', name: 'Zofia', password: 'password-zofia' });
  const personal = (await u.get('/trackers')).body[0].id;
  const items = [
    { kind: 'earning', name: 'Base salary', amount: 8000 },
    { kind: 'earning', name: 'Bonus', amount: 1200.5 },
    { kind: 'cost', name: 'Commute', amount: 350 },
    { kind: 'cost', name: 'Parking', amount: 150.5 },
    { kind: 'cost', name: '', amount: 0 }, // empty row is ignored
  ];
  const s = (await u.put('/salary/2026-10', { items, tracker_id: personal, use_as_budget: true, note: 'Salary (net)' })).body;
  assert.equal(s.earnings, 9200.5);
  assert.equal(s.costs, 500.5);
  assert.equal(s.net, 8700);
  assert.equal(s.items.length, 4);
  assert.equal(s.posted.amount, 8700);

  // one income in the tracker, budget set to the net
  const incomes = () => u.get(`/trackers/${personal}/transactions?month=2026-10&kind=income`).then((r) => r.body);
  assert.deepEqual((await incomes()).map((x) => [x.amount, x.note, x.date, x.category_name]), [[8700, 'Salary (net)', '2026-10-01', 'Salary']]);
  assert.equal((await u.get(`/trackers/${personal}/budgets/2026-10`)).body.amount, 8700);

  // editing updates the same transaction (no duplicates)
  items[1].amount = 0;
  const s2 = (await u.put('/salary/2026-10', { items, tracker_id: personal, use_as_budget: true })).body;
  assert.equal(s2.net, 7499.5);
  assert.equal(s2.posted.transaction_id, s.posted.transaction_id);
  assert.deepEqual((await incomes()).map((x) => x.amount), [7499.5]);

  // moving to another tracker moves the income
  const other = (await u.post('/trackers', { name: 'Home' })).body.id;
  await u.put('/salary/2026-10', { items, tracker_id: other });
  assert.equal((await incomes()).length, 0);
  assert.equal((await u.get(`/trackers/${other}/transactions?kind=income`)).body.length, 1);

  // next month suggests last month's items
  const nov = (await u.get('/salary/2026-11')).body;
  assert.equal(nov.saved, false);
  assert.equal(nov.suggestion.from, '2026-10');
  assert.equal(nov.suggestion.items.length, 4);

  // 12-month overview
  const year = (await u.get('/salary?to=2026-11')).body;
  assert.equal(year.length, 12);
  assert.equal(year.find((m) => m.month === '2026-10').net, 7499.5);

  // validation and privacy
  assert.equal((await u.put('/salary/2026-10', { items: [{ kind: 'earning', name: 'X', amount: -5 }] })).status, 400);
  assert.equal((await u.put('/salary/2026-10', { items: [{ kind: 'bogus', name: 'X', amount: 5 }] })).status, 400);
  const annaPersonal = (await anna.get('/trackers')).body[0].id;
  assert.equal((await u.put('/salary/2026-10', { items, tracker_id: annaPersonal })).status, 404, 'cannot post into a tracker you are not in');
  assert.equal((await anna.get('/salary/2026-10')).body.saved, false, 'salaries are private');

  // deleting removes the income too
  await u.del('/salary/2026-10');
  assert.equal((await u.get(`/trackers/${other}/transactions?kind=income`)).body.length, 0);
  assert.equal((await u.get('/salary/2026-10')).body.saved, false);
});

test('a user left with no trackers gets a new Personal one (no blank app)', async () => {
  const carl = new Client();
  const dana = new Client();
  await carl.post('/register', { username: 'carl', password: 'password-carl' });
  await dana.post('/register', { username: 'dana', password: 'password-dana' });
  const carlPersonal = (await carl.get('/trackers')).body[0];
  const shared = (await dana.post('/trackers', { name: 'Flat' })).body;
  await dana.post(`/trackers/${shared.id}/members`, { username: 'carl' });
  assert.equal((await carl.del(`/trackers/${carlPersonal.id}`)).status, 200);
  const carlId = (await carl.get('/me')).body.user.id;
  await dana.del(`/trackers/${shared.id}/members/${carlId}`);
  const list = (await carl.get('/trackers')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].role, 'owner');
});

test('input validation: impossible dates, empty category names, bad types', async () => {
  const tp = `/trackers/${annaPersonal}`;
  assert.equal((await anna.post(`${tp}/transactions`, { amount: 5, date: '2026-02-31' })).status, 400);
  assert.equal((await anna.post(`${tp}/transactions`, { amount: 5, date: '2026-13-01' })).status, 400);
  const cat = (await anna.get(`${tp}/categories`)).body[0];
  assert.equal((await anna.put(`${tp}/categories/${cat.id}`, { name: '  ' })).status, 400);
  assert.equal((await anna.post(`${tp}/categories`, { name: 42 })).status, 400);
  assert.equal((await anna.put(`${tp}/categories/${cat.id}`, { monthly_limit: 'abc' })).status, 400);
});

test('account update is all-or-nothing when the current password is wrong', async () => {
  const before = (await anna.get('/me')).body.user;
  const r = await anna.put('/account', { name: 'Hacked', current_password: 'nope', new_password: 'whatever-123' });
  assert.equal(r.status, 400);
  assert.equal((await anna.get('/me')).body.user.name, before.name);
});

test('note search treats % and _ as plain characters', async () => {
  const tp = `/trackers/${annaPersonal}`;
  await anna.post(`${tp}/transactions`, { amount: 3, note: '50% off' });
  await anna.post(`${tp}/transactions`, { amount: 4, note: '500 off' });
  const hits = (await anna.get(`${tp}/transactions?q=${encodeURIComponent('0%')}`)).body;
  assert.deepEqual(hits.map((x) => x.note), ['50% off']);
  assert.equal((await anna.get(`${tp}/transactions?q=_`)).body.length, 0);
});

test('registration needs a correct, unused captcha', async () => {
  const c = new Client();
  const cap = (await c.get('/captcha')).body;
  assert.match(cap.svg, /^<svg[^>]*>.*<\/svg>$/s);
  assert.doesNotMatch(cap.svg, /<text|ACE47/, 'the answer is drawn, not written in the markup');
  const form = { username: 'robot', password: 'password-robot' };
  assert.equal((await c.post('/register', { ...form, captcha_id: cap.id, captcha: 'WRONG' })).status, 400);
  assert.equal((await c.post('/register', { ...form, captcha_id: cap.id, captcha: CAPTCHA })).status, 400, 'single use');
  assert.equal((await c.post('/register', { ...form, captcha_id: 'made-up', captcha: CAPTCHA })).status, 400);
  assert.equal((await c.post('/register', { ...form, captcha_id: undefined })).status, 400, 'missing captcha');
  const fresh = (await c.get('/captcha')).body;
  assert.equal((await c.post('/register', { ...form, captcha_id: fresh.id, captcha: ' ace 47 ' })).status, 200, 'case and spaces ignored');
});

test('the app lives under /finance-tracker; / redirects there', async () => {
  const root = await fetch(`http://localhost:${PORT}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/finance-tracker/');
  assert.equal((await fetch(`http://localhost:${PORT}/api/me`)).status, 404, 'no API outside the base path');
});
