import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorBox } from '../components';
import { LANGS, getLang, setLang, t, type Lang } from '../i18n';

export default function Login({ registrationOpen, onLogin }: { registrationOpen: boolean; onLogin: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<{ id: string; svg: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  // every picture can be tried once, so a new one is loaded after each failed sign-up
  const newCaptcha = useCallback(async () => {
    try {
      const next = await api.get<{ id: string; svg: string }>('/captcha');
      setCaptcha(next);
      setCaptchaAnswer('');
    } catch (err) {
      setCaptcha(null);
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    // state is only set after the request finishes (network sync, not a cascading render)
    // eslint-disable-next-line react/set-state-in-effect
    if (mode === 'register') newCaptcha();
  }, [mode, newCaptcha]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'register' && password !== password2) return setError(t('Passwords do not match'));
    setBusy(true);
    try {
      await api.post(mode === 'login' ? '/login' : '/register',
        { username, name, password, lang: getLang(), captcha_id: captcha?.id, captcha: captchaAnswer });
      onLogin();
    } catch (err) {
      setError((err as Error).message);
      if (mode === 'register') newCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (m: 'login' | 'register') => { setMode(m); setError(null); };

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <div className="login-top">
          <div className="brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={36} height={36} /> Finance</div>
          <select className="lang-select" value={getLang()} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('Language')}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
          </select>
        </div>
        {registrationOpen && (
          <div className="segmented">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>{t('Log in')}</button>
            <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => switchMode('register')}>{t('Create account')}</button>
          </div>
        )}
        <label>{t('Username')}
          <input autoFocus autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        {mode === 'register' && (
          <label>{t('Your name')} <small className="muted">({t('shown to people you share with')})</small>
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. {examples}', { examples: 'Anna' })} />
          </label>
        )}
        <label>{t('Password')}
          <input type="password" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === 'register' && (
          <label>{t('Repeat password')}
            <input type="password" required autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </label>
        )}
        {mode === 'register' && (
          <div className="captcha">
            <span>{t('Type the characters from the picture')}</span>
            <div className="captcha-row">
              {/* the SVG comes from our own server and contains only paths */}
              <div className="captcha-img" aria-label={t('Picture with characters')} dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }} />
              <button type="button" className="btn" onClick={newCaptcha} title={t('New picture')} aria-label={t('New picture')}>🔄</button>
            </div>
            <input required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={10}
              aria-label={t('Type the characters from the picture')} value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} />
          </div>
        )}
        <ErrorBox error={error} />
        <button className="btn primary" disabled={busy}>{mode === 'login' ? t('Log in') : t('Create account')}</button>
        {mode === 'register' && <p className="muted small">{t('At least 8 characters. You get a private "Personal" tracker; you can create shared ones later in Settings.')}</p>}
      </form>
    </div>
  );
}
