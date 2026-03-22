import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Key, AlertTriangle, X, Eye, EyeOff, Zap, Lock } from 'lucide-react';
import { connectExchange } from '../../api/client';
import useAppStore from '../../store/useAppStore';

const EXCHANGES = [
    { id: 'hyperliquid', name: 'Hyperliquid', badge: 'Recommended' },
    { id: 'binance', name: 'Binance', badge: '' },
    { id: 'bybit', name: 'Bybit', badge: '' },
    { id: 'okx', name: 'OKX', badge: '' },
];

export default function ConnectModal({ onClose }) {
    const navigate = useNavigate();
    const setAuth = useAppStore((s) => s.setAuth);
    const [exchange, setExchange] = useState('');
    const [step, setStep] = useState(1);
    const [apiKey, setApiKey] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [label, setLabel] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [showSecret, setShowSecret] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleConnect = async () => {
        if (!apiKey.trim() || !apiSecret.trim()) {
            setError('API key and secret are required');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const data = await connectExchange({
                exchange,
                api_key: apiKey.trim(),
                api_secret: apiSecret.trim(),
                label: label.trim() || `${exchange} account`,
            });
            setAuth(data);
            onClose?.();
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.detail || 'Connection failed. Check your API credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-md mx-4 card-glass p-6 animate-slide-up">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center">
                            <Zap className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Connect Exchange</h2>
                            <p className="text-xs text-white/40">Non-custodial · Read-only access</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Security notice */}
                <div className="flex items-start gap-3 bg-success/10 border border-success/20 rounded-xl px-4 py-3 mb-6">
                    <Shield className="w-4 h-4 text-success mt-0.5 shrink-0" />
                    <div>
                        <p className="text-xs font-semibold text-success">AES-256 Encrypted</p>
                        <p className="text-xs text-white/50 mt-0.5">Keys are encrypted end-to-end. We never store plaintext credentials. Withdrawal permissions are automatically blocked.</p>
                    </div>
                </div>

                {step === 1 ? (
                    /* Exchange selection */
                    <div className="space-y-3">
                        <p className="text-sm text-white/50 mb-4">Select your exchange</p>
                        {EXCHANGES.map((ex) => (
                            <button
                                key={ex.id}
                                onClick={() => { setExchange(ex.id); setStep(2); }}
                                className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-white/8 hover:border-accent-cyan/40 hover:bg-white/5 transition-all group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-dark-600 flex items-center justify-center text-sm font-bold text-white/60 group-hover:text-white transition-colors">
                                        {ex.name[0]}
                                    </div>
                                    <span className="font-medium text-white/80 group-hover:text-white transition-colors">{ex.name}</span>
                                </div>
                                {ex.badge && (
                                    <span className="badge-blue text-[10px]">{ex.badge}</span>
                                )}
                            </button>
                        ))}
                    </div>
                ) : (
                    /* API key entry */
                    <div className="space-y-4">
                        <button onClick={() => setStep(1)} className="text-xs text-white/40 hover:text-white/70 transition-colors flex items-center gap-1">
                            ← Back to exchange selection
                        </button>

                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent-blue/10 border border-accent-blue/20 rounded-lg">
                            <span className="text-sm font-semibold text-accent-blue capitalize">{exchange}</span>
                        </div>

                        <div>
                            <label className="input-label">Account Label (optional)</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="e.g. Main trading account"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="input-label flex items-center gap-1"><Key className="w-3 h-3" /> API Key</label>
                            <div className="relative">
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    className="input pr-10"
                                    placeholder="Paste your API key here"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                                >
                                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="input-label flex items-center gap-1"><Lock className="w-3 h-3" /> API Secret</label>
                            <div className="relative">
                                <input
                                    type={showSecret ? 'text' : 'password'}
                                    className="input pr-10"
                                    placeholder="Paste your API secret here"
                                    value={apiSecret}
                                    onChange={(e) => setApiSecret(e.target.value)}
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowSecret(!showSecret)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                                >
                                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-danger/10 border border-danger/20 rounded-xl">
                                <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                                <p className="text-xs text-danger">{error}</p>
                            </div>
                        )}

                        <div className="flex items-start gap-2 text-xs text-white/30">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>Ensure your API key has <strong className="text-white/50">trade permissions only</strong>. Never enable withdrawal access.</span>
                        </div>

                        <button
                            onClick={handleConnect}
                            disabled={loading || !apiKey || !apiSecret}
                            className="btn-primary w-full mt-2"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Connecting & encrypting...
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <Shield className="w-4 h-4" />
                                    Connect Securely
                                </span>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
