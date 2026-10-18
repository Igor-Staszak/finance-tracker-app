import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Category, type Transaction } from '../api';
import { Card, ErrorBox, Modal, MonthPicker, TrackerSwitcher, TxForm } from '../components';
import { useSession } from '../session-context';
import { useOffline, type OutboxEntry } from '../offline';
import { currentMonth, dateLabel, money, useData, useTxChanged } from '../util';
import { seriesColor, useTheme } from '../theme';
import { t, tn } from '../i18n';

export default function Transactions() {
  const [params] = useSearchParams();
  const { tp, active, user } = useSession();
  const shared = active.members.length > 1;
  const [member, setMember] = useState('');
  const [month, setMonth] = useState(params.get('month') || currentMonth());
  const [categoryId, setCategoryId] = useState(params.get('category_id') || '');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const theme = useTheme();

  useEffect(() => { api.get<Category[]>(`${tp}/categories`).then(setCats); }, [tp]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, reload } = useData(() => {
    const params = new URLSearchParams({ month });
    if (categoryId) params.set('category_id', categoryId);
    if (kind) params.set('kind', kind);
    if (debouncedQ) params.set('q', debouncedQ);
    if (member) params.set('member', member);
    return api.get<Transaction[]>(`${tp}/transactions?${params}`);
  }, [tp, month, categoryId, kind, debouncedQ, member]);
  useTxChanged(useCallback(() => { reload(); }, [reload]));

  const { outbox } = useOffline();
  const txs = withPending(data ?? [], outbox, tp, month, cats, user.name);
  const totalOut = txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
  const totalIn = txs.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const byDate = new Map<string, Transaction[]>();
  for (const t of txs) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);

  function exportCsv() {
    const rows = [[t('date'), t('type'), t('amount'), t('category'), t('note'), t('added by')],
      ...txs.map((t) => [t.date, t.kind, t.amount, t.category_name ?? '', t.note, t.created_by_name ?? ''])];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${active.name.toLowerCase().replace(/\W+/g, '-')}-${month}.csv`;
    a.click();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="title-row">
          <h1>{t('Transactions')}</h1>
          <TrackerSwitcher />
        </div>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      <div className="filters">
        <input placeholder={t('Search notes…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t('All categories')}</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('Expenses & income')}</option>
          <option value="expense">{t('Expenses only')}</option>
          <option value="income">{t('Income only')}</option>
        </select>
        {shared && (
          <select value={member} onChange={(e) => setMember(e.target.value)} aria-label={t('Person')}>
            <option value="">{t('Everyone')}</option>
            {active.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <button className="btn ghost" onClick={exportCsv} disabled={!txs.length}>{t('Export CSV')}</button>
      </div>

      <div className="totals-row">
        <span>{t('Out')} <b className="num">{money(totalOut)}</b></span>
        <span>{t('In')} <b className="num good">{money(totalIn)}</b></span>
        <span className="muted">{tn('{n} item', '{n} items', txs.length)}</span>
      </div>

      <ErrorBox error={error} />
      {txs.length === 0 && <Card><p className="muted">{t('Nothing here. Use the + button to add an expense.')}</p></Card>}
      {txs.length > 0 && (
        <Card className="day-list">
          {[...byDate.entries()].map(([date, list]) => {
            const out = list.filter((x) => x.kind === 'expense').reduce((a, x) => a + x.amount, 0);
            return (
              <section key={date}>
                <h3 className="day-head">
                  <span>{dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  {out > 0 && <span className="num muted">−{money(out)}</span>}
                </h3>
          <ul className="list clickable">
            {list.map((x) => (
              <li key={x.id} onClick={() => setEditing(x)} className={x.pending ? 'pending' : ''}>
                <span className="list-icon" style={{ background: seriesColor(x.category_color ?? '#898781', theme) + '2e' }}>{x.category_icon ?? '•'}</span>
                <span className="grow">
                  <b>{x.note || x.category_name || (x.kind === 'income' ? t('Income') : t('Expense'))}</b>
                  <small>{x.pending ? `⏳ ${t('waiting to sync')} · ` : ''}{x.category_name ?? t('Uncategorized')}{shared && x.created_by_name ? ` · ${x.created_by_name}` : ''}</small>
                </span>
                <b className={`num ${x.kind === 'income' ? 'good' : ''}`}>{x.kind === 'income' ? '+' : '−'}{money(x.amount)}</b>
              </li>
            ))}
          </ul>
              </section>
            );
          })}
        </Card>
      )}

      {editing && (
        <Modal title={t('Edit transaction')} onClose={() => setEditing(null)}>
          <TxForm tx={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

/** Overlay changes made offline (not synced yet) on the last saved list. Filters other than month are not applied to them. */
function withPending(list: Transaction[], outbox: OutboxEntry[], tp: string, month: string, cats: Category[], me: string): Transaction[] {
  let out = [...list];
  const decorate = (t: Transaction): Transaction => {
    const c = cats.find((x) => x.id === t.category_id);
    return { ...t, category_name: c?.name, category_icon: c?.icon, category_color: c?.color, pending: true };
  };
  for (const e of outbox) {
    if (!e.url.startsWith(`${tp}/transactions`)) continue;
    const body = (e.body ?? {}) as Partial<Transaction>;
    if (e.method === 'POST') {
      if (body.date?.startsWith(month)) out.push(decorate({ ...(body as Transaction), id: e.tempId!, created_by_name: me }));
      continue;
    }
    const id = Number(e.url.split('/').pop());
    if (e.method === 'DELETE') out = out.filter((t) => t.id !== id);
    else out = out.map((t) => (t.id === id ? decorate({ ...t, ...body, id }) : t)).filter((t) => t.date.startsWith(month));
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}
