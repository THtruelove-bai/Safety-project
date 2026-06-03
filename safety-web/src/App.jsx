import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { apiPost } from './api.js';

const routes = new Set(['/register', '/verify-otp', '/login', '/login-otp', '/dashboard']);

function navigate(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleRoute = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handleRoute);
    return () => window.removeEventListener('popstate', handleRoute);
  }, []);

  if (!routes.has(path)) {
    return localStorage.getItem('safety_access_token') ? '/dashboard' : '/login';
  }

  return path;
}

function getFriendlyError(error, fallback) {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();

  if (lower.includes('invalid username') || lower.includes('invalid identifier') || lower.includes('unauthorized')) {
    return 'Username or password is incorrect.';
  }

  if (lower.includes('invalid or expired otp') || lower.includes('otp')) {
    return 'OTP is invalid or expired.';
  }

  if (lower.includes('email is already registered')) {
    return 'Email already exists.';
  }

  if (lower.includes('username is already registered')) {
    return 'Username already exists.';
  }

  if (lower.includes('email is not verified')) {
    return 'Please verify your email before logging in.';
  }

  return message || fallback;
}

function Field({ icon: Icon, label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inputWrap">
        <Icon aria-hidden="true" size={18} />
        <input {...props} />
      </div>
    </label>
  );
}

function Shell({ eyebrow, title, subtitle, children, aside }) {
  return (
    <main className="pageShell">
      <section className="authCard" aria-label={title}>
        <div className="brandMark" aria-label="Safety">
          <ShieldCheck size={28} />
          <span>Safety</span>
        </div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
        {children}
        {aside ? <div className="asideLink">{aside}</div> : null}
      </section>
    </main>
  );
}

function Message({ error, success }) {
  if (!error && !success) return null;
  return <div className={error ? 'message error' : 'message success'}>{error || success}</div>;
}

function RegisterPage() {
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = form.username.trim() && form.email.trim() && form.password.length >= 8 && !loading;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      };
      await apiPost('/auth/register', payload, 'Could not create account.');
      sessionStorage.setItem('safety_register_email', payload.email);
      navigate('/verify-otp');
    } catch (err) {
      setError(getFriendlyError(err, 'Could not create account.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell
      eyebrow="Create account"
      title="Create your Safety account"
      subtitle="Use a username, Gmail address, and password to start secure access."
      aside={
        <>
          Already have an account? <button type="button" onClick={() => navigate('/login')}>Login</button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="formStack">
        <Field icon={UserRound} label="Username" value={form.username} autoComplete="username" onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <Field icon={Mail} label="Email" type="email" value={form.email} autoComplete="email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field icon={LockKeyhole} label="Password" type="password" value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Message error={error} />
        <button className="primaryButton" type="submit" disabled={!canSubmit}>{loading ? 'Creating account...' : 'Create Safety account'}</button>
      </form>
    </Shell>
  );
}

function VerifyOtpPage() {
  const email = useMemo(() => sessionStorage.getItem('safety_register_email'), []);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) navigate('/register');
  }, [email]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiPost('/auth/verify-otp', { email, otp }, 'Could not verify OTP.');
      localStorage.setItem('safety_access_token', data.access_token);
      sessionStorage.removeItem('safety_register_email');
      navigate('/dashboard');
    } catch (err) {
      setError(getFriendlyError(err, 'OTP is invalid or expired.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell eyebrow="Verification" title="Check your email" subtitle="We sent a verification code to your email.">
      <form onSubmit={handleSubmit} className="formStack">
        <Field icon={ShieldCheck} label="6-digit OTP" inputMode="numeric" maxLength="6" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Message error={error} />
        <button className="primaryButton" type="submit" disabled={otp.length !== 6 || loading}>{loading ? 'Verifying...' : 'Verify'}</button>
      </form>
    </Shell>
  );
}

function LoginPage() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = form.username.trim() && form.password && !loading;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = { username: form.username.trim(), password: form.password };
      await apiPost('/auth/login/request-otp', payload, 'Could not request login OTP.');
      sessionStorage.setItem('safety_login_username', payload.username);
      navigate('/login-otp');
    } catch (err) {
      setError(getFriendlyError(err, 'Username or password is incorrect.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell
      eyebrow="Welcome back"
      title="Login with Safety"
      subtitle="Enter your Safety username and password. We will send a code to your registered email."
      aside={
        <>
          New to Safety? <button type="button" onClick={() => navigate('/register')}>Create account</button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="formStack">
        <Field icon={UserRound} label="Username" value={form.username} autoComplete="username" onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <Field icon={LockKeyhole} label="Password" type="password" value={form.password} autoComplete="current-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Message error={error} />
        <button className="primaryButton" type="submit" disabled={!canSubmit}>{loading ? 'Sending code...' : 'Login with Safety'}</button>
      </form>
    </Shell>
  );
}

function LoginOtpPage() {
  const username = useMemo(() => sessionStorage.getItem('safety_login_username'), []);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!username) navigate('/login');
  }, [username]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiPost('/auth/login/verify-otp', { username, otp }, 'Could not verify login OTP.');
      localStorage.setItem('safety_access_token', data.access_token);
      sessionStorage.removeItem('safety_login_username');
      navigate('/dashboard');
    } catch (err) {
      setError(getFriendlyError(err, 'OTP is invalid or expired.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell eyebrow="Login verification" title="Enter your code" subtitle="We sent a verification code to the email linked with your Safety account.">
      <form onSubmit={handleSubmit} className="formStack">
        <Field icon={ShieldCheck} label="6-digit OTP" inputMode="numeric" maxLength="6" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Message error={error} />
        <button className="primaryButton" type="submit" disabled={otp.length !== 6 || loading}>{loading ? 'Verifying...' : 'Verify'}</button>
      </form>
    </Shell>
  );
}

function DashboardPage() {
  const hasToken = Boolean(localStorage.getItem('safety_access_token'));

  useEffect(() => {
    if (!hasToken) navigate('/login');
  }, [hasToken]);

  function logout() {
    localStorage.removeItem('safety_access_token');
    navigate('/login');
  }

  return (
    <Shell eyebrow="Signed in" title="Safety dashboard" subtitle="You are logged in successfully.">
      <div className="successPanel">
        <CheckCircle2 size={38} />
        <div>
          <strong>Authentication complete</strong>
          <p>Your Safety session is active on this browser.</p>
        </div>
      </div>
      <button className="secondaryButton" type="button" onClick={logout}>
        <LogOut size={18} />
        Logout
      </button>
    </Shell>
  );
}

export default function App() {
  const route = useRoute();

  if (route === '/register') return <RegisterPage />;
  if (route === '/verify-otp') return <VerifyOtpPage />;
  if (route === '/login-otp') return <LoginOtpPage />;
  if (route === '/dashboard') return <DashboardPage />;
  return <LoginPage />;
}
