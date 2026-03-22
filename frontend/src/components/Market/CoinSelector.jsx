import React, { useState, useEffect } from 'react';
import { Search, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { getMarkets } from '../../api/client';

const POPULAR = [
    'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT', 'BNB/USDT:USDT',
    'ARB/USDT:USDT', 'MATIC/USDT:USDT', 'AVAX/USDT:USDT', 'DOGE/USDT:USDT',
];

export default function CoinSelector() {
    const { selectedSymbol, selectedSymbolDisplay, setSelectedSymbol, currentPrice, priceChange24h, isConnected } = useAppStore();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [markets, setMarkets] = useState(POPULAR);

    useEffect(() => {
        if (isConnected) {
            getMarkets().then((d) => {
                if (d?.symbols?.length) setMarkets(d.symbols);
            }).catch(() => { });
        }
    }, [isConnected]);

    const filtered = markets.filter((s) =>
        s.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 20);

    const handleSelect = (symbol) => {
        setSelectedSymbol(symbol);
        setOpen(false);
        setSearch('');
    };

    const changeColor = priceChange24h >= 0 ? 'text-success' : 'text-danger';
    const ChangIcon = priceChange24h >= 0 ? TrendingUp : TrendingDown;

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-3 px-4 py-3 card hover:border-white/15 transition-all group"
            >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-blue/30 to-accent-cyan/30 flex items-center justify-center text-xs font-bold text-white">
                    {selectedSymbolDisplay?.split('/')[0]?.[0] || 'B'}
                </div>
                <div className="text-left">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{selectedSymbolDisplay}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                    {currentPrice && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-white/70">
                                ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className={`text-xs font-semibold flex items-center gap-0.5 ${changeColor}`}>
                                <ChangIcon className="w-3 h-3" />
                                {priceChange24h >= 0 ? '+' : ''}{priceChange24h?.toFixed(2)}%
                            </span>
                        </div>
                    )}
                </div>
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-2 w-64 card-glass z-50 animate-slide-up overflow-hidden">
                    {/* Search */}
                    <div className="p-2 border-b border-white/8">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search pairs..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-8 pr-3 py-2 bg-dark-700 rounded-lg text-sm text-white placeholder-white/25 outline-none border border-white/5 focus:border-accent-cyan/30"
                            />
                        </div>
                    </div>

                    {/* List */}
                    <div className="max-h-64 overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <p className="text-center text-white/30 text-xs py-4">No markets found</p>
                        ) : (
                            filtered.map((sym) => (
                                <button
                                    key={sym}
                                    onClick={() => handleSelect(sym)}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/5 transition-colors text-left ${sym === selectedSymbol ? 'bg-accent-cyan/10 text-accent-cyan' : 'text-white/70'
                                        }`}
                                >
                                    <span className="text-sm font-medium">{sym.split(':')[0]}</span>
                                    {sym === selectedSymbol && (
                                        <span className="text-xs text-accent-cyan">●</span>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
