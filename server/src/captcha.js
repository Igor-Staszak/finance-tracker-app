// Self-hosted captcha for sign-up: random characters drawn as distorted SVG strokes (no <text>, so the
// answer isn't in the markup), plus noise lines. Each challenge is single-use and expires after 10 minutes.
import crypto from 'node:crypto';

const TTL_MS = 10 * 60e3;
const LENGTH = 5;
const MAX_PENDING = 5000;

// stroke font on a 4×6 grid; characters that are easy to confuse (0/O, 1/I, 2/Z, 5/S, 8/B…) are left out
const GLYPHS = {
  A: [[[0, 6], [2, 0], [4, 6]], [[1, 3.5], [3, 3.5]]],
  C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4], [4, 2], [2.5, 0], [0, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  F: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  J: [[[4, 0], [4, 5], [3, 6], [1, 6], [0, 5]]],
  K: [[[0, 0], [0, 6]], [[4, 0], [0, 3.5]], [[1.3, 2.7], [4, 6]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  M: [[[0, 6], [0, 0], [2, 3], [4, 0], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  P: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  R: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]], [[2, 3], [4, 6]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [[[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  V: [[[0, 0], [2, 6], [4, 0]]],
  W: [[[0, 0], [1, 6], [2, 2], [3, 6], [4, 0]]],
  X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
  Y: [[[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
  3: [[[0, 0], [4, 0], [2, 2.5], [3.5, 3], [4, 4.5], [3, 6], [1, 6], [0, 5]]],
  4: [[[3, 6], [3, 0], [0, 4], [4, 4]]],
  7: [[[0, 0], [4, 0], [1.5, 6]]],
};
const CHARS = Object.keys(GLYPHS);

const W = 200;
const H = 64;
const rand = (min, max) => min + (crypto.randomInt(0, 10_000) / 10_000) * (max - min);
const f = (n) => n.toFixed(1);

const pending = new Map(); // id -> { answer, expires }

function draw(text) {
  const paths = [];
  const cell = W / (text.length + 1);
  [...text].forEach((ch, i) => {
    const scale = rand(5.5, 7);
    const angle = (rand(-22, 22) * Math.PI) / 180;
    const cx = cell * (i + 1) + rand(-4, 4);
    const cy = H / 2 + rand(-5, 5);
    const d = GLYPHS[ch].map((line) => line.map(([x, y], j) => {
      // centre the glyph, wobble each point, then rotate and place it
      const px = (x - 2 + rand(-0.25, 0.25)) * scale;
      const py = (y - 3 + rand(-0.25, 0.25)) * scale;
      const rx = cx + px * Math.cos(angle) - py * Math.sin(angle);
      const ry = cy + px * Math.sin(angle) + py * Math.cos(angle);
      return `${j ? 'L' : 'M'}${f(rx)} ${f(ry)}`;
    }).join('')).join('');
    paths.push(`<path d="${d}" stroke-width="${f(rand(2.2, 3))}"/>`);
  });
  // noise: curves across the whole image and short strokes in between the characters
  for (let i = 0; i < 4; i++) {
    paths.push(`<path d="M0 ${f(rand(8, H - 8))}Q${f(rand(40, W - 40))} ${f(rand(-20, H + 20))} ${W} ${f(rand(8, H - 8))}" stroke-width="${f(rand(1, 2))}" opacity="0.55"/>`);
  }
  for (let i = 0; i < 10; i++) {
    const x = rand(0, W);
    const y = rand(0, H);
    paths.push(`<path d="M${f(x)} ${f(y)}l${f(rand(-12, 12))} ${f(rand(-12, 12))}" stroke-width="1.5" opacity="0.5"/>`);
  }
  // shuffle so the character strokes aren't simply the first paths in the markup
  for (let i = paths.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [paths[i], paths[j]] = [paths[j], paths[i]];
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none" `
    + `stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" role="img">${paths.join('')}</svg>`;
}

export function createCaptcha() {
  const now = Date.now();
  if (pending.size >= MAX_PENDING) {
    for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
    if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value); // drop the oldest
  }
  // tests can't read the image, so they set a fixed answer; never set this in production
  const answer = process.env.CAPTCHA_TEST_ANSWER
    || Array.from({ length: LENGTH }, () => CHARS[crypto.randomInt(0, CHARS.length)]).join('');
  const id = crypto.randomBytes(16).toString('base64url');
  pending.set(id, { answer, expires: now + TTL_MS });
  return { id, svg: draw(answer) };
}

/** True if the answer matches. Every challenge can be tried once, right or wrong. */
export function checkCaptcha(id, answer) {
  const c = pending.get(String(id || ''));
  if (!c) return false;
  pending.delete(String(id));
  const given = String(answer || '').toUpperCase().replace(/\s+/g, '');
  return c.expires > Date.now() && given === c.answer;
}
