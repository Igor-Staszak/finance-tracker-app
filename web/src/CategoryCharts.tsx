import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthStats } from './api';
import { Card } from './components';
import { axisProps, type Palette } from './palette';
import { seriesColor } from './theme';
import { money, pct, sharePct, short } from './util';
import { t, tn } from './i18n';

const MAX_SLICES = 7; // + "Everything else" = 8 series max
const REST = 'rest';

interface Slice { key: string; id: number | null; name: string; icon: string; color: string; total: number; count: number; limit: number | null }

/** Top categories by spend, the tail folded into one "Everything else" slice. Colors follow the category, never rank. */
function useSlices(s: MonthStats, p: Palette): Slice[] {
  const all = s.byCategory.map((c) => ({
    key: String(c.id ?? 'none'), id: c.id, name: c.name, icon: c.icon,
    color: seriesColor(c.color, p.theme), total: c.total, count: c.count, limit: c.monthly_limit,
  }));
  if (all.length <= MAX_SLICES + 1) return all;
  const head = all.slice(0, MAX_SLICES);
  const tail = all.slice(MAX_SLICES);
  head.push({
    // lighter neutral than the "Other" category's gray, so the two never look alike
    key: REST, id: null, name: t('Everything else ({n})', { n: tail.length }), icon: '…', color: p.theme === 'light' ? '#c3c2b7' : '#5f5e5a',
    total: Math.round(tail.reduce((a, c) => a + c.total, 0) * 100) / 100,
    count: tail.reduce((a, c) => a + c.count, 0), limit: null,
  });
  return head;
}

function SliceTip({ active, payload, total }: { active?: boolean; payload?: { payload: Slice }[]; total: number }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-row"><span className="swatch" style={{ background: c.color }} /><span>{c.icon} {c.name}</span></div>
      <div className="tip-row"><span>{tn('{n} expense', '{n} expenses', c.count)}</span><b>{money(c.total)}</b></div>
      <div className="tip-row muted"><span>{t('share')}</span><b>{sharePct(c.total, total, 1)}</b></div>
    </div>
  );
}

export function CategoryDonut({ s, p }: { s: MonthStats; p: Palette }) {
  const slices = useSlices(s, p);
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const open = (c: Slice) => c.key !== REST && navigate(`/transactions?month=${s.month}&category_id=${c.id ?? ''}`);

  if (!slices.length) return <Card title={t('Where the money went')}><p className="muted">{t('No expenses yet this month.')}</p></Card>;
  const focus = slices.find((x) => x.key === hover);

  return (
    <Card title={t('Where the money went')}>
      <div className="donut-wrap">
        <div className="donut">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={slices} dataKey="total" nameKey="name" innerRadius="62%" outerRadius="96%" startAngle={90} endAngle={-270}
                stroke={p.surface} strokeWidth={2} isAnimationActive={false}
                onMouseEnter={(_, i) => setHover(slices[i].key)} onMouseLeave={() => setHover(null)}
                onClick={(_, i) => open(slices[i])} style={{ cursor: 'pointer' }}>
                {slices.map((c) => (
                  <Cell key={c.key} fill={c.color} opacity={hover && hover !== c.key ? 0.35 : 1} />
                ))}
              </Pie>
              <Tooltip content={<SliceTip total={s.spent} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center" aria-hidden>
            <small>{focus ? `${focus.icon} ${focus.name}` : t('Spent')}</small>
            <b>{money(focus ? focus.total : s.spent, undefined, { compact: true })}</b>
            {focus && <small>{sharePct(focus.total, s.spent)}</small>}
          </div>
        </div>
        <ul className="donut-legend">
          {slices.map((c) => (
            <li key={c.key} onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)} onClick={() => open(c)}
              className={hover && hover !== c.key ? 'dim' : ''}>
              <span className="swatch" style={{ background: c.color }} />
              <span className="grow">{c.icon} {c.name}</span>
              <span className="num">{money(c.total)}</span>
              <span className="num muted pct-col">{sharePct(c.total, s.spent)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

const WEEKS: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 31]];

export function CategoryWeekly({ s, p }: { s: MonthStats; p: Palette }) {
  const slices = useSlices(s, p);
  if (!slices.length) return null;
  const keyOf = (id: number | null) => {
    const k = String(id ?? 'none');
    return slices.some((x) => x.key === k) ? k : REST;
  };
  const rows = WEEKS.filter(([a]) => a <= s.daysInMonth).map(([a, b]) => {
    const end = Math.min(b, s.daysInMonth);
    const row: Record<string, number | string> = { week: `${a}–${end}` };
    for (const d of s.dailyByCategory ?? []) {
      if (d.day < a || d.day > end) continue;
      const k = keyOf(d.category_id);
      row[k] = Math.round((((row[k] as number) ?? 0) + d.total) * 100) / 100;
    }
    return row;
  });

  return (
    <Card title={t('Categories week by week')}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis dataKey="week" {...axisProps(p)} />
          <YAxis {...axisProps(p)} width="auto" tickFormatter={short} axisLine={false} />
          <Tooltip cursor={{ fill: p.grid, opacity: 0.4 }} content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const items = payload.filter((x) => x.value).slice().reverse();
            const sum = items.reduce((a, x) => a + Number(x.value), 0);
            return (
              <div className="tip">
                <div className="tip-label">{t('Days {range}', { range: String(label) })}</div>
                {items.map((x) => (
                  <div key={String(x.dataKey)} className="tip-row"><span className="swatch" style={{ background: x.color }} /><span>{x.name}</span><b>{money(Number(x.value))}</b></div>
                ))}
                <div className="tip-row tip-total"><span>{t('Total')}</span><b>{money(sum)}</b></div>
              </div>
            );
          }} />
          {slices.map((c) => (
            <Bar key={c.key} dataKey={c.key} name={`${c.icon} ${c.name}`} stackId="a" fill={c.color} stroke={p.surface} strokeWidth={1} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="legend">
        {slices.map((c) => <span key={c.key}><i className="sq" style={{ background: c.color }} />{c.name}</span>)}
      </div>
    </Card>
  );
}

export function CategoryVsLastMonth({ s, p }: { s: MonthStats; p: Palette }) {
  const [showAll, setShowAll] = useState(false);
  const prev = new Map((s.prevByCategory ?? []).map((c) => [String(c.id ?? 'none'), c]));
  const keys = new Set([...s.byCategory.map((c) => String(c.id ?? 'none')), ...prev.keys()]);
  const rows = [...keys].map((k) => {
    const cur = s.byCategory.find((c) => String(c.id ?? 'none') === k);
    const last = prev.get(k);
    const base = cur ?? last!;
    return { key: k, name: base.name, icon: base.icon, color: seriesColor(base.color, p.theme), now: cur?.total ?? 0, last: last?.total ?? 0 };
  }).sort((a, b) => Math.max(b.now, b.last) - Math.max(a.now, a.last));

  if (!rows.length || s.spent === 0) return null;
  const max = Math.max(...rows.map((r) => Math.max(r.now, r.last)), 1);
  const partial = s.daysElapsed > 0 && s.daysElapsed < s.daysInMonth;

  return (
    <Card title={t('Compared with last month')}>
      <ul className="cat-bars">
        {(showAll ? rows : rows.slice(0, 6)).map((r) => {
          const delta = r.last > 0 ? ((r.now - r.last) / r.last) * 100 : null;
          return (
            <li key={r.key} title={t('{name}: {now} this month, {last} last month', { name: r.name, now: money(r.now), last: money(r.last) })}>
              <div className="cat-row">
                <span>{r.icon} {r.name}</span>
                <span className="num">
                  {money(r.now)} <small className="muted">{t('vs {amount}', { amount: money(r.last, undefined, { compact: true }) })}</small>
                  {delta != null && <small className={`delta ${delta > 0 ? 'bad' : 'good'}`}> {delta > 0 ? '▲' : '▼'} {pct(Math.abs(delta), false)}</small>}
                  {delta == null && r.now > 0 && <small className="delta muted"> {t('new')}</small>}
                </span>
              </div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.now / max) * 100}%`, background: r.color }} /></div>
              <div className="bar-track thin"><div className="bar-fill" style={{ width: `${(r.last / max) * 100}%`, background: p.muted }} /></div>
            </li>
          );
        })}
      </ul>
      {rows.length > 6 && (
        <button className="btn ghost show-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? t('Show less') : tn('Show all {n} category', 'Show all {n} categories', rows.length)}
        </button>
      )}
      <div className="legend">
        <span><i className="sq" style={{ background: p.s1 }} />{t('This month (category colour)')}</span>
        <span><i style={{ background: p.muted }} />{t('Last month (full)')}</span>
      </div>
      {partial && <p className="muted small">{t('This month is still running: day {d} of {n}.', { d: s.daysElapsed, n: s.daysInMonth })}</p>}
    </Card>
  );
}
