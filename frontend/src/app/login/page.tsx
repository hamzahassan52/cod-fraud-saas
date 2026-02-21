'use client';

import { useState } from 'react';
import { authApi } from '@/lib/api';

function ShieldLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <path d="M28 4L48 12V26C48 38 38 47 28 52C18 47 8 38 8 26V12L28 4Z" fill="url(#sg)" />
      <path d="M28 4L48 12V26C48 38 38 47 28 52C18 47 8 38 8 26V12L28 4Z" fill="white" fillOpacity="0.08" />
      <rect x="18" y="32" width="5" height="8" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="25.5" y="26" width="5" height="14" rx="1.5" fill="white" />
      <rect x="33" y="20" width="5" height="20" rx="1.5" fill="white" fillOpacity="0.7" />
      <circle cx="20.5" cy="29" r="2" fill="#60a5fa" />
      <circle cx="28" cy="23" r="2" fill="#93c5fd" />
      <circle cx="35.5" cy="17" r="2" fill="#bfdbfe" />
      <polyline points="20.5,29 28,23 35.5,17" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const features = [
  { icon: '⚡', title: 'Real-time Scoring', desc: 'Every order scored in under 200ms' },
  { icon: '🤖', title: 'ML-Powered Detection', desc: 'XGBoost model trained on Pakistan COD data' },
  { icon: '🛡️', title: 'Multi-Layer Protection', desc: 'Rules + Statistical + AI working together' },
  { icon: '📊', title: 'Revenue Analytics', desc: 'Track exactly how much fraud you stopped' },
];

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '' });
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = isLogin
        ? await authApi.login(form.email, form.password)
        : await authApi.register(form);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      localStorage.setItem('tenant', JSON.stringify(res.data.tenant));
      if (res.data.apiKey) {
        alert(`Your API Key (save it now!):\n\n${res.data.apiKey}`);
      }
      window.location.href = '/';
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-700';

  return (
    <div className="flex min-h-screen bg-white dark:bg-slate-900">

      {/* Left panel — branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] flex-col items-center justify-center bg-slate-900 px-14 py-12 relative overflow-hidden">
        {/* Background decoration */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/10" />
          <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-blue-500/8" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-blue-600/5" />
        </div>

        <div className="relative w-full max-w-md space-y-10">
          {/* Logo + Brand */}
          <div className="flex items-center gap-4">
            <ShieldLogo size={52} />
            <div>
              <p className="text-xl font-bold text-white tracking-tight">COD Fraud Shield</p>
              <p className="text-sm text-slate-500">Pakistan's #1 fraud protection</p>
            </div>
          </div>

          {/* Headline */}
          <div>
            <h2 className="text-5xl font-extrabold text-white leading-[1.1] tracking-tight xl:text-6xl">
              Stop COD fraud<br />
              <span className="text-blue-400">before it costs</span><br />
              <span className="text-blue-400">you.</span>
            </h2>
            <p className="mt-5 text-lg text-slate-400 leading-relaxed">
              AI-powered risk scoring built specifically for Pakistan's Cash-on-Delivery market. Block bad orders, protect revenue.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-800 text-2xl">
                  {f.icon}
                </div>
                <div>
                  <p className="text-base font-semibold text-white">{f.title}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust indicator */}
          <div className="flex items-center gap-3 pt-2">
            <div className="flex -space-x-2">
              {['M', 'A', 'S', 'R'].map((l) => (
                <div key={l} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-900 bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white">
                  {l}
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Trusted by COD businesses</p>
              <p className="text-xs text-slate-500">Across Pakistan</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 sm:px-12">
        <div className="w-full max-w-[440px]">

          {/* Mobile logo */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <ShieldLogo size={52} />
            <h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-slate-100">COD Fraud Shield</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Protect your COD orders from fraud</p>
          </div>

          {/* Desktop header */}
          <div className="mb-8 hidden lg:block">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              {isLogin ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              {isLogin ? 'Sign in to your dashboard' : 'Start protecting your orders today'}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="mb-6 flex rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => { setIsLogin(true); setError(''); }}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                isLogin
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(''); }}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                !isLogin
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/50 dark:bg-red-900/20">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-slate-300">Full Name</label>
                  <input
                    type="text"
                    placeholder="Ahmed Ali"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-slate-300">Company Name</label>
                  <input
                    type="text"
                    placeholder="My Store"
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    className={inputCls}
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-slate-300">Email Address</label>
              <input
                type="email"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputCls}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-slate-300">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isLogin ? '••••••••' : 'Min. 8 characters'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputCls + ' pr-11'}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
                >
                  {showPassword ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative w-full overflow-hidden rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition-all hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/40 disabled:opacity-60 active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Please wait...
                </span>
              ) : isLogin ? 'Sign In to Dashboard' : 'Create Account'}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-6 text-center text-xs text-gray-400 dark:text-slate-600">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              {isLogin ? 'Register free' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
