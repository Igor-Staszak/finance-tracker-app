import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Piggy, type PiggyAccount, type PiggyType } from '../api';
import { Card, ChartTip, ErrorBox, Modal } from '../components';
import { axisProps, usePalette } from '../palette';
import { amountPlaceholder, money, parseAmount, sharePct, short, useData } from '../util';
import { useOffline, type OutboxEntry } from '../offline';
import { locale, t, tn } from '../i18n';

const TYPE_META: Record<PiggyType, { label: string; icon: string }> = {
  cash: { label: 'Cash', icon: '💵' },
  bank: { label: 'Bank account', icon: '🏦' },
  savings: { label: 'Savings account', icon: '🐷' },
  deposit: { label: 'Term deposit', icon: '🔒' },
  other: { label: 'Other', icon: '📦' },
};

export default function PiggyPage() {
  const p = usePalette();
  const [editing, setEditing] = useState<PiggyAccount | 'new' | null>(null);
  const { data: raw, error, reload } = useData(() => api.get<Piggy>('/piggy'), []);
  const { outbox } = useOffline();
  const data = raw && withPending(raw, outbox);
  const base = data?.base ?? 'PLN';
  const fmt = (v: number) => money(v, base);
  const maxType = Math.max(1, ...(data?.byType ?? []).map((t) => t.total));

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('Piggybank')}</h1>
        <button className="btn primary" onClick={() => setEditing('new')}>+ {t('Add pot')}</button>
      </div>
      <ErrorBox error={error} />

      {data && (
        <>
          <Card className="hero">
            <div className="stat-label">{t('Total saved')}</div>
            <div className="hero-number">{fmt(data.total)}</div>
            <div className="muted">{tn('{n} pot', '{n} pots', data.accounts.length)}</div>
          </Card>

          {data.accounts.length === 0 && (
            <Card><p className="muted">{t('Add your pots: cash in the wallet, bank accounts, savings accounts, deposits… Update the balances whenever you like.')}</p></Card>
          )}

          <div className="grid2">
            <Card title={t('Pots')}>
              <ul className="list">
                {data.accounts.map((a) => (
                  <AccountRow key={a.id} a={a} base={base} onEdit={() => setEditing(a)} onSaved={reload} />
                ))}
              </ul>
            </Card>
            {data.byType.length > 0 && (
              <Card title={t('By type')}>
                <ul className="cat-bars">
                  {data.byType.map((x) => (
                    <li key={x.type}>
                      <div className="cat-row">
                        <span>{TYPE_META[x.type].icon} {t(TYPE_META[x.type].label)}</span>
                        <span className="num">{fmt(x.total)} <small className="muted">· {sharePct(x.total, data.total)}</small></span>
                      </div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(0, (x.total / maxType) * 100)}%`, background: p.s1 }} /></div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {data.history.length >= 2 && (
            <Card title={t('Total over time')}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={p.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps(p)} minTickGap={24} tickFormatter={(d) => d.slice(5)} />
                  <YAxis {...axisProps(p)} width="auto" axisLine={false} domain={['auto', 'auto']} tickFormatter={short} />
                  <Tooltip content={<ChartTip fmt={fmt} />} cursor={{ stroke: p.axis }} />
                  <Line name={t('Total')} dataKey="total" stroke={p.s1} strokeWidth={2} dot={{ r: 4, fill: p.s1, stroke: p.surface, strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}

      {editing && (
        <Modal title={editing === 'new' ? t('Add pot') : t('Edit {name}', { name: editing.name })} onClose={() => setEditing(null)}>
          <AccountForm account={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); reload(); }} />
        </Modal>
      )}
    </div>
  );
}

/** Row with tap-to-edit balance for quick updates. */
/** Show balances changed offline (not synced yet) on top of the last saved copy. */
function withPending(d: Piggy, outbox: OutboxEntry[]): Piggy {
  const pending = new Map<number, number>();
  for (const e of outbox) {
    const m = e.url.match(/^\/piggy\/(\d+)$/);
    if (m && e.method === 'PUT' && e.body?.balance != null) pending.set(Number(m[1]), Number(e.body.balance));
  }
  if (!pending.size) return d;
  let total = d.total;
  const accounts = d.accounts.map((a) => {
    if (!pending.has(a.id)) return a;
    const balance = pending.get(a.id)!;
    const balanceBase = a.fx != null ? Math.round(balance * a.fx * 100) / 100 : a.balanceBase;
    total += (balanceBase ?? 0) - (a.balanceBase ?? 0);
    return { ...a, balance, balanceBase, pending: true };
  });
  const byType = [...new Set(accounts.map((a) => a.type))].map((type) => ({
    type,
    total: Math.round(accounts.filter((a) => a.type === type).reduce((x, a) => x + (a.balanceBase ?? 0), 0) * 100) / 100,
  })).filter((t) => t.total !== 0);
  return { ...d, accounts, byType, total: Math.round(total * 100) / 100 };
}

function AccountRow({ a, base, onEdit, onSaved }: { a: PiggyAccount; base: string; onEdit: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<string | null>(null);

  async function save() {
    if (value == null) return;
    const n = parseAmount(value);
    setValue(null);
    if (Number.isFinite(n) && n !== a.balance) {
      try {
        await api.put(`/piggy/${a.id}`, { balance: n }, { offline: { label: `${a.name}: ${t('balance')} ${n.toFixed(2)}` } });
      } catch (err) {
        alert((err as Error).message);
      }
      onSaved();
    }
  }

  return (
    <li>
      <span className="list-icon">{TYPE_META[a.type].icon}</span>
      <button className="grow plain" onClick={onEdit}>
        <b>{a.name}</b>
        <small>{a.pending ? `⏳ ${t('waiting to sync')}` : `${t(TYPE_META[a.type].label)} · ${t('updated {date}', { date: new Date(a.updated_at + 'Z').toLocaleDateString(locale()) })}`}</small>
      </button>
      {value != null ? (
        <input className="inline-input" autoFocus inputMode="decimal" value={value}
          onChange={(e) => setValue(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setValue(null); }} />
      ) : (
        <button className="plain num r" onClick={() => setValue(String(a.balance))} title={t('Tap to update balance')}>
          <b>{money(a.balance, a.currency)}</b>
          {a.currency !== base && <small className="muted block">{money(a.balanceBase, base)}</small>}
        </button>
      )}
    </li>
  );
}

function AccountForm({ account, onDone }: { account?: PiggyAccount; onDone: () => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<PiggyType>(account?.type ?? 'bank');
  const [currency, setCurrency] = useState(account?.currency ?? 'PLN');
  const [balance, setBalance] = useState(account ? String(account.balance) : '');
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, type, currency, balance: balance.trim() ? parseAmount(balance) : 0 };
    try {
      if (account) await api.put(`/piggy/${account.id}`, body);
      else await api.post('/piggy', body);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    if (!account || !confirm(t('Delete "{name}" and its history?', { name: account.name }))) return;
    await api.del(`/piggy/${account.id}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={save}>
      <label>{t('Name')}<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. {examples}', { examples: 'Wallet, mBank, Revolut EUR' })} /></label>
      <div className="chips">
        {(Object.keys(TYPE_META) as PiggyType[]).map((k) => (
          <button type="button" key={k} className={`chip ${type === k ? 'on' : ''}`} onClick={() => setType(k)}>
            {TYPE_META[k].icon} {t(TYPE_META[k].label)}
          </button>
        ))}
      </div>
      <div className="row2">
        <label>{t('Balance')}<input className="big-input" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder={amountPlaceholder()} /></label>
        <label>{t('Currency')}
          <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} list="ccys" />
          <datalist id="ccys">{['PLN', 'EUR', 'USD', 'GBP', 'CHF'].map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <ErrorBox error={error} />
      <div className="form-actions">
        {account && <button type="button" className="btn danger" onClick={remove}>{t('Delete')}</button>}
        <button className="btn primary">{t('Save')}</button>
      </div>
    </form>
  );
}
