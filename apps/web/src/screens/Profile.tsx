import { signOut } from '../lib';
import { profileOf, useMe, useTheme } from '../hooks';
import { navigate } from '../router';
import { when } from '../format';
import { useToast } from '../ui';
import { ThemeIcon } from '../icons';

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  email: 'Email',
};

export default function Profile() {
  const toast = useToast();
  const me = useMe();
  const { fullName, firstName, avatarUrl, provider } = profileOf(me);
  const [theme, setTheme] = useTheme();

  async function onSignOut() {
    const res = await signOut();
    if (res.error !== undefined) toast(res.error, 'error');
    else navigate('/', { replace: true });
  }

  return (
    <div className="stack">
      <h1>Profile</h1>

      <div className="card row">
        {avatarUrl ? (
          <img className="avatar lg" src={avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar lg avatar-fallback" aria-hidden="true">
            {firstName.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="grow">
          <strong>{fullName ?? firstName}</strong>
          <p className="muted small">{me.email}</p>
        </div>
      </div>

      <div className="card stack">
        <h2>Account</h2>
        <div className="setting-row">
          <span className="muted">Email</span>
          <span>{me.email ?? '-'}</span>
        </div>
        <div className="setting-row">
          <span className="muted">Signed in with</span>
          <span>{(provider && PROVIDER_LABEL[provider]) ?? provider ?? 'Unknown'}</span>
        </div>
        {me.created_at && (
          <div className="setting-row">
            <span className="muted">Member since</span>
            <span>{when(me.created_at)}</span>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2>Appearance</h2>
        <div className="setting-row">
          <span className="muted">Theme</span>
          <button
            type="button"
            className="btn small"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <ThemeIcon theme={theme} />
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Notifications</h2>
        <p className="hint">
          Coming soon - for now every alert below is on and only shows up in the bell menu.
        </p>
        {['Market closing soon', 'A bet of yours settled', 'New chat message'].map((label) => (
          <div key={label} className="setting-row">
            <span className="muted">{label}</span>
            <span className="pill muted">On</span>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Session</h2>
        <button type="button" className="btn" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
