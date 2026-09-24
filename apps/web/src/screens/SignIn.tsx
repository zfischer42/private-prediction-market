import { useEffect, useState } from 'react';
import { signInWithGoogle } from '../lib';
import { rememberReturnTo } from '../router';
import { GoogleIcon } from '../icons';
import { InstallLink } from '../install';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Coming back with the browser's Back button restores this page from cache
  // with the button still stuck on "Redirecting...".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  async function start() {
    setBusy(true);
    setError(undefined);
    rememberReturnTo();
    const res = await signInWithGoogle();
    // On success the browser is already on its way to Google.
    if (res.error !== undefined) {
      setBusy(false);
      setError(res.error);
    }
  }

  return (
    <main className="signin">
      <div className="brand">
        <span className="brand-mark">$</span>
        Private Market
      </div>

      <div className="signin-body">
        <h1>Bet on what your friends will do.</h1>
        <p className="lede">
          Private markets for your group chat. Join with a code, back a side, settle up when it's
          over.
        </p>
      </div>

      <div className="signin-foot">
        {error && (
          <p className="note error" role="alert" style={{ alignSelf: 'stretch' }}>
            {error}
          </p>
        )}
        <button type="button" className="btn google block" onClick={start} disabled={busy}>
          {!busy && <GoogleIcon />}
          {busy ? 'Redirecting...' : 'Continue with Google'}
        </button>
        <InstallLink />
      </div>
    </main>
  );
}
