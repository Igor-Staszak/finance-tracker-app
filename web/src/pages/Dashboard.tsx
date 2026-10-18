import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type MonthStats } from '../api';
import { Card, ChartTip, ErrorBox, Modal, MonthPicker, Stat, TrackerSwitcher } from '../components';
import { axisProps, usePalette, type Palette } from '../palette';
import { useSession } from '../session-context';
import { pendingSpendDelta, readOutbox, useOffline } from '../offline';
import { CategoryDonut, CategoryVsLastMonth, CategoryWeekly } from '../CategoryCharts';
import { seriesColor } from '../theme';
import { amountPlaceholder, currentMonth, dateLabel, money, monthLabel, num, parseAmount, pct, sharePct, shiftMonth, short, useData, useTxChanged } from '../util';
import { t, tn } from '../i18n';

interface Overview { base: string; investments: number; savings: number; netWorth: number }

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [editBudget, setEditBudget] = useState(false);
  const p = usePalette();
  const { tp, active } = useSession();
  const shared = active.members.length > 1;
  const { data: raw, error, reload } = useData(() => api.get<MonthStats>(`${tp}/stats/month/${month}`), [tp, month]);
  useOffline(); // re-render when the outbox changes
  const pending = pendingSpendDelta(tp, month);
  const s = raw && localize(withPending(raw, pending.delta, pendingBudget(tp, month)));
  const { data: ov } = useData(() => api.get<Overview>('/overview'), []);
  useTxChanged(useCallback(() => { reload(); }, [reload]));

  const fmt = (v: number) => money(v);
  const hasData = !!s && (s.txCount > 0 || s.income > 0 || s.trend.some((m) => m.spent > 0 || m.income > 0));
  const fmtC = short;

  return (
    <div className="page">
      <div className="page-head">
        <div className="title-row">
          <h1>{t('Spending')}</h1>
          <TrackerSwitcher />
        </div>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <ErrorBox error={error} />

      {s && (
        <>
          <BudgetHero s={s} onEdit={() => setEditBudget(true)} />
          {pending.count > 0 && (
            <div className="warn-box">⏳ {tn('Totals include {n} unsynced change. Charts update after you sync.', 'Totals include {n} unsynced changes. Charts update after you sync.', pending.count)}</div>
          )}

          <div className="stats">
            <Stat label={t('Spent')} value={fmt(s.spent)}
              sub={s.vsPrevPct != null
                ? t('{pct} vs {month}', { pct: pct(s.vsPrevPct), month: `${monthLabel(shiftMonth(month, -1), true)}${s.daysElapsed < s.daysInMonth ? `\u00a01\u2060–\u2060${s.daysElapsed}` : ''}` })
                : tn('{n} expense', '{n} expenses', s.txCount)}
              tone={s.vsPrevPct != null ? (s.vsPrevPct > 0 ? 'bad' : 'good') : undefined} />
            <Stat label={t('Safe to spend / day')} value={s.safeDaily != null ? fmt(s.safeDaily) : '—'}
              sub={s.daysLeft > 0 ? tn('{n} day left', '{n} days left', s.daysLeft) : t('month closed')} />
            <Stat label={t('Average / day')} value={fmt(s.avgPerDay)} sub={tn('over {n} day', 'over {n} days', s.daysElapsed)} />
            <Stat label={t('Projected month end')} value={s.projected != null ? fmt(s.projected) : '—'}
              sub={s.budget != null && s.projected != null
                ? (s.projected > s.budget ? t('{amount} over budget', { amount: fmt(s.projected - s.budget) }) : t('{amount} under budget', { amount: fmt(s.budget - s.projected) }))
                : undefined}
              tone={s.budget != null && s.projected != null ? (s.projected > s.budget ? 'bad' : 'good') : undefined} />
            <Stat label={t('Income')} value={fmt(s.income)}
              sub={s.income > 0 ? (s.income >= s.spent ? t('saved {amount}', { amount: fmt(s.income - s.spent) }) : t('deficit {amount}', { amount: fmt(s.spent - s.income) })) : undefined}
              tone={s.income > 0 && s.income < s.spent ? 'bad' : undefined} />
          </div>

          {!hasData && (
            <Card className="empty-page">
              <div className="empty-icon" aria-hidden>🧾</div>
              <h2>{t('No expenses in {month} yet', { month: monthLabel(month) })}</h2>
              <p className="muted">{t('Tap + to add your first expense. Charts and statistics appear here once there is something to show.')}</p>
            </Card>
          )}
          {hasData && (
            <>
          <div className="grid2">
            <Card title={t('Spending vs budget pace')}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={s.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={p.grid} vertical={false} />
                  <XAxis dataKey="day" {...axisProps(p)} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis {...axisProps(p)} width="auto" tickFormatter={fmtC} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={fmt} labelFmt={(d) => t('Day {d}', { d })} />} cursor={{ stroke: p.axis }} />
                  {s.budget != null && <ReferenceLine y={s.budget} stroke={p.critical} strokeDasharray="4 4" />}
                  <Line name={t('Even budget pace')} dataKey="pace" stroke={p.muted} strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name={t('Spent so far')} dataKey="cumulative" stroke={p.s1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="legend">
                <span><i style={{ background: p.s1 }} />{t('Spent so far')}</span>
                <span><i className="dashed" style={{ borderColor: p.muted }} />{t('Even budget pace')}</span>
                {s.budget != null && <span><i className="dashed" style={{ borderColor: p.critical }} />{t('Budget')}</span>}
              </div>
            </Card>

            <CategoryDonut s={s} p={p} />
          </div>

          <div className="grid2">
            <CategoryWeekly s={s} p={p} />
            <CategoryVsLastMonth s={s} p={p} />
          </div>

          {shared && <MemberSplit s={s} p={p} />}

          {s.byCategory.some((c) => c.monthly_limit != null) && (
            <Card title={t('Category limits')} action={<Link to="/settings" className="link">{t('Edit limits')} →</Link>}>
              <CategoryBars s={s} p={p} />
            </Card>
          )}

          <div className="grid2">
            <Card title={t('Last 6 months')}>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={s.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={p.grid} vertical={false} />
                  <XAxis dataKey="month" {...axisProps(p)} tickFormatter={(m) => monthLabel(m, true)} />
                  <YAxis {...axisProps(p)} width="auto" tickFormatter={fmtC} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={fmt} labelFmt={(m) => monthLabel(String(m))} />} cursor={{ fill: p.grid, opacity: 0.4 }} />
                  <Bar name={t('Spent')} dataKey="spent" fill={p.s1} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Bar name={t('Income')} dataKey="income" fill={p.s3} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Line name={t('Budget')} dataKey="budget" stroke={p.s2} strokeWidth={2} dot={{ r: 4, fill: p.s2, stroke: p.surface, strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="legend">
                <span><i style={{ background: p.s1 }} />{t('Spent')}</span>
                <span><i style={{ background: p.s3 }} />{t('Income')}</span>
                <span><i style={{ background: p.s2 }} />{t('Budget')}</span>
              </div>
            </Card>

            <Card title={t('Daily spending')}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={s.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={p.grid} vertical={false} />
                  <XAxis dataKey="day" {...axisProps(p)} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis {...axisProps(p)} width="auto" tickFormatter={fmtC} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={fmt} labelFmt={(d) => t('Day {d}', { d })} />} cursor={{ fill: p.grid, opacity: 0.4 }} />
                  {s.budget != null && <ReferenceLine y={s.budget / s.daysInMonth} stroke={p.muted} strokeDasharray="4 4" />}
                  <Bar name={t('Spent')} dataKey="spent" fill={p.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <div className="legend">
                <span><i style={{ background: p.s1 }} />{t('Spent')}</span>
                {s.budget != null && <span><i className="dashed" style={{ borderColor: p.muted }} />{t('Daily budget')}</span>}
              </div>
            </Card>
          </div>

            </>
          )}
          <div className="grid2">
            {s.biggest.length > 0 && <Card title={t('Biggest expenses')}>
              {(
                <ul className="list">
                  {s.biggest.map((x) => (
                    <li key={x.id}>
                      <span className="list-icon">{x.category_icon ?? '•'}</span>
                      <span className="grow">
                        <b>{x.note || x.category_name || t('Expense')}</b>
                        <small>{x.category_name ?? t('Uncategorized')} · {dateLabel(x.date)}{shared && x.created_by_name ? ` · ${x.created_by_name}` : ''}</small>
                      </span>
                      <b className="num">{fmt(x.amount)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </Card>}
            {ov && (
              <Card title={t('Net worth')}>
                <div className="hero-number">{money(ov.netWorth, ov.base)}</div>
                <ul className="list">
                  <li><span className="list-icon">🐷</span><Link className="grow" to="/piggy">{t('Piggybank')}</Link><b className="num">{money(ov.savings, ov.base)}</b></li>
                  <li><span className="list-icon">📈</span><Link className="grow" to="/investments">{t('Investments')}</Link><b className="num">{money(ov.investments, ov.base)}</b></li>
                </ul>
              </Card>
            )}
          </div>
        </>
      )}

      {editBudget && s && (
        <BudgetModal tp={tp} month={month} current={s.budget} onClose={() => setEditBudget(false)} onSaved={() => { setEditBudget(false); reload(); }} />
      )}
    </div>
  );
}

function BudgetHero({ s, onEdit }: { s: MonthStats; onEdit: () => void }) {
  if (s.budget == null) {
    return (
      <Card className="hero">
        <div className="hero-empty">
          <div>
            <div className="stat-label">{t('Money prepared for {month}', { month: monthLabel(s.month) })}</div>
            <p className="muted">{t("Not set yet. Set it to see what's left and how much you can spend per day.")}</p>
          </div>
          <button className="btn primary" onClick={onEdit}>{t('Set budget')}</button>
        </div>
      </Card>
    );
  }
  const used = Math.min(100, (s.spent / Math.max(s.budget, 0.01)) * 100);
  const expected = s.daysInMonth ? (s.daysElapsed / s.daysInMonth) * 100 : 0;
  const over = (s.remaining ?? 0) < 0;
  const ahead = used > expected + 0.5;
  return (
    <Card className="hero">
      <div className="hero-top">
        <div>
          <div className="stat-label">{over ? t('Over budget by') : t('Left this month')}</div>
          <div className={`hero-number ${over ? 'bad' : ''}`}>{money(Math.abs(s.remaining ?? 0))}</div>
          <div className="muted">{t('of {amount} prepared · {pct}% used', { amount: money(s.budget), pct: num(Math.round(s.usedPct ?? 0)) })}</div>
        </div>
        <button className="btn" onClick={onEdit}>{t('Edit budget')}</button>
      </div>
      <div className="progress" role="img" aria-label={t('{used}% of budget used, {elapsed}% of month elapsed', { used: used.toFixed(0), elapsed: expected.toFixed(0) })}>
        <div className={`progress-fill ${over ? 'bad' : ahead ? 'warn' : ''}`} style={{ width: `${used}%` }} />
        {s.daysElapsed > 0 && s.daysElapsed < s.daysInMonth && <div className="progress-marker" style={{ left: `${expected}%` }} title={t("Where you'd be at an even pace")} />}
      </div>
      <div className="progress-caption muted">
        {s.daysElapsed > 0 && s.daysElapsed < s.daysInMonth
          ? (ahead ? `⚠ ${t('Spending faster than an even pace')}` : `✓ ${t('On or under an even pace')}`) + ` · ${t('day {d} of {n}', { d: s.daysElapsed, n: s.daysInMonth })}`
          : tn('{n} day', '{n} days', s.daysInMonth)}
      </div>
    </Card>
  );
}

function CategoryBars({ s, p }: { s: MonthStats; p: Palette }) {
  if (s.byCategory.length === 0) return <p className="muted">{t('No expenses yet this month.')}</p>;
  const max = Math.max(...s.byCategory.map((c) => Math.max(c.total, c.monthly_limit ?? 0)));
  return (
    <ul className="cat-bars">
      {s.byCategory.map((c) => {
        const overLimit = c.monthly_limit != null && c.total > c.monthly_limit;
        return (
          <li key={c.id ?? 'none'} title={`${c.name}: ${money(c.total)} · ${tn('{n} expense', '{n} expenses', c.count)}${c.monthly_limit != null ? ` · ${t('limit {amount}', { amount: money(c.monthly_limit) })}` : ''}`}>
            <div className="cat-row">
              <span>{c.icon} {c.name}</span>
              <span className="num">
                {money(c.total)}
                {c.monthly_limit != null && <small className={overLimit ? 'bad' : 'muted'}> / {money(c.monthly_limit, undefined, { compact: true })}{overLimit ? ' ⚠' : ''}</small>}
                <small className="muted"> · {sharePct(c.total, s.spent)}</small>
              </span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(c.total / max) * 100}%`, background: seriesColor(c.color, p.theme) }} />
              {c.monthly_limit != null && <div className="bar-limit" style={{ left: `${(c.monthly_limit / max) * 100}%` }} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function BudgetModal({ tp, month, current, onClose, onSaved }: { tp: string; month: string; current: number | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(current != null ? String(current) : '');
  const [error, setError] = useState<string | null>(null);

  async function copyPrev() {
    const prev = await api.get<{ amount: number | null }>(`${tp}/budgets/${shiftMonth(month, -1)}`);
    if (prev.amount != null) setAmount(String(prev.amount));
    else setError(t('No budget set for the previous month'));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put(`${tp}/budgets/${month}`, { amount: parseAmount(amount) },
        { offline: { label: `${t('Budget for {month}', { month: monthLabel(month) })}: ${amount}` } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={t('Budget for {month}', { month: monthLabel(month) })} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>
          {t('Money prepared for this month')}
          <input className="big-input" inputMode="decimal" autoFocus required value={amount} placeholder={amountPlaceholder()} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="button" className="btn ghost" onClick={copyPrev}>{t('Copy from previous month')}</button>
        <ErrorBox error={error} />
        <div className="form-actions"><button className="btn primary">{t('Save')}</button></div>
      </form>
    </Modal>
  );
}

/** Who spent what in a shared tracker, plus each person's share of the total. */
function MemberSplit({ s, p }: { s: MonthStats; p: Palette }) {
  const { active } = useSession();
  // include members with no expenses yet, so everyone is listed
  const rows = [
    ...s.byMember,
    ...active.members.filter((m) => !s.byMember.some((b) => b.id === m.id)).map((m) => ({ id: m.id, name: m.name, total: 0, count: 0 })),
  ];
  const max = Math.max(1, ...rows.map((r) => r.total));
  const fair = s.spent / Math.max(1, active.members.length);
  return (
    <Card title={t('Who spent what')}>
      <ul className="cat-bars">
        {rows.map((r) => (
          <li key={r.id ?? 'gone'}>
            <div className="cat-row">
              <span>{r.name}</span>
              <span className="num">{money(r.total)} <small className="muted">· {tn('{n} expense', '{n} expenses', r.count)} · {sharePct(r.total, s.spent)}</small></span>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.total / max) * 100}%`, background: p.s1 }} /></div>
          </li>
        ))}
      </ul>
      {active.members.length > 1 && s.spent > 0 && (
        <p className="muted small">{t('An even split would be {amount} per person.', { amount: money(fair) })}</p>
      )}
    </Card>
  );
}

/** Budget set offline for this tracker/month (not synced yet), if any. */
function pendingBudget(tp: string, month: string): number | undefined {
  const e = readOutbox().find((x) => x.url === `${tp}/budgets/${month}` && x.method === 'PUT');
  return e ? Number(e.body?.amount) : undefined;
}

/** Recompute the headline numbers with unsynced changes applied. */
function withPending(s: MonthStats, delta: number, budget: number | undefined): MonthStats {
  if (delta === 0 && budget === undefined) return s;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const b = budget ?? s.budget;
  const spent = r2(s.spent + delta);
  const remaining = b != null ? r2(b - spent) : null;
  const avgPerDay = s.daysElapsed > 0 ? r2(spent / s.daysElapsed) : 0;
  return {
    ...s,
    budget: b,
    spent,
    remaining,
    usedPct: b ? r2((spent / b) * 100) : null,
    avgPerDay,
    projected: s.daysElapsed > 0 ? r2(avgPerDay * s.daysInMonth) : null,
    safeDaily: remaining != null && s.daysLeft > 0 ? r2(Math.max(0, remaining) / s.daysLeft) : null,
    daily: s.daily.map((d) => ({ ...d, pace: b != null ? r2((b / s.daysInMonth) * d.day) : null })),
  };
}

/** Names the server fills in for missing rows ("Uncategorized", "Former member") in the user's language. */
function localize(s: MonthStats): MonthStats {
  const cat = <T extends { id: number | null; name: string }>(c: T): T => (c.id == null ? { ...c, name: t('Uncategorized') } : c);
  return {
    ...s,
    byCategory: s.byCategory.map(cat),
    prevByCategory: s.prevByCategory.map(cat),
    byMember: s.byMember.map((m) => (m.id == null ? { ...m, name: t('Former member') } : m)),
  };
}
