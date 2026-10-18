import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Transaction } from '../api';
import { Card, ChartTip, ErrorBox, MonthPicker } from '../components';
import { axisProps, usePalette } from '../palette';
import { t } from '../i18n';
import { useSession } from '../session-context';
import { amountPlaceholder, currentMonth, money, monthLabel, num, parseAmount, sharePct, short, trackerIcon, useData } from '../util';

type ItemKind = 'earning' | 'cost';
interface Item { kind: ItemKind; name: string; amount: number }
interface SalaryMonth {
  month: string;
  saved: boolean;
  items: Item[];
  earnings: number;
  costs: number;
  net: number;
  tracker_id: number | null;
  use_as_budget: boolean;
  posted: { transaction_id: number; tracker_id: number; amount: number } | null;
  suggestion?: { from: string; items: Item[]; tracker_id: number | null; use_as_budget: boolean };
}
interface Row { key: number; kind: ItemKind; name: string; amount: string }

const SUGGESTED: Record<ItemKind, string[]> = {
  earning: ['Base salary', 'Bonus', 'Overtime', 'Allowance'],
  cost: ['Commute', 'Fuel', 'Parking', 'Work equipment', 'Meals at work', 'Childcare'],
};
let nextKey = 1;
const toRows = (items: Item[]): Row[] => items.map((i) => ({ key: nextKey++, kind: i.kind, name: i.name, amount: num(i.amount) }));

export default function Salary() {
  const p = usePalette();
  const { trackers, active, refresh } = useSession();
  const [month, setMonth] = useState(currentMonth());
  const { data, error, reload } = useData(() => api.get<SalaryMonth>(`/salary/${month}`), [month]);
  const year = useData(() => api.get<{ month: string; earnings: number; costs: number; net: number; saved: boolean }[]>(`/salary?to=${month}`), [month]);

  const [rows, setRows] = useState<Row[]>([]);
  const [trackerId, setTrackerId] = useState<number | null>(active.id);
  const [useAsBudget, setUseAsBudget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // messages belong to the month being edited
  const [messagesFor, setMessagesFor] = useState(month);
  if (messagesFor !== month) {
    setMessagesFor(month);
    setSaveError(null);
    setNotice(null);
  }

  // other income already in the target tracker this month (e.g. salary typed in by hand) -> warn about counting twice
  const others = useData(
    () => (trackerId ? api.get<Transaction[]>(`/trackers/${trackerId}/transactions?month=${month}&kind=income`) : Promise.resolve([] as Transaction[])),
    [trackerId, month, data],
  );
  const otherIncome = (others.data ?? []).filter((x) => x.id !== data?.posted?.transaction_id);

  // load the month into the editor (whenever new data arrives or, for an unsaved month, the active tracker changes)
  const [loadedFor, setLoadedFor] = useState<{ data: SalaryMonth; activeId: number } | null>(null);
  if (data && (loadedFor?.data !== data || loadedFor.activeId !== active.id)) {
    setLoadedFor({ data, activeId: active.id });
    if (data.saved) {
      setRows(toRows(data.items));
      setTrackerId(data.tracker_id);
      setUseAsBudget(data.use_as_budget);
    } else {
      setRows([{ key: nextKey++, kind: 'earning', name: t('Base salary'), amount: '' }]);
      setTrackerId(data.suggestion?.tracker_id ?? active.id);
      setUseAsBudget(data.suggestion?.use_as_budget ?? false);
    }
  }

  const parsed = rows.map((r) => ({ ...r, value: r.amount.trim() ? parseAmount(r.amount) : 0 }));
  const invalid = parsed.some((r) => Number.isNaN(r.value) || r.value < 0);
  const earnings = parsed.filter((r) => r.kind === 'earning').reduce((a, r) => a + (r.value || 0), 0);
  const costs = parsed.filter((r) => r.kind === 'cost').reduce((a, r) => a + (r.value || 0), 0);
  const net = Math.round((earnings - costs) * 100) / 100;
  const target = trackers.find((x) => x.id === trackerId);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (kind: ItemKind, name = '') => setRows((rs) => [...rs, { key: nextKey++, kind, name, amount: '' }]);
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  function copySuggestion() {
    if (!data?.suggestion) return;
    setRows(toRows(data.suggestion.items));
    setTrackerId(data.suggestion.tracker_id ?? active.id);
    setUseAsBudget(data.suggestion.use_as_budget);
  }

  async function save() {
    setBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      const items = parsed.map((r) => ({ kind: r.kind, name: r.name.trim(), amount: r.value || 0 }));
      const saved = await api.put<SalaryMonth>(`/salary/${month}`, { items, tracker_id: trackerId, use_as_budget: useAsBudget, note: t('Salary (net)') });
      setNotice(saved.posted && target
        ? t('Saved. {amount} is the income in {tracker} for {month}.', { amount: money(saved.net), tracker: target.name, month: monthLabel(month) })
        : t('Saved.'));
      await Promise.all([reload(), year.reload(), refresh()]);
      window.dispatchEvent(new Event('tx-changed'));
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm(t('Delete the salary for {month} and the income it added?', { month: monthLabel(month) }))) return;
    try {
      await api.del(`/salary/${month}`);
      await Promise.all([reload(), year.reload()]);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  const section = (kind: ItemKind) => (
    <Card title={kind === 'earning' ? t('Earnings') : t('Costs of earning')}
      action={<span className="num muted">{money(kind === 'earning' ? earnings : costs)}</span>}>
      <p className="muted small">
        {kind === 'earning' ? t('Everything you are paid this month: salary, bonuses, overtime…') : t('What you had to spend to earn it: commute, fuel, parking, work equipment…')}
      </p>
      <ul className="salary-rows">
        {rows.filter((r) => r.kind === kind).map((r) => {
          const bad = r.amount.trim() !== '' && (Number.isNaN(parseAmount(r.amount)) || parseAmount(r.amount) < 0);
          return (
            <li key={r.key}>
              <input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder={t('Name')} aria-label={t('Name')} maxLength={60} />
              <input className={`num ${bad ? 'invalid' : ''}`} inputMode="decimal" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })}
                placeholder={amountPlaceholder()} aria-label={t('Amount')} aria-invalid={bad} />
              <button type="button" className="icon-btn" onClick={() => remove(r.key)} aria-label={t('Remove')}>✕</button>
            </li>
          );
        })}
      </ul>
      <div className="chips">
        {SUGGESTED[kind].filter((n) => !rows.some((r) => r.kind === kind && r.name === t(n))).map((n) => (
          <button type="button" key={n} className="chip" onClick={() => add(kind, t(n))}>+ {t(n)}</button>
        ))}
        <button type="button" className="chip" onClick={() => add(kind)}>+ {t('Other…')}</button>
      </div>
    </Card>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('Salary')}</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <ErrorBox error={error} />

      {data && !data.saved && data.suggestion && (
        <div className="warn-box translate-box">
          <span>{t('No salary for {month} yet.', { month: monthLabel(month) })}</span>
          <button className="btn small-btn" onClick={copySuggestion}>{t('Copy from {month}', { month: monthLabel(data.suggestion.from) })}</button>
        </div>
      )}

      {data && (
        <>
          <Card className="hero">
            <div className="salary-sum">
              <div><div className="stat-label">{t('Earnings')}</div><div className="num">{money(earnings)}</div></div>
              <div className="op">−</div>
              <div><div className="stat-label">{t('Costs of earning')}</div><div className="num">{money(costs)}</div></div>
              <div className="op">=</div>
              <div><div className="stat-label">{t('Net income')}</div><div className={`hero-number num ${net < 0 ? 'bad' : ''}`}>{money(net)}</div></div>
            </div>
            {earnings > 0 && <p className="muted small">{t('Costs take {pct} of what you earn.', { pct: sharePct(costs, earnings) })}</p>}
          </Card>

          <div className="grid2">
            {section('earning')}
            {section('cost')}
          </div>

          <Card title={t('Use it in spending')}>
            <label className="inline-label">
              {t('Add the net as income to')}
              <select value={trackerId ?? ''} onChange={(e) => setTrackerId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t('— nowhere (only calculate) —')}</option>
                {trackers.map((x) => <option key={x.id} value={x.id}>{trackerIcon(x)} {x.name}</option>)}
              </select>
            </label>
            {trackerId && (
              <label className="check-row">
                <input type="checkbox" checked={useAsBudget} onChange={(e) => setUseAsBudget(e.target.checked)} />
                <span>{t('Also set it as the money prepared for {month}', { month: monthLabel(month) })}</span>
              </label>
            )}
            {net <= 0 && trackerId && <p className="muted small">{t('Nothing is added while the net is 0 or below.')}</p>}
            {otherIncome.length > 0 && (
              <div className="warn-box">
                ⚠ {t('{tracker} already has other income in {month}: {list}. If that is this salary entered by hand, delete it in History so it is not counted twice.', {
                  tracker: target?.name ?? '',
                  month: monthLabel(month),
                  list: otherIncome.map((x) => `${x.note || x.category_name || t('Income')} ${money(x.amount)}`).join(', '),
                })}
              </div>
            )}
            {data.saved && data.posted && (
              <p className="muted small">
                ✓ {t('Currently added: {amount} in {tracker}.', { amount: money(data.posted.amount), tracker: trackers.find((x) => x.id === data.posted!.tracker_id)?.name ?? '' })}{' '}
                <Link to={`/transactions?month=${month}`} className="link">{t('See in History')} →</Link>
              </p>
            )}
            <ErrorBox error={invalid ? t('Some amounts are not valid numbers.') : saveError} />
            {notice && <div className="ok-box">✓ {notice}</div>}
            <div className="form-actions">
              {data.saved && <button className="btn danger" onClick={clear}>{t('Delete')}</button>}
              <button className="btn primary" onClick={save} disabled={busy || invalid}>
                {trackerId && net > 0 ? t('Save and add {amount} as income', { amount: money(net) }) : t('Save')}
              </button>
            </div>
          </Card>

          {year.data?.some((m) => m.saved) && (
            <Card title={t('Last 12 months')}>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={year.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={p.grid} vertical={false} />
                  <XAxis dataKey="month" {...axisProps(p)} tickFormatter={(m) => monthLabel(m, true)} />
                  <YAxis {...axisProps(p)} width="auto" tickFormatter={short} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v) => money(v)} labelFmt={(m) => monthLabel(String(m))} />} cursor={{ fill: p.grid, opacity: 0.4 }} />
                  <Bar name={t('Earnings')} dataKey="earnings" fill={p.s3} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  <Bar name={t('Costs of earning')} dataKey="costs" fill={p.s2} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  <Line name={t('Net income')} dataKey="net" stroke={p.s1} strokeWidth={2} dot={{ r: 3, fill: p.s1 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="legend">
                <span><i className="sq" style={{ background: p.s3 }} />{t('Earnings')}</span>
                <span><i className="sq" style={{ background: p.s2 }} />{t('Costs of earning')}</span>
                <span><i style={{ background: p.s1 }} />{t('Net income')}</span>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
