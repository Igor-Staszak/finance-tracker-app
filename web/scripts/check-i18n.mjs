// Checks that every text wrapped in t()/tn() has a translation in each language file.
// Usage: npm run check:i18n   (exit code 1 when something is missing)
import fs from 'node:fs';
import path from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const STR = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;
const unq = (q) => q.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
const files = fs.readdirSync(SRC, { recursive: true }).filter((f) => /\.tsx?$/.test(f) && !f.startsWith('locales') && f !== 'i18n.ts');

const keys = new Set(['System', 'Light', 'Dark', 'AMOLED', 'Cash', 'Bank account', 'Savings account', 'Term deposit', 'Other', 'owner', 'member']);
const plurals = new Set();
for (const f of files) {
  const s = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of s.matchAll(new RegExp(String.raw`\btn\(\s*${STR}\s*,\s*${STR}`, 'g'))) plurals.add(unq(m[2]));
  for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.])t\(\s*${STR}`, 'g'))) keys.add(unq(m[1]));
}

let failed = false;
for (const file of fs.readdirSync(path.join(SRC, 'locales'))) {
  // load the TS dictionary without a TS toolchain: drop imports/types
  const js = fs.readFileSync(path.join(SRC, 'locales', file), 'utf8')
    .replace(/^import .*$/gm, '').replace(/: Dict\b/, '').replace(/: \[RegExp, string\]\[\]/, '')
    .replace(/export default (\w+);/, 'export { $1 as dict };');
  const tmp = path.join(fs.mkdtempSync('/tmp/i18n-'), 'dict.mjs');
  fs.writeFileSync(tmp, js);
  const { dict } = await import(tmp);
  const forms = new Intl.PluralRules(file.replace('.ts', '')).resolvedOptions().pluralCategories.filter((c) => c !== 'other');
  const missing = [...keys].filter((k) => typeof dict[k] !== 'string');
  const missingPlural = [...plurals].filter((k) => typeof dict[k] !== 'object' || forms.some((f) => !dict[k][f]));
  const badVars = [...keys].filter((k) => typeof dict[k] === 'string' && (k.match(/\{\w+\}/g) || []).some((v) => !dict[k].includes(v)));
  console.log(`${file}: ${keys.size - missing.length}/${keys.size} texts, ${plurals.size - missingPlural.length}/${plurals.size} plurals`);
  for (const k of missing) console.log('  missing:', JSON.stringify(k));
  for (const k of missingPlural) console.log('  missing plural forms:', JSON.stringify(k));
  for (const k of badVars) console.log('  placeholder lost:', JSON.stringify(k));
  if (missing.length || missingPlural.length || badVars.length) failed = true;
}
process.exit(failed ? 1 : 0);
