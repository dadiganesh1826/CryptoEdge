import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, BarChart3, Layers, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import Navbar from '../components/Layout/Navbar';
import CoinSelector from '../components/Market/CoinSelector';
import TradingChart from '../components/Market/TradingChart';
import TradePanel from '../components/Trading/TradePanel';
import StrategyPanel from '../components/Strategy/StrategyPanel';
import { OrdersTable, PositionsTable, HistoryTable } from '../components/Portfolio/PortfolioTables';
import { useWebSocket } from '../hooks/useWebSocket';
import useAppStore from '../store/useAppStore';
import { getBalance } from '../api/client';

const BOTTOM_TABS = [
    { id: 'orders', label: 'Orders', icon: Layers },
    { id: 'positions', label: 'Positions', icon: BarChart3 },
    { id: 'history', label: 'History', icon: RefreshCw },
];

const RIGHT_TABS = [
    { id: 'trade', label: 'Trade', icon: BarChart3 },
    { id: 'strategy', label: 'Strategy', icon: Bot },
];

export default function Dashboard() {
    const { isConnected, isLoggedIn, userId, setSpotBalance, setFuturesBalance, currentPrice, priceChange24h, high24h, low24h, volume24h, selectedSymbolDisplay, tradeMode } = useAppStore();
    const navigate = useNavigate();
    const [bottomTab, setBottomTab] = useState('orders');
    const [rightTab, setRightTab] = useState('trade');

    useEffect(() => {
        if (isLoggedIn && !isConnected) {
            navigate('/connect');
        }
    }, [isLoggedIn, isConnected, navigate]);

    // WebSocket connection
    useWebSocket();

    // Fetch balance on connect & mode switch
    useEffect(() => {
        if (!isConnected || !userId) return;
        getBalance('spot').then((d) => setSpotBalance(d)).catch(() => { });
        getBalance('futures').then((d) => setFuturesBalance(d)).catch(() => { });
    }, [isConnected, userId]);

    const changeColor = priceChange24h >= 0 ? 'text-success' : 'text-danger';

    return (
        <div className="min-h-screen flex flex-col bg-dark-900">
            <Navbar />

            <main className="flex-1 flex flex-col gap-3 p-3 lg:p-4 max-w-screen-2xl w-full mx-auto">
                {/* Top bar: coin selector + stats */}
                <div className="flex flex-wrap items-center gap-3">
                    <CoinSelector />

                    {currentPrice && (
                        <div className="flex items-center gap-4 flex-1">
                            {/* 24h stats */}
                            {[
                                { label: '24h High', val: `$${high24h?.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, cls: 'text-success' },
                                { label: '24h Low', val: `$${low24h?.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, cls: 'text-danger' },
                                { label: 'Volume', val: `$${(volume24h / 1e6)?.toFixed(2)}M`, cls: 'text-white/60' },
                            ].map(({ label, val, cls }) => (
                                <div key={label} className="hidden lg:block">
                                    <p className="text-[10px] text-white/30 uppercase tracking-wider">{label}</p>
                                    <p className={`text-sm font-semibold font-mono ${cls}`}>{val}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Main grid */}
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 min-h-0">
                    {/* Left column: chart + bottom tables */}
                    <div className="flex flex-col gap-3">
                        {/* Chart */}
                        <div style={{ height: '380px' }}>
                            <TradingChart />
                        </div>

                        {/* Bottom tabs */}
                        <div className="card flex-1 flex flex-col min-h-0" style={{ minHeight: '220px' }}>
                            <div className="flex items-center gap-1 px-3 pt-3 pb-0 border-b border-white/5">
                                {BOTTOM_TABS.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        onClick={() => setBottomTab(id)}
                                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all -mb-px ${bottomTab === id
                                            ? 'border-accent-cyan text-accent-cyan'
                                            : 'border-transparent text-white/35 hover:text-white/60'
                                            }`}
                                    >
                                        <Icon className="w-3.5 h-3.5" /> {label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex-1 min-h-0 overflow-hidden">
                                {bottomTab === 'orders' && <OrdersTable />}
                                {bottomTab === 'positions' && <PositionsTable />}
                                {bottomTab === 'history' && <HistoryTable />}
                            </div>
                        </div>
                    </div>

                    {/* Right panel: Trade / Strategy */}
                    <div className="card flex flex-col">
                        {/* Tab header */}
                        <div className="flex items-center gap-1 px-3 pt-3 border-b border-white/5 pb-0">
                            {RIGHT_TABS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => setRightTab(id)}
                                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all -mb-px ${rightTab === id
                                        ? 'border-accent-cyan text-accent-cyan'
                                        : 'border-transparent text-white/35 hover:text-white/60'
                                        }`}
                                >
                                    <Icon className="w-3.5 h-3.5" /> {label}
                                </button>
                            ))}
                        </div>

                        {/* Panel content */}
                        <div className="flex-1 overflow-hidden">
                            {rightTab === 'trade' && <TradePanel />}
                            {rightTab === 'strategy' && <StrategyPanel />}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
