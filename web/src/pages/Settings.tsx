import { useEffect, useState } from 'react';
import { api, type Category, type Tracker, type User } from '../api';
import { Card, ErrorBox, Modal, TrackerSwitcher } from '../components';
import { useSession } from '../session-context';
import { clearCache, readOutbox } from '../offline';
import { money, parseAmount, trackerIcon, useData } from '../util';
import { getChoice, setChoice, type ThemeChoice } from '../theme';
import { LANGS, getLang, setLang, t, tn, useLang } from '../i18n';

// categorical palette slots, in fixed order
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#898781'];
const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CHF'];

export default function Settings() {
  const { user, trackers, active, tp, refresh } = useSession();
  const lang = useLang();
  const cats = useData(() => api.get<Category[]>(`${tp}/categories`), [tp]);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [managing, setManaging] = useState<Tracker | 'new' | null>(null);
  const [account, setAccount] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(getChoice());
  const pickTheme = (t: ThemeChoice) => { setChoice(t); setThemeChoice(t); };

  async function logout() {
    const n = readOutbox().length;
    if (n && !confirm(tn('{n} change not synced yet. It stays on this device and can be synced after you log in again. Log out?', '{n} changes not synced yet. They stay on this device and can be synced after you log in again. Log out?', n))) return;
    try {
      await api.post('/logout', {});
    } catch (err) {
      return alert((err as Error).message);
    }
    localStorage.removeItem('lastUser');
    clearCache(); // saved copies of your data; unsynced changes are kept
    location.reload();
  }

  return (
    <div className="page">
      <div className="page-head"><h1>{t('Settings')}</h1></div>

      <Card title={t('Account')} action={<button className="btn" onClick={() => setAccount(true)}>{t('Edit')}</button>}>
        <ul className="list">
          <li>
            <span className="list-icon">🙂</span>
            <span className="grow"><b>{user.name}</b><small>@{user.username} · {t('main currency {ccy}', { ccy: user.base_currency })}</small></span>
            <button className="btn danger" onClick={logout}>{t('Log out')}</button>
          </li>
        </ul>
      </Card>

      <Card title={t('Spending trackers')} action={<button className="btn" onClick={() => setManaging('new')}>+ {t('New tracker')}</button>}>
        <ul className="list clickable">
          {trackers.map((tr) => (
            <li key={tr.id} onClick={() => setManaging(tr)}>
              <span className="list-icon">{trackerIcon(tr)}</span>
              <span className="grow">
                <b>{tr.name}{tr.id === active.id ? ` · ${t('showing')}` : ''}</b>
                <small>
                  {tr.currency} · {tr.role === 'owner'
                    ? (tr.members.length > 1
                      ? t('shared with {names}', { names: tr.members.filter((m) => m.id !== user.id).map((m) => m.name).join(', ') })
                      : t('only you'))
                    : t('shared by {name}', { name: tr.members.find((m) => m.role === 'owner')?.name ?? t('owner') })}
                </small>
              </span>
              <span className="muted">›</span>
            </li>
          ))}
        </ul>
        <p className="muted small">{t('Each tracker has its own categories, budgets and expenses. Share one (e.g. Household) and everyone in it can add expenses. Investments and Piggybank are always private.')}</p>
      </Card>

      <Card title={t('Categories in {name}', { name: active.name })} action={<div className="head-actions"><TrackerSwitcher /><button className="btn" onClick={() => setEditing('new')}>+ {t('Add')}</button></div>}>
        <ul className="list clickable">
          {cats.data?.map((c) => (
            <li key={c.id} onClick={() => setEditing(c)} className={c.archived ? 'dim' : ''}>
              <span className="list-icon" style={{ background: c.color + '22' }}>{c.icon}</span>
              <span className="grow">
                <b>{c.name}</b>
                <small>{c.monthly_limit != null ? t('Monthly limit {amount}', { amount: money(c.monthly_limit) }) : t('No limit')}{c.archived ? ` · ${t('hidden')}` : ''}</small>
              </span>
              <span className="swatch lg" style={{ background: c.color }} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('Appearance')}>
        <div className="segmented theme-pick" role="radiogroup" aria-label={t('Theme')}>
          {([['system', '🖥️', 'System'], ['light', '☀️', 'Light'], ['dark', '🌙', 'Dark'], ['amoled', '⚫', 'AMOLED']] as const).map(([v, icon, label]) => (
            <button key={v} role="radio" aria-checked={themeChoice === v} className={themeChoice === v ? 'on' : ''} onClick={() => pickTheme(v)}>
              <span>{icon}</span> {t(label)}
            </button>
          ))}
        </div>
        <p className="muted small">{t("AMOLED uses pure black so OLED pixels switch off: saves battery and looks deeper. System follows your phone's dark mode.")}</p>
      </Card>

      <Card title={t('Language')}>
        <div className="segmented" role="radiogroup" aria-label={t('Language')}>
          {LANGS.map((l) => (
            <button key={l.code} role="radio" aria-checked={lang === l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)}>
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t('Backup')}>
        <a className="btn" href={`${import.meta.env.BASE_URL}api/export`}>⬇ {t('Download my data (JSON)')}</a>
      </Card>

      <Card title={t('Install on your phone')}>
        <p><b>Android (Chrome):</b> {t('open this site → menu ⋮ → Add to Home screen / Install app.')}</p>
        <p><b>iPhone (Safari):</b> {t('open this site → Share → Add to Home Screen.')}</p>
        <p className="muted small">{t("The phone must reach the server: same Wi-Fi using this computer's IP, or your hosted domain with HTTPS.")}</p>
      </Card>

      {editing && (
        <Modal title={editing === 'new' ? t('New category in {name}', { name: active.name }) : t('Edit {name}', { name: editing.name })} onClose={() => setEditing(null)}>
          <CategoryForm cat={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); cats.reload(); }} />
        </Modal>
      )}
      {managing && (
        <Modal title={managing === 'new' ? t('New tracker') : managing.name} onClose={() => setManaging(null)}>
          <TrackerManager tracker={managing === 'new' ? undefined : managing}
            onChanged={refresh} onClose={() => { setManaging(null); refresh(); }} />
        </Modal>
      )}
      {account && (
        <Modal title={t('Account')} onClose={() => setAccount(false)}>
          <AccountForm onDone={() => setAccount(false)} />
        </Modal>
      )}
    </div>
  );
}

/** Create, rename, share, leave or delete a tracker. */
function TrackerManager({ tracker, onChanged, onClose }: { tracker?: Tracker; onChanged: () => Promise<void>; onClose: () => void }) {
  const { user, trackers, setActive } = useSession();
  // always render from the freshest copy after membership changes
  const tr = tracker ? trackers.find((x) => x.id === tracker.id) ?? tracker : undefined;
  const isOwner = !tr || tr.role === 'owner';
  const [name, setName] = useState(tr?.name ?? '');
  const [currency, setCurrency] = useState(tr?.currency ?? user.base_currency);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!tr) {
      const ok = await run(async () => {
        const created = await api.post<Tracker>('/trackers', { name, currency, lang: getLang() });
        await onChanged();
        setActive(created.id);
      });
      if (ok) onClose();
    } else {
      await run(async () => { await api.put(`/trackers/${tr.id}`, { name, currency }); await onChanged(); }, t('Saved'));
    }
  }

  async function share(e: React.FormEvent) {
    e.preventDefault();
    const who = invite.trim();
    if (!who || !tr) return;
    const ok = await run(async () => { await api.post(`/trackers/${tr.id}/members`, { username: who }); await onChanged(); },
      t('{who} can now see and add expenses in {name}', { who, name: tr.name }));
    if (ok) setInvite('');
  }

  async function removeMember(uid: number, label: string) {
    if (!tr || !confirm(t('Remove {who} from {name}? Their past expenses stay.', { who: label, name: tr.name }))) return;
    await run(async () => { await api.del(`/trackers/${tr.id}/members/${uid}`); await onChanged(); });
  }

  async function leave() {
    if (!tr || !confirm(t('Leave {name}? You will lose access until the owner adds you again.', { name: tr.name }))) return;
    if (await run(() => api.del(`/trackers/${tr.id}/members/${user.id}`))) onClose();
  }

  async function destroy() {
    if (!tr || !confirm(t('Delete {name} with ALL its expenses, budgets and categories, for everyone? This cannot be undone.', { name: tr.name }))) return;
    if (await run(() => api.del(`/trackers/${tr.id}`))) onClose();
  }

  return (
    <div className="form">
      <form className="form" onSubmit={save}>
        <div className="row2">
          <label>{t('Name')}<input autoFocus={!tr} required disabled={!isOwner} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. {examples}', { examples: t('Household') })} /></label>
          <label className="narrow-lg">{t('Currency')}
            <select disabled={!isOwner} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {isOwner && <div className="form-actions"><button className="btn primary">{tr ? t('Save') : t('Create tracker')}</button></div>}
      </form>

      {tr && (
        <>
          <h3 className="section-title">{t('People')}</h3>
          <ul className="list">
            {tr.members.map((m) => (
              <li key={m.id}>
                <span className="list-icon">{m.role === 'owner' ? '👑' : '🙂'}</span>
                <span className="grow"><b>{m.name}{m.id === user.id ? ` (${t('you')})` : ''}</b><small>@{m.username} · {t(m.role)}</small></span>
                {isOwner && m.role !== 'owner' && (
                  <button className="btn ghost danger" onClick={() => removeMember(m.id, m.name)}>{t('Remove')}</button>
                )}
              </li>
            ))}
          </ul>
          {isOwner ? (
            <form className="share-row" onSubmit={share}>
              <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t('Their username')} autoCapitalize="none" aria-label={t('Username to share with')} />
              <button className="btn">{t('Share')}</button>
            </form>
          ) : null}
          {isOwner && <p className="muted small">{t('The other person needs an account first. Shared people can add, edit and delete expenses, budgets and categories in this tracker.')}</p>}
        </>
      )}

      <ErrorBox error={error} />
      {notice && <div className="ok-box">✓ {notice}</div>}

      {tr && (
        <div className="form-actions">
          {isOwner
            ? <button className="btn danger" onClick={destroy}>{t('Delete tracker')}</button>
            : <button className="btn danger" onClick={leave}>{t('Leave tracker')}</button>}
        </div>
      )}
    </div>
  );
}

function AccountForm({ onDone }: { onDone: () => void }) {
  const { user, setUser } = useSession();
  const [name, setName] = useState(user.name);
  const [ccy, setCcy] = useState(user.base_currency);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body: Record<string, string> = { name, base_currency: ccy };
      if (next) Object.assign(body, { current_password: current, new_password: next });
      setUser(await api.put<User>('/account', body));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>{t('Your name')}<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('Main currency')} <small className="muted">({t('investments, piggybank, net worth')})</small>
        <select value={ccy} onChange={(e) => setCcy(e.target.value)}>
          {[...new Set([ccy, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <h3 className="section-title">{t('Change password')} <small className="muted">({t('optional')})</small></h3>
      <div className="row2">
        <label>{t('Current')}<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>{t('New')}<input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="form-actions"><button className="btn primary">{t('Save')}</button></div>
    </form>
  );
}

function CategoryForm({ cat, onDone }: { cat?: Category; onDone: () => void }) {
  const { tp } = useSession();
  const [name, setName] = useState(cat?.name ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? '🏷️');
  const [color, setColor] = useState(cat?.color ?? COLORS[0]);
  useEffect(() => {
    if (!cat) api.get<{ color: string }>(`${tp}/categories/next-color`).then((r) => setColor(r.color)).catch(() => {});
  }, [cat, tp]);
  const [limit, setLimit] = useState(cat?.monthly_limit != null ? String(cat.monthly_limit) : '');
  const [archived, setArchived] = useState(!!cat?.archived);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, icon, color, monthly_limit: limit.trim() === '' ? null : parseAmount(limit), archived };
    try {
      if (cat) await api.put(`${tp}/categories/${cat.id}`, body);
      else await api.post(`${tp}/categories`, body);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    if (!cat || !confirm(t('Delete "{name}"? Its transactions become uncategorized. (Tip: hide it instead to keep history.)', { name: cat.name }))) return;
    await api.del(`${tp}/categories/${cat.id}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="row2">
        <label className="narrow">{t('Icon')}<input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} /></label>
        <label>{t('Name')}<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="swatches">
        {COLORS.map((c) => (
          <button type="button" key={c} aria-label={c} className={`swatch-btn ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('Custom color')} />
      </div>
      <label>{t('Monthly limit (optional)')}<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t('no limit')} /></label>
      {cat && <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {t('Hide from the add-expense list')}</label>}
      <ErrorBox error={error} />
      <div className="form-actions">
        {cat && <button type="button" className="btn danger" onClick={remove}>{t('Delete')}</button>}
        <button className="btn primary">{t('Save')}</button>
      </div>
    </form>
  );
}

