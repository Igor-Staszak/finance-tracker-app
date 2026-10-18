import { useEffect, useState } from 'react';
import { Modal } from './components';
import { discard, syncNow, useOffline, type SyncResult } from './offline';
import { locale, t, tn } from './i18n';

/** Connection status + outbox. Nothing is sent until the user presses "Sync now". */
export default function SyncBar() {
  const { online, outbox, syncing } = useOffline();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [review, setReview] = useState(false);

  // hide the success message after a few seconds; keep errors until dismissed
  useEffect(() => {
    if (!result || result.failed.length || result.stoppedOffline || result.needLogin) return;
    const t = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(t);
  }, [result]);

  async function sync() {
    setResult(null);
    const r = await syncNow();
    setResult(r);
    if (r.needLogin) window.dispatchEvent(new Event('unauthorized'));
  }

  const n = outbox.length;
  if (online && n === 0 && !result) return null;

  return (
    <div className={`sync-bar ${online ? '' : 'offline'}`} role="status">
      {(!online || n > 0 || (result && result.sent > 0 && !result.failed.length)) && <div className="sync-row">
        <span className="sync-text">
          {!online && <b>📴 {t('Offline')}</b>}
          {!online && n === 0 && <span> · {t('showing saved data')}</span>}
          {n > 0 && <span>{!online && ' · '}⏳ {tn('{n} change waiting to sync', '{n} changes waiting to sync', n)}</span>}
          {online && n === 0 && result && result.sent > 0 && !result.failed.length && <span>✓ {tn('Synced {n} change', 'Synced {n} changes', result.sent)}</span>}
        </span>
        {n > 0 && (
          <span className="sync-actions">
            <button className="btn ghost small-btn" onClick={() => setReview(true)}>{t('Review')}</button>
            <button className="btn primary small-btn" onClick={sync} disabled={syncing}>{syncing ? t('Syncing…') : t('Sync now')}</button>
          </span>
        )}
      </div>}
      {result?.stoppedOffline && <div className="sync-msg">{t('Still no connection to the server.')} {result.sent ? tn('{n} sent, the rest wait.', '{n} sent, the rest wait.', result.sent) + ' ' : ''}{t("Try again when you're online.")}</div>}
      {result?.needLogin && <div className="sync-msg">{t('Your session expired. Log in again; your changes are kept on this device.')}</div>}
      {result && result.failed.length > 0 && (
        <div className="sync-msg">
          {result.sent > 0 && <>✓ {tn('Synced {n} change', 'Synced {n} changes', result.sent)}. </>}
          {tn('{n} change was rejected by the server and dropped:', '{n} changes were rejected by the server and dropped:', result.failed.length)}
          <ul>{result.failed.map((f, i) => <li key={i}>{f.label}: {f.error}</li>)}</ul>
          <button className="btn ghost small-btn" onClick={() => setResult(null)}>OK</button>
        </div>
      )}
      {review && (
        <Modal title={t('Waiting to sync')} onClose={() => setReview(false)}>
          {outbox.length === 0 ? <p className="muted">{t('Nothing left to sync.')}</p> : (
            <ul className="list">
              {outbox.map((e) => (
                <li key={e.id}>
                  <span className="list-icon">{e.method === 'DELETE' ? '🗑️' : e.method === 'POST' ? '➕' : '✏️'}</span>
                  <span className="grow"><b>{e.label}</b><small>{new Date(e.createdAt).toLocaleString(locale())}</small></span>
                  <button className="btn ghost danger small-btn" onClick={() => { if (confirm(t('Discard this change? It will not be synced.'))) discard(e.id); }}>{t('Discard')}</button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{t('Changes are sent in this order when you press Sync now.')}</p>
        </Modal>
      )}
    </div>
  );
}
