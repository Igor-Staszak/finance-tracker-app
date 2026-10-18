import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, type Category, type Kind, type Transaction } from './api';
import { amountPlaceholder, emitTxChanged, monthLabel, parseAmount, shiftMonth, today, trackerIcon } from './util';
import { useSession } from './session-context';
import { t } from './i18n';

/** Tooltip body used by all Recharts charts. */
export function ChartTip({ active, payload, label, fmt, labelFmt }: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  label?: string | number;
  fmt: (v: number) => string;
  labelFmt?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <div className="tip-label">{labelFmt ? labelFmt(label ?? '') : label}</div>
      {payload.filter((x) => x.value != null).map((x) => (
        <div key={x.dataKey ?? x.name} className="tip-row">
          <span className="swatch" style={{ background: x.color }} />
          <span>{x.name}</span>
          <b>{fmt(x.value as number)}</b>
        </div>
      ))}
    </div>
  );
}

// ---------- layout bits ----------
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub != null && <div className={`stat-sub ${tone ?? ''}`}>{sub}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-picker">
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, -1))} aria-label={t('Previous month')}>‹</button>
      <span>{monthLabel(month)}</span>
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, 1))} aria-label={t('Next month')}>›</button>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // rendered into <body> so no parent's stacking context (e.g. the sticky sync bar) can put it under the + button
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}


// ---------- add / edit transaction ----------
export function TxForm({ tx, onDone }: { tx?: Transaction; onDone: () => void }) {
  const { trackers, active } = useSession();
  // new entries can go to any tracker; edits stay in the tracker being viewed
  const [trackerId, setTrackerId] = useState(active.id);
  const tp = `/trackers/${trackerId}`;
  const [cats, setCats] = useState<Category[]>([]);
  const [kind, setKind] = useState<Kind>(tx?.kind ?? 'expense');
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [date, setDate] = useState(tx?.date ?? today());
  const [categoryId, setCategoryId] = useState<number | null>(tx?.category_id ?? null);
  const [note, setNote] = useState(tx?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Category[]>(`${tp}/categories`).then((c) => setCats(c.filter((x) => !x.archived)));
  }, [tp]);

  function pickTracker(id: number) {
    setTrackerId(id);
    setCategoryId(null); // categories belong to a tracker
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { kind, amount: parseAmount(amount), date, category_id: categoryId, note };
      if (!(body.amount > 0)) throw new Error(t('Amount must be a positive number'));
      const catName = cats.find((c) => c.id === categoryId)?.name;
      const label = `${kind === 'income' ? t('Income') : t('Expense')} ${body.amount.toFixed(2)}${catName ? ` · ${catName}` : ''}${note ? ` · ${note}` : ''}`;
      const before = tx ? { amount: tx.amount, date: tx.date, kind: tx.kind } : undefined;
      if (tx) await api.put(`${tp}/transactions/${tx.id}`, body, { offline: { label: `${t('Edit')}: ${label}`, before } });
      else await api.post(`${tp}/transactions`, body, { offline: { label } });
      emitTxChanged();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!tx || !confirm(t('Delete this transaction?'))) return;
    try {
      await api.del(`${tp}/transactions/${tx.id}`, {
        offline: { label: `${t('Delete')}: ${tx.note || tx.category_name || t('entry')} ${tx.amount.toFixed(2)}`, before: { amount: tx.amount, date: tx.date, kind: tx.kind } },
      });
    } catch (err) {
      return setError((err as Error).message);
    }
    emitTxChanged();
    onDone();
  }

  return (
    <form onSubmit={save} className="form">
      {!tx && trackers.length > 1 && (
        <div className="chips" role="radiogroup" aria-label={t('Tracker')}>
          {trackers.map((x) => (
            <button type="button" role="radio" aria-checked={x.id === trackerId} key={x.id}
              className={`chip ${x.id === trackerId ? 'on' : ''}`} onClick={() => pickTracker(x.id)}>
              {trackerIcon(x)} {x.name}
            </button>
          ))}
        </div>
      )}
      <div className="segmented">
        <button type="button" className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>{t('Expense')}</button>
        <button type="button" className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>{t('Income')}</button>
      </div>
      <label>
        {t('Amount')}
        <input className="big-input" inputMode="decimal" autoFocus required value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder={amountPlaceholder()} />
      </label>
      <div className="chips">
        {cats.map((c) => (
          <button type="button" key={c.id} className={`chip ${categoryId === c.id ? 'on' : ''}`}
            style={categoryId === c.id ? { borderColor: c.color, boxShadow: `inset 0 0 0 1px ${c.color}` } : undefined}
            onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
            <span>{c.icon}</span> {c.name}
          </button>
        ))}
      </div>
      <div className="row2">
        <label>{t('Date')}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t('Note')}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('optional')} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="form-actions">
        {tx && <button type="button" className="btn danger" onClick={remove}>{t('Delete')}</button>}
        <button className="btn primary" disabled={busy}>{tx ? t('Save') : t('Add')}</button>
      </div>
    </form>
  );
}

/** Dropdown to switch the tracker shown on the Spending and History pages. */
export function TrackerSwitcher() {
  const { trackers, active, setActive } = useSession();
  if (trackers.length < 2) return null;
  return (
    <label className="tracker-switch" title={t('Switch tracker')}>
      <span aria-hidden>{trackerIcon(active)}</span>
      <select value={active.id} onChange={(e) => setActive(Number(e.target.value))} aria-label={t('Tracker')}>
        {trackers.map((x) => <option key={x.id} value={x.id}>{x.name}{x.members.length > 1 ? ` (${t('shared, {n}', { n: x.members.length })})` : ''}</option>)}
      </select>
    </label>
  );
}
