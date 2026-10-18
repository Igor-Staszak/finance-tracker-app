import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Holding, type Portfolio, type SymbolHit } from '../api';
import { Card, ChartTip, ErrorBox, Modal, Stat } from '../components';
import { axisProps, usePalette } from '../palette';
import { money, num, parseDecimal, pct, sharePct, short, useData } from '../util';
import { locale, t } from '../i18n';

export default function Investments() {
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Holding | 'new' | null>(null);
  const p = usePalette();
  const { data, error, reload, setData } = useData(() => api.get<Portfolio>('/portfolio'), []);

  async function refresh() {
    setRefreshing(true);
    try { setData(await api.get<Portfolio>('/portfolio?refresh=1')); } finally { setRefreshing(false); }
  }

  const base = data?.base ?? 'PLN';
  const fmt = (v: number) => money(v, base);
  const tot = data?.totals;
  const sorted = [...(data?.holdings ?? [])].sort((a, b) => (b.valueBase ?? 0) - (a.valueBase ?? 0));
  const maxVal = Math.max(1, ...sorted.map((h) => h.valueBase ?? 0));
  const lastFetch = Math.max(0, ...(data?.holdings ?? []).map((h) => h.fetched_at ?? 0));

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('Investments')}</h1>
        <div className="head-actions">
          <button className="btn" onClick={refresh} disabled={refreshing}>{refreshing ? t('Refreshing…') : `↻ ${t('Refresh prices')}`}</button>
          <button className="btn primary" onClick={() => setEditing('new')}>+ {t('Add position')}</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {data?.errors.map((e) => <div key={e} className="warn-box">Price issue: {e}. Showing last known price.</div>)}

      {tot && (
        <div className="stats">
          <Stat label={t('Portfolio value')} value={fmt(tot.value)} sub={lastFetch ? t('prices as of {time}', { time: new Date(lastFetch).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : undefined} />
          <Stat label={t('Invested')} value={fmt(tot.cost)} />
          <Stat label={t('Profit / loss')} value={money(tot.pl, base, { sign: true })} sub={pct(tot.plPct)} tone={tot.pl >= 0 ? 'good' : 'bad'} />
          <Stat label={t('Today')} value={money(tot.dayChange, base, { sign: true })} tone={tot.dayChange >= 0 ? 'good' : 'bad'}
            sub={tot.value ? pct((tot.dayChange / (tot.value - tot.dayChange)) * 100) : undefined} />
        </div>
      )}

      {data && data.holdings.length === 0 && (
        <Card>
          <p><b>{t('No positions yet.')}</b> {t('Add what you hold: ticker, quantity and average purchase price.')}</p>
          <p className="muted">{t('Tickers like {examples} are converted to market symbols automatically. Prices come from Yahoo Finance and refresh every 15 minutes.', { examples: 'PKN.PL, AAPL.US, VWCE.DE, CNDX.UK' })}</p>
        </Card>
      )}

      {sorted.length > 0 && (
        <div className="grid2">
          <Card title={t('Allocation')}>
            <ul className="cat-bars">
              {sorted.map((h) => (
                <li key={h.id} title={`${h.name}: ${fmt(h.valueBase ?? 0)}`}>
                  <div className="cat-row">
                    <span>{h.ticker || h.symbol}</span>
                    <span className="num">{fmt(h.valueBase ?? 0)} <small className="muted">· {sharePct(h.valueBase ?? 0, tot?.value ?? 0, 1)}</small></span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${((h.valueBase ?? 0) / maxVal) * 100}%`, background: p.s1 }} /></div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('Value over time')}>
            {(data?.history.length ?? 0) < 2 ? (
              <p className="muted">{t('History builds up automatically: one point per day you open this page.')}</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data!.history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={p.grid} vertical={false} />
                    <XAxis dataKey="date" {...axisProps(p)} minTickGap={24} tickFormatter={(d) => d.slice(5)} />
                    <YAxis {...axisProps(p)} width="auto" axisLine={false} domain={['auto', 'auto']} tickFormatter={short} />
                    <Tooltip content={<ChartTip fmt={fmt} />} cursor={{ stroke: p.axis }} />
                    <Line name={t('Value')} dataKey="value" stroke={p.s1} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line name={t('Invested')} dataKey="cost" stroke={p.muted} strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="legend">
                  <span><i style={{ background: p.s1 }} />{t('Value')}</span>
                  <span><i className="dashed" style={{ borderColor: p.muted }} />{t('Invested')}</span>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {sorted.length > 0 && (
        <Card title={t('Positions')}>
          <table className="table">
            <thead>
              <tr><th>{t('Instrument')}</th><th className="r">{t('Qty')}</th><th className="r">{t('Avg / Now')}</th><th className="r">{t('Value')}</th><th className="r">{t('P/L')}</th><th className="r">{t('Today')}</th></tr>
            </thead>
            <tbody>
              {sorted.map((h) => (
                <tr key={h.id} onClick={() => setEditing(h)} className="clickable">
                  <td data-label={t('Instrument')}><b>{h.ticker || h.symbol}</b><small className="muted block">{h.name}</small></td>
                  <td data-label={t('Qty')} className="r num">{num(h.quantity, 8)}</td>
                  <td data-label={t('Avg / Now')} className="r num">{money(h.avg_price, h.currency)}<small className="muted block">{money(h.price, h.currency)}{h.stale ? ` (${t('stale')})` : ''}</small></td>
                  <td data-label={t('Value')} className="r num">{fmt(h.valueBase ?? 0)}{h.currency !== base && <small className="muted block">{money(h.value, h.currency)}</small>}</td>
                  <td data-label={t('P/L')} className={`r num ${(h.plBase ?? 0) >= 0 ? 'good' : 'bad'}`}>{money(h.plBase, base, { sign: true })}<small className="block">{pct(h.plPct)}</small></td>
                  <td data-label={t('Today')} className={`r num ${(h.dayChangePct ?? 0) >= 0 ? 'good' : 'bad'}`}>{pct(h.dayChangePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="muted small">
        {t('Positions are entered manually. After buying or selling, update the quantity and average price here (your broker shows both in your list of open positions).')}
      </p>

      {editing && (
        <Modal title={editing === 'new' ? t('Add position') : t('Edit {name}', { name: editing.ticker || editing.symbol })} onClose={() => setEditing(null)}>
          <HoldingForm holding={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); reload(); }} />
        </Modal>
      )}
    </div>
  );
}

function HoldingForm({ holding, onDone }: { holding?: Holding; onDone: () => void }) {
  const [query, setQuery] = useState(holding?.ticker || holding?.symbol || '');
  const [symbol, setSymbol] = useState(holding?.symbol ?? '');
  const [name, setName] = useState(holding?.name ?? '');
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [quantity, setQuantity] = useState(holding ? String(holding.quantity) : '');
  const [avg, setAvg] = useState(holding ? String(holding.avg_price) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!query.trim() || query === (holding?.ticker || holding?.symbol) || query === symbol) return;
    const timer = setTimeout(() => {
      api.get<SymbolHit[]>(`/symbols/search?q=${encodeURIComponent(query)}`).then(setHits).catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [query, symbol, holding]);

  function pick(h: SymbolHit) {
    setSymbol(h.symbol);
    setName(h.name);
    setQuery(h.symbol);
    setHits([]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const typed = /\.[A-Z]{2}$/i.test(query) && query.toUpperCase() !== symbol ? query.toUpperCase() : holding?.ticker ?? '';
    const body = {
      symbol: symbol || query,
      ticker: typed,
      name,
      quantity: parseDecimal(quantity),
      avg_price: avg.trim() ? parseDecimal(avg) : 0,
    };
    try {
      if (holding) await api.put(`/holdings/${holding.id}`, body);
      else await api.post('/holdings', body);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!holding || !confirm(t('Remove {name} from the portfolio?', { name: holding.symbol }))) return;
    await api.del(`/holdings/${holding.id}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        {t('Ticker or name')}
        <input autoFocus required value={query} placeholder={t('e.g. {examples}', { examples: 'PKN.PL, AAPL.US, VWCE.DE, Orlen' })}
          onChange={(e) => { setQuery(e.target.value); setSymbol(''); }} />
      </label>
      {hits.length > 0 && (
        <ul className="list clickable hits">
          {hits.map((h) => (
            <li key={h.symbol} onClick={() => pick(h)}>
              <span className="grow"><b>{h.symbol}</b><small>{h.name}</small></span>
              <small className="muted">{h.exchange} {h.type}</small>
            </li>
          ))}
        </ul>
      )}
      {symbol && <p className="muted small">{t('Selected:')} <b>{symbol}</b> {name && `— ${name}`}</p>}
      <div className="row2">
        <label>{t('Quantity')}<input inputMode="decimal" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        <label>{t('Avg. purchase price')}<input inputMode="decimal" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder={t('in instrument currency')} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="form-actions">
        {holding && <button type="button" className="btn danger" onClick={remove}>{t('Remove')}</button>}
        <button className="btn primary" disabled={busy}>{busy ? t('Checking price…') : t('Save')}</button>
      </div>
    </form>
  );
}
