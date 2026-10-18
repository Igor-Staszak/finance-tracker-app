import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { api, type User } from './api';
import { OfflineError, setOfflineUser } from './offline';
import SyncBar from './SyncBar';
import { Modal, TxForm } from './components';
import { SessionProvider } from './session';
import { useSession } from './session-context';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Salary from './pages/Salary';
import Investments from './pages/Investments';
import Piggy from './pages/Piggy';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { t, useLang } from './i18n';

const NAV = [
  { to: '/', icon: '📊', label: () => t('Spending') },
  { to: '/transactions', icon: '🧾', label: () => t('History') },
  { to: '/salary', icon: '💼', label: () => t('Salary (menu)') },
  { to: '/investments', icon: '📈', label: () => t('Investments') },
  { to: '/piggy', icon: '🐷', label: () => t('Piggybank') },
  { to: '/settings', icon: '⚙️', label: () => t('Settings') },
];

export default function App() {
  const [me, setMe] = useState<{ user: User | null; registrationOpen: boolean } | null>(null);
  const lang = useLang(); // screens are re-created when the language changes

  const loadMe = async () => {
    try {
      const m = await api.get<{ user: User | null; registrationOpen: boolean }>('/me');
      if (m.user) {
        localStorage.setItem('lastUser', JSON.stringify(m.user));
        setOfflineUser(m.user.id);
      }
      setMe(m);
    } catch (e) {
      // offline: continue as the last logged-in user with their saved data
      const last = e instanceof OfflineError ? localStorage.getItem('lastUser') : null;
      const user = last ? (JSON.parse(last) as User) : null;
      if (user) setOfflineUser(user.id);
      setMe({ user, registrationOpen: true });
    }
  };
  useEffect(() => {
    // state is only set after the request finishes (network sync, not a cascading render)
    // eslint-disable-next-line react/set-state-in-effect
    loadMe();
    const onUnauth = () => setMe((m) => (m ? { ...m, user: null } : m));
    window.addEventListener('unauthorized', onUnauth);
    return () => window.removeEventListener('unauthorized', onUnauth);
  }, []);

  if (!me) return null;
  if (!me.user) return <Login key={lang} registrationOpen={me.registrationOpen} onLogin={loadMe} />;

  return (
    <SessionProvider key={me.user.id} user={me.user}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Shell key={lang} />
      </BrowserRouter>
    </SessionProvider>
  );
}

function Shell() {
  const { active, refresh } = useSession();
  const [adding, setAdding] = useState(false);
  const [syncGen, setSyncGen] = useState(0);
  // after a sync, reload trackers and every page from the server
  useEffect(() => {
    const on = () => { refresh().catch(() => {}); setSyncGen((g) => g + 1); };
    window.addEventListener('synced', on);
    return () => window.removeEventListener('synced', on);
  }, [refresh]);
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} /> Finance</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-item">
            <span className="nav-icon">{n.icon}</span><span className="nav-label">{n.label()}</span>
          </NavLink>
        ))}
      </nav>
      {/* pages remount when switching trackers or after a sync, so every query reloads; the sync bar stays */}
      <main>
        <SyncBar />
        <div key={`${active.id}-${syncGen}`}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/salary" element={<Salary />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/piggy" element={<Piggy />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </div>
      </main>
      <button className="fab" onClick={() => setAdding(true)} aria-label={t('Add expense')}>+</button>
      {adding && (
        <Modal title={t('Add transaction')} onClose={() => setAdding(false)}>
          <TxForm onDone={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <div className="card empty-page">
        <h1>{t('Page not found')}</h1>
        <p className="muted">{t("This address doesn't exist in the app.")}</p>
        <Link className="btn primary" to="/">{t('Go to Spending')}</Link>
      </div>
    </div>
  );
}
