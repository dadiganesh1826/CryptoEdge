import React, { useState } from 'react';
import { Zap, Wifi, WifiOff, ChevronDown, LogOut, Shield, BarChart3 } from 'lucide-react';
import useAppStore from '../../store/useAppStore';

export default function Navbar() {
    const {
        isLoggedIn, user, isConnected, exchange, exchangeLabel,
        currentPrice, priceChange24h, selectedSymbolDisplay,
        wsConnected, logout, spotBalance, futuresBalance,
    } = useAppStore();

    const [showAccountMenu, setShowAccountMenu] = useState(false);

    const priceClass = priceChange24h > 0 ? 'price-up' : priceChange24h < 0 ? 'price-down' : 'price-flat';
    const spotUsdt = spotBalance?.total?.USDT || 0;
    const futUsdt = futuresBalance?.total?.USDT || futuresBalance?.total?.['USDT.P'] || 0;

    return (
        <>
            <nav className="h-16 border-b border-white/5 bg-dark-800/80 backdrop-blur-md flex items-center px-4 lg:px-6 gap-4 z-40 sticky top-0">
                {/* Logo */}
                <div className="flex items-center gap-2.5 mr-4">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center shadow-lg shadow-accent-blue/30">
                        <Zap className="w-4 h-4 text-white" />
                    </div>
                    <div className="hidden sm:block">
                        <span className="font-bold text-white tracking-tight">CryptoEdge</span>
                        <span className="text-accent-cyan text-xs ml-1 font-medium">PRO</span>
                    </div>
                </div>

                {/* Price ticker (center) */}
                {isConnected && currentPrice && (
                    <div className="hidden md:flex items-center gap-4 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-white/40 text-sm font-medium">{selectedSymbolDisplay}</span>
                            <span className="text-white font-bold text-lg font-mono animate-price-tick">
                                ${currentPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className={`text-sm font-semibold ${priceClass}`}>
                                {priceChange24h >= 0 ? '+' : ''}{priceChange24h?.toFixed(2)}%
                            </span>
                        </div>
                    </div>
                )}

                <div className="ml-auto flex items-center gap-3">
                    {/* WS status */}
                    {isConnected && (
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${wsConnected ? 'text-success' : 'text-danger'}`}>
                            {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                            <span className="hidden sm:block">{wsConnected ? 'Live' : 'Connecting'}</span>
                            {wsConnected && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
                        </div>
                    )}

                    {/* Balances */}
                    {isConnected && (
                        <div className="hidden md:flex items-center gap-2">
                            {spotUsdt > 0 && (
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-dark-700/50 rounded-lg border border-white/5">
                                    <span className="text-[10px] text-white/40 uppercase font-medium">Spot</span>
                                    <span className="text-xs font-mono font-bold text-white">${spotUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {futUsdt > 0 && (
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-dark-700/50 rounded-lg border border-white/5">
                                    <span className="text-[10px] text-accent-cyan/80 uppercase font-medium">Futures</span>
                                    <span className="text-xs font-mono font-bold text-white">${futUsdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {isConnected ? (
                        /* Account menu */
                        <div className="relative">
                            <button
                                onClick={() => setShowAccountMenu(!showAccountMenu)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-dark-700 border border-white/8 hover:border-white/20 transition-all"
                            >
                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent-indigo to-accent-cyan flex items-center justify-center text-xs font-bold text-white">
                                    {exchange?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <span className="hidden sm:block text-sm font-medium text-white/70 max-w-24 truncate">
                                    {exchangeLabel || exchange}
                                </span>
                                <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                            </button>

                            {showAccountMenu && (
                                <div className="absolute right-0 top-full mt-2 w-52 card-glass p-2 animate-fade-in z-50">
                                    <div className="px-3 py-2 border-b border-white/8 mb-2">
                                        <p className="text-[10px] text-white/30 truncate mb-1">{user?.email}</p>
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-3.5 h-3.5 text-success" />
                                            <span className="text-xs text-success font-semibold">AES-256 Secured</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => { logout(); setShowAccountMenu(false); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-danger/80 hover:bg-danger/10 transition-colors"
                                    >
                                        <LogOut className="w-4 h-4" />
                                        Sign Out
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            {isLoggedIn && (
                                <span className="text-xs text-white/30 hidden lg:block mr-2">{user?.email}</span>
                            )}
                            <button
                                onClick={() => { logout(); }}
                                className="p-2 text-white/30 hover:text-danger transition-colors"
                                title="Sign Out"
                            >
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            </nav>
        </>
    );
}
