import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { apiGet, apiPost } from './api.js';

const routes = new Set(['/register', '/verify-otp', '/login', '/login-otp', '/dashboard']);
const OTP_LOCKED_MESSAGE = 'Bạn nhập sai quá nhiều lần, vui lòng đăng nhập lại.';
const GENERIC_RATE_LIMIT_MESSAGE = 'Bạn thao tác quá nhiều lần. Vui lòng chờ một chút rồi thử lại.';

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

  if (lower.includes('throttlerexception') || lower.includes('too many requests')) {
    return GENERIC_RATE_LIMIT_MESSAGE;
  }

  if (message === OTP_LOCKED_MESSAGE) {
    return message;
  }

  if (lower.includes('vui lòng chờ trước khi yêu cầu mã otp mới')) {
    return message;
  }

  if (lower.includes('yêu cầu gửi lại mã quá nhiều lần')) {
    return message;
  }

  if (lower.includes('invalid username') || lower.includes('invalid identifier') || lower.includes('unauthorized')) {
    return 'Username or password is incorrect.';
  }

  if (lower.includes('invalid or expired otp') || lower.includes('otp must be') || lower.includes('otp')) {
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

function getRetryAfterSeconds(error, fallback = 60) {
  const retryAfter = Number(error?.retryAfterSeconds);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : fallback;
}

function Field({ icon: Icon, label, disabled, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inputWrap">
        <Icon aria-hidden="true" size={18} />
        <input disabled={disabled} {...props} />
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

function ResendOtpControl({ disabled, cooldownSeconds, loading, onResend }) {
  const isCoolingDown = cooldownSeconds > 0;

  return (
    <button
      className="secondaryButton compactButton"
      type="button"
      disabled={disabled || loading || isCoolingDown}
      onClick={onResend}
    >
      {loading
        ? 'Đang gửi...'
        : isCoolingDown
          ? `Gửi lại mã (${cooldownSeconds}s)`
          : 'Gửi lại mã'}
    </button>
  );
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
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!email) navigate('/register');
  }, [email]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  function handleLocked() {
    setLocked(true);
    setOtp('');
    sessionStorage.removeItem('safety_register_email');
    window.setTimeout(() => navigate('/register'), 2500);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const data = await apiPost('/auth/verify-otp', { email, otp }, 'Could not verify OTP.');
      localStorage.setItem('safety_access_token', data.access_token);
      sessionStorage.removeItem('safety_register_email');
      navigate('/dashboard');
    } catch (err) {
      const message = getFriendlyError(err, 'OTP is invalid or expired.');
      setError(message);
      if (message === OTP_LOCKED_MESSAGE) handleLocked();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setSuccess('');
    setResendLoading(true);

    try {
      await apiPost('/auth/resend-otp', { purpose: 'register', email }, 'Could not resend OTP.');
      setOtp('');
      setSuccess('Mã OTP mới đã được gửi.');
      setCooldownSeconds(60);
    } catch (err) {
      const retryAfter = getRetryAfterSeconds(err, 60);
      const message = getFriendlyError(err, 'Could not resend OTP.');
      if (err?.status === 429 && message.includes('Vui lòng chờ')) {
        setCooldownSeconds(retryAfter);
        setError(`Vui lòng chờ ${retryAfter}s trước khi gửi lại mã.`);
      } else {
        setError(message);
      }
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <Shell eyebrow="Verification" title="Check your email" subtitle="We sent a verification code to your email.">
      <form onSubmit={handleSubmit} className="formStack">
        <Field icon={ShieldCheck} label="6-digit OTP" inputMode="numeric" maxLength="6" value={otp} disabled={locked} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Message error={error} success={success} />
        <button className="primaryButton" type="submit" disabled={otp.length !== 6 || loading || locked}>{loading ? 'Verifying...' : 'Verify'}</button>
        <ResendOtpControl disabled={locked} cooldownSeconds={cooldownSeconds} loading={resendLoading} onResend={handleResend} />
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
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!username) navigate('/login');
  }, [username]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  function handleLocked() {
    setLocked(true);
    setOtp('');
    sessionStorage.removeItem('safety_login_username');
    window.setTimeout(() => navigate('/login'), 2500);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const data = await apiPost('/auth/login/verify-otp', { username, otp }, 'Could not verify login OTP.');
      localStorage.setItem('safety_access_token', data.access_token);
      sessionStorage.removeItem('safety_login_username');
      navigate('/dashboard');
    } catch (err) {
      const message = getFriendlyError(err, 'OTP is invalid or expired.');
      setError(message);
      if (message === OTP_LOCKED_MESSAGE) handleLocked();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setSuccess('');
    setResendLoading(true);

    try {
      await apiPost('/auth/resend-otp', { purpose: 'login', username }, 'Could not resend OTP.');
      setOtp('');
      setSuccess('Mã OTP mới đã được gửi.');
      setCooldownSeconds(60);
    } catch (err) {
      const retryAfter = getRetryAfterSeconds(err, 60);
      const message = getFriendlyError(err, 'Could not resend OTP.');
      if (err?.status === 429 && message.includes('Vui lòng chờ')) {
        setCooldownSeconds(retryAfter);
        setError(`Vui lòng chờ ${retryAfter}s trước khi gửi lại mã.`);
      } else {
        setError(message);
      }
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <Shell eyebrow="Login verification" title="Enter your code" subtitle="We sent a verification code to the email linked with your Safety account.">
      <form onSubmit={handleSubmit} className="formStack">
        <Field icon={ShieldCheck} label="6-digit OTP" inputMode="numeric" maxLength="6" value={otp} disabled={locked} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Message error={error} success={success} />
        <button className="primaryButton" type="submit" disabled={otp.length !== 6 || loading || locked}>{loading ? 'Verifying...' : 'Verify'}</button>
        <ResendOtpControl disabled={locked} cooldownSeconds={cooldownSeconds} loading={resendLoading} onResend={handleResend} />
      </form>
    </Shell>
  );
}

function DashboardPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const token = localStorage.getItem('safety_access_token');

    if (!token) {
      navigate('/login');
      return () => {
        isMounted = false;
      };
    }

    async function validateSession() {
      try {
        const currentUser = await apiGet(
          '/auth/me',
          { Authorization: `Bearer ${token}` },
          'Session validation failed.',
        );

        if (isMounted) {
          setUser(currentUser);
          setLoading(false);
        }
      } catch {
        localStorage.removeItem('safety_access_token');
        if (isMounted) navigate('/login');
      }
    }

    validateSession();

    return () => {
      isMounted = false;
    };
  }, []);

  function logout() {
    localStorage.removeItem('safety_access_token');
    navigate('/login');
  }

  if (loading) {
    return (
      <Shell eyebrow="Checking session" title="Safety dashboard" subtitle="Validating your session.">
        <div className="successPanel">
          <ShieldCheck size={38} />
          <div>
            <strong>Validating session</strong>
            <p>Please wait while Safety checks your access token.</p>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Signed in" title="Safety dashboard" subtitle="You are logged in successfully.">
      <div className="successPanel">
        <CheckCircle2 size={38} />
        <div>
          <strong>Authentication complete</strong>
          <p>{user?.username ? `${user.username}'s Safety session is active.` : 'Your Safety session is active on this browser.'}</p>
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
