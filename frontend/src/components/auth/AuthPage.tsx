import React, { useState } from 'react';
import {
  ShieldCheck,
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
  CheckCircle2,
  TrendingUp,
  Zap,
  Truck,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  loginMerchant,
  signupMerchant,
  demoJudgeLogin,
  MerchantUser,
  MerchantProfile,
  ApiKeyItem,
} from '../../services/authApi';

interface AuthPageProps {
  onAuthSuccess: (user: MerchantUser, merchant: MerchantProfile, keys?: ApiKeyItem[]) => void;
  onContinueAsGuest?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  onAuthSuccess,
  onContinueAsGuest,
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
  const [showPassword, setShowPassword] = useState(false);

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
      } else {
        onAuthSuccess(res.user, res.merchant);
      }
    } catch (err: any) {
      setError(err.message || 'Signup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4 sm:p-6 lg:p-10 relative overflow-hidden font-sans">
      {/* Background Decorative Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/15 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-purple-600/15 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-xl overflow-hidden z-10">
        {/* Left Hero Column */}
        <div className="lg:col-span-5 p-8 sm:p-10 bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
          <div>
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
                  RTOGuard <span className="text-[10px] bg-indigo-500/30 text-indigo-300 font-bold px-1.5 py-0.5 rounded border border-indigo-400/30">AI</span>
                </span>
                <span className="text-[11px] text-slate-400 block -mt-0.5">RTO Risk & Profit Intelligence</span>
              </div>
            </div>

            {/* Tagline */}
            <div className="mt-8 space-y-3">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white leading-tight">
                Stop RTO Leakage Before Dispatching Orders.
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Production-ready risk scoring API and merchant dashboard for Indian D2C brands. Dynamically gates Cash on Delivery with trained CatBoost intelligence.
              </p>
            </div>

            {/* Feature Highlights */}
            <div className="mt-8 space-y-3.5">
              <div className="flex items-start gap-3 text-xs text-slate-300">
                <div className="h-6 w-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-white block font-semibold">Real-Time Scoring API</strong>
                  <span className="text-[11px] text-slate-400">Sub-50ms inference with local SHAP feature explainability.</span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs text-slate-300">
                <div className="h-6 w-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-white block font-semibold">Dynamic COD & Prepaid Incentives</strong>
                  <span className="text-[11px] text-slate-400">Charge verification fees or offer instant discounts for high-risk orders.</span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs text-slate-300">
                <div className="h-6 w-6 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Truck className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-white block font-semibold">NDR Smart Recovery</strong>
                  <span className="text-[11px] text-slate-400">Automated WhatsApp reattempts to rescue doorstep failures.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <span>Production ML • 29k+ PIN codes</span>
            <span className="text-emerald-400 flex items-center gap-1 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Engine
            </span>
          </div>
        </div>

        {/* Right Form Column */}
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center bg-slate-900">
          <div className="max-w-md mx-auto w-full space-y-6">
            {/* Hackathon Judge 1-Click Fast Pass Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-900/40 via-purple-900/40 to-slate-900 border border-indigo-500/40 shadow-lg relative overflow-hidden group">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500 text-white tracking-wide uppercase shadow-sm">
                      Judge Access
                    </span>
                    <span className="text-xs font-bold text-white">1-Click Evaluation Fast Pass</span>
                  </div>
                  <p className="text-[11px] text-indigo-200/80 mt-1.5 leading-relaxed">
                    Instantly load the full merchant dashboard with active demo credentials and test API keys. Zero typing required.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleJudgeDemoClick}
                  disabled={loading}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>{loading ? 'Entering...' : '1-Click Login'}</span>
                </button>
              </div>
            </div>

            {/* Keys Issued Success View */}
            {issuedKeys ? (
              <div className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 space-y-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <h3 className="text-xs font-bold text-white">Merchant Account Created Successfully!</h3>
                    <p className="text-[11px] text-emerald-300/80">
                      Here are your freshly generated API keys. Keep your secret key safe!
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5 font-mono text-xs">
                  {issuedKeys.map((k) => (
                    <div key={k.id} className="p-3 rounded-xl bg-slate-950/80 border border-emerald-500/30 shadow-sm">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <span className="font-semibold uppercase tracking-wider text-slate-300">
                          {k.type === 'public' ? 'Public Key (Browser)' : 'Secret Key (Server)'}
                        </span>
                        <button
                          onClick={() => handleCopy(k.key || '', k.id)}
                          className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-sans text-xs font-medium"
                        >
                          {copiedKeyId === k.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-200 truncate select-all font-mono">
                        {k.key || `${k.prefix}...`}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const storedUser = localStorage.getItem('rtoguard_auth_user');
                    if (storedUser) {
                      const user = JSON.parse(storedUser);
                      onAuthSuccess(user, {
                        id: user.merchant_id,
                        name: user.name + "'s Store",
                        allowed_domains: [],
                        created_at: new Date().toISOString(),
                        active: true,
                        keys: issuedKeys,
                      }, issuedKeys);
                    }
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all"
                >
                  Enter Merchant Dashboard & APIs →
                </button>
              </div>
            ) : (
              <>
                {/* Form Tabs */}
                <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signin');
                      setError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      tab === 'signin'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Merchant Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signup');
                      setError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      tab === 'signup'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Create Merchant Account
                  </button>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Sign In Form */}
                {tab === 'signin' ? (
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Work Email</label>
                      <div className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="merchant@yourbrand.com"
                          className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 text-white placeholder-slate-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">Password</label>
                      <div className="relative">
                        <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 text-white placeholder-slate-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50 mt-2"
                    >
                      <span>{loading ? 'Verifying...' : 'Sign In to Dashboard'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  /* Sign Up Form */
                  <form onSubmit={handleSignUp} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Your Full Name</label>
                      <div className="relative">
                        <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Aarish Khan"
                          className="w-full pl-10 pr-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 text-white placeholder-slate-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Store / Brand Name</label>
                      <div className="relative">
                        <Store className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          value={storeName}
                          onChange={(e) => setStoreName(e.target.value)}
                          placeholder="e.g. Zenith Apparel"
                          className="w-full pl-10 pr-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 text-white placeholder-slate-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Work Email</label>
                      <div className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="aarish@zenith.com"
                          className="w-full pl-10 pr-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 text-white placeholder-slate-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Create Password</label>
                      <div className="relative">
                        <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          className="w-full pl-10 pr-10 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 text-white placeholder-slate-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50 mt-2"
                    >
                      <span>{loading ? 'Creating Credentials...' : 'Create Account & Issue Keys'}</span>
                      <Key className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </>
            )}

            {/* Guest Sandbox Option */}
            {onContinueAsGuest && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={onContinueAsGuest}
                  className="text-xs text-slate-500 hover:text-slate-300 underline font-medium transition-colors"
                >
                  Or explore dashboard in read-only sandbox mode →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
