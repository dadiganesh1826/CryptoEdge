import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Shield, Zap, TrendingUp, Globe } from 'lucide-react';
import useAppStore from '../store/useAppStore';
import apiClient from '../api/client';

export default function Login() {
    const navigate = useNavigate();
    const setLogin = useAppStore((s) => s.setLogin);
    const [error, setError] = useState('');

    const handleGoogleSuccess = async (credentialResponse) => {
        setError('');
        try {
            const res = await apiClient.post('/auth/google', {
                credential: credentialResponse.credential,
            });

            if (res.status === 200) {
                setLogin(res.data);
                if (res.data.connected) {
                    navigate('/');
                } else {
                    navigate('/connect');
                }
            }
        } catch (err) {
            console.error('Login failed:', err);
            setError(err.response?.data?.detail || 'Login failed. Please try again.');
        }
    };

    const handleGoogleError = () => {
        setError('Google Sign-In was cancelled or failed. Please try again.');
    };

    return (
        <div className="min-h-screen bg-dark-950 flex items-center justify-center p-6 overflow-hidden relative">
            {/* Background blur effects */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent-cyan/10 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-purple/10 rounded-full blur-[120px]" />

            <div className="max-w-md w-full relative z-10 flex flex-col gap-8">
                {/* Logo Section */}
                <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-16 h-16 bg-gradient-to-tr from-accent-cyan to-accent-purple rounded-2xl flex items-center justify-center shadow-lg shadow-accent-cyan/20">
                        <Zap className="w-8 h-8 text-white fill-white" />
                    </div>
                    <h1 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">
                        CryptoEdge <span className="text-accent-cyan">PRO</span>
                    </h1>
                    <p className="text-white/40 text-sm max-w-xs font-medium leading-relaxed">
                        Institutional-grade trading with recursive strategy bots and persistent history.
                    </p>
                </div>

                {/* Login Card */}
                <div className="bg-dark-900/40 border border-white/5 backdrop-blur-xl rounded-3xl p-8 shadow-2xl flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-xl font-bold text-white">Welcome Back</h2>
                        <p className="text-white/30 text-xs">Sign in to resume your strategies and manage your portfolio.</p>
                    </div>

                    {/* Real Google Sign-In Button */}
                    <div className="flex justify-center">
                        <GoogleLogin
                            onSuccess={handleGoogleSuccess}
                            onError={handleGoogleError}
                            theme="filled_black"
                            size="large"
                            width="350"
                            text="continue_with"
                            shape="pill"
                        />
                    </div>

                    {error && (
                        <div className="bg-danger/10 border border-danger/20 rounded-xl px-4 py-3">
                            <p className="text-xs text-danger">{error}</p>
                        </div>
                    )}

                    {/* Features grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            { icon: Shield, label: '7-Day Session', color: 'text-success' },
                            { icon: Globe, label: 'Encrypted Keys', color: 'text-accent-cyan' },
                            { icon: Zap, label: 'Instant Sync', color: 'text-yellow-400' },
                            { icon: TrendingUp, label: 'Live Strategy', color: 'text-accent-purple' },
                        ].map(({ icon: Icon, label, color }) => (
                            <div key={label} className="bg-white/5 rounded-xl p-3 flex flex-col gap-2 border border-white/5">
                                <Icon className={`w-4 h-4 ${color}`} />
                                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="text-center">
                    <p className="text-white/20 text-[10px] font-bold uppercase tracking-[0.2em]">
                        Trusted by 5,000+ Recursive Traders
                    </p>
                </div>
            </div>
        </div>
    );
}
