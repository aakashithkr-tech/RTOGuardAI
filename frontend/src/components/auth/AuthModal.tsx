import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Lock,
  Mail,
  User,
  Store,
  Key,
  Copy,
  Check,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import {
  loginMerchant,
  signupMerchant,
  demoJudgeLogin,
  MerchantUser,
  MerchantProfile,
  ApiKeyItem,
} from '../../services/authApi';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: MerchantUser, merchant: MerchantProfile, keys?: ApiKeyItem[]) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
}) => {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedKeys, setIssuedKeys] = useState<ApiKeyItem[] | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [storeName, setStoreName] = useState('');

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2500);
  };

  const handleJudgeDemoClick = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await demoJudgeLogin();
      if (res.keys && res.keys.length > 0) {
        setIssuedKeys(res.keys);
      }
      onAuthSuccess(res.user, res.merchant, res.keys);
    } catch (err: any) {
      setError(err.message || 'Judge demo login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await loginMerchant({ email, password });
      onAuthSuccess(res.user, res.merchant);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !password) {
      setError('Name, email, and password (min 6 characters) are required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await signupMerchant({
        name: fullName,
        email,
        password,
        store_name: storeName || undefined,
      });
      if (res.keys && res.keys.length > 0) {
        setIssuedKeys(res.keys);
      }
      onAuthSuccess(res.user, res.merchant, res.keys);
    } catch (err: any) {
      setError(err.message || 'Signup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">RTOGuardAI Merchant Portal</h2>
              <p className="text-[11px] text-slate-500">Self-service API keys, scoring dashboard & checkout control</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 1-Click Judge / Demo Login Highlighted Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 border border-indigo-200/80 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white tracking-wide uppercase">
                    Hackathon Judge
                  </span>
                  <span className="text-xs font-bold text-indigo-950">1-Click Fast Pass</span>
                </div>
                <p className="text-xs text-indigo-900/80 mt-1">
                  Instant sign-in with pre-seeded demo merchant & live API keys. No credentials required!
                </p>
              </div>
              <button
                type="button"
                onClick={handleJudgeDemoClick}
                disabled={loading}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>{loading ? 'Entering...' : '1-Click Login'}</span>
              </button>
            </div>
          </div>

          {/* New Keys Issued Success View */}
          {issuedKeys ? (
            <div className="space-y-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold">API Credentials Issued Successfully!</h4>
                  <p className="text-[11px] text-emerald-700">
                    Store your secret key securely. It will not be shown in full again.
                  </p>
                </div>
              </div>

              <div className="space-y-2 font-mono text-xs">
                {issuedKeys.map((k) => (
                  <div key={k.id} className="p-2.5 rounded-lg bg-white border border-emerald-200 shadow-sm">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span className="font-semibold uppercase tracking-wider text-slate-700">
                        {k.type === 'public' ? 'Public Key (Browser)' : 'Secret Key (Server)'}
                      </span>
                      <button
                        onClick={() => handleCopy(k.key || '', k.id)}
                        className="flex items-center gap-1 text-emerald-600 hover:text-emerald-800 font-sans text-xs font-medium"
                      >
                        {copiedKeyId === k.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-800 truncate select-all font-mono">
                      {k.key || `${k.prefix}...`}
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                Continue to Dashboard & Integration
              </button>
            </div>
          ) : (
            <>
              {/* Tab Selector */}
              <div className="flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setTab('signin');
                    setError(null);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    tab === 'signin'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('signup');
                    setError(null);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    tab === 'signup'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Merchant Account
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{error}</span>
                </div>
              )}

              {/* Sign In Form */}
              {tab === 'signin' ? (
                <form onSubmit={handleSignIn} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="merchant@example.com"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-all shadow-sm disabled:opacity-50 mt-2"
                  >
                    <span>{loading ? 'Authenticating...' : 'Sign In to Dashboard'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
                /* Sign Up Form */
                <form onSubmit={handleSignUp} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Your Full Name</label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Rahul Sharma"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Store / Brand Name</label>
                    <div className="relative">
                      <Store className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={storeName}
                        onChange={(e) => setStoreName(e.target.value)}
                        placeholder="e.g. Zenith Apparel"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="rahul@zenith.com"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Create Password</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 mt-2"
                  >
                    <span>{loading ? 'Creating Credentials...' : 'Create Account & Generate Keys'}</span>
                    <Key className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
