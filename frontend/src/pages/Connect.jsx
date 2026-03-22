import React, { useState, useEffect } from 'react';
import { Zap, Shield, Activity, Bot, ChevronRight, Lock } from 'lucide-react';
import ConnectModal from '../components/Auth/ConnectModal';
import useAppStore from '../store/useAppStore';

const FEATURES = [
    { icon: Activity, title: 'Live Price Feeds', desc: 'Real-time WebSocket price updates from major exchanges', color: 'text-accent-cyan' },
    { icon: Bot, title: 'Ladder Bot', desc: 'Automated sequential order placement based on % drop logic', color: 'text-accent-indigo' },
    { icon: Shield, title: 'AES-256 Encrypted', desc: 'Your API keys are encrypted end-to-end. Never stored in plaintext', color: 'text-success' },
    { icon: Lock, title: 'No Withdrawals', desc: 'Read and trade permissions only. Withdrawal access is blocked', color: 'text-warning' },
];

export default function ConnectPage() {
    const isConnected = useAppStore((s) => s.isConnected);
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        if (isConnected) {
            window.location.href = '/';
        }
    }, [isConnected]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-dark-900 px-4 py-12 relative overflow-hidden">
            {/* Background glow orbs */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-indigo/8 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-cyan/6 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent" />

            <div className="relative z-10 max-w-2xl w-full text-center">
                {/* Logo */}
                <div className="flex items-center justify-center gap-3 mb-8">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center shadow-2xl shadow-accent-blue/30 animate-pulse-glow">
                        <Zap className="w-7 h-7 text-white" />
                    </div>
                </div>

                {/* Hero text */}
                <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-4">
                    <span className="text-white">Crypto</span>
                    <span className="gradient-text">Edge</span>
                    <span className="text-white/30 text-2xl ml-2 font-medium">PRO</span>
                </h1>
                <p className="text-lg text-white/40 max-w-md mx-auto mb-10 leading-relaxed">
                    Non-custodial trading platform with automated ladder bot strategy.
                    Connect your exchange and start trading smarter.
                </p>

                {/* CTA */}
                <button
                    onClick={() => setShowModal(true)}
                    className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-accent-blue to-accent-cyan hover:from-accent-indigo hover:to-accent-blue text-white font-bold text-base shadow-2xl shadow-accent-blue/30 transition-all duration-300 hover:scale-105 active:scale-95 mb-4"
                >
                    <Zap className="w-5 h-5" />
                    Connect Exchange
                    <ChevronRight className="w-4 h-4" />
                </button>
                <p className="text-xs text-white/25">Supports Hyperliquid · Binance · Bybit · OKX · KuCoin</p>

                {/* Feature cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-12">
                    {FEATURES.map(({ icon: Icon, title, desc, color }) => (
                        <div key={title} className="card-glass p-5 text-left hover:border-white/15 transition-all">
                            <Icon className={`w-6 h-6 mb-3 ${color}`} />
                            <h3 className="font-semibold text-white text-sm mb-1">{title}</h3>
                            <p className="text-xs text-white/35 leading-relaxed">{desc}</p>
                        </div>
                    ))}
                </div>

                <p className="text-xs text-white/15 mt-10">
                    Microservices architecture · PostgreSQL · AES-256 · JWT · WebSocket
                </p>
            </div>

            {showModal && <ConnectModal onClose={() => setShowModal(false)} />}
        </div>
    );
}
