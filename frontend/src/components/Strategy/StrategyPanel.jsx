import React, { useState, useCallback } from 'react';
import { Bot, Play, StopCircle, ChevronDown, ChevronUp, Loader2, AlertTriangle, Check } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { createStrategy, stopStrategy } from '../../api/client';

// Pure calculation — exported for reuse
export function calcLadderLevels(basePrice, dropPct, levels) {
    const result = [];
    let price = parseFloat(basePrice);
    const drop = parseFloat(dropPct);
    const n = parseInt(levels);
    if (!price || !drop || !n || price <= 0 || drop <= 0 || n < 1) return result;
    for (let i = 1; i <= Math.min(n, 50); i++) {
        result.push({ level: i, price: parseFloat(price.toFixed(6)) });
        price = price * (1 - drop / 100);
    }
    return result;
}

export default function StrategyPanel() {
    const { userId, selectedSymbol, selectedSymbolDisplay, addStrategy, strategies, updateStrategyStatus } = useAppStore();

    const [basePrice, setBasePrice] = useState('');
    const [dropPct, setDropPct] = useState('3');
    const [levels, setLevels] = useState('5');
    const [amount, setAmount] = useState('100');
    const [leverage, setLeverage] = useState('10');
    const [side, setSide] = useState('buy');
    const [tradeType, setTradeType] = useState('futures');
    const [takeProfit, setTakeProfit] = useState('');
    const [stopLoss, setStopLoss] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [previewOpen, setPreviewOpen] = useState(true);

    const preview = calcLadderLevels(basePrice, dropPct, levels);
    const activeStrategies = strategies.filter((s) => s.status === 'active');

    const handleStart = async () => {
        if (!userId) { setError('Not connected to exchange'); return; }
        if (!basePrice || !dropPct || !levels || !amount) { setError('Fill all required fields'); return; }
        setLoading(true);
        setError('');
        setSuccess('');
        try {
            const data = await createStrategy({
                user_id: userId,
                symbol: selectedSymbol,
                base_price: parseFloat(basePrice),
                drop_percentage: parseFloat(dropPct),
                levels: parseInt(levels),
                amount_per_order: parseFloat(amount),
                leverage: parseInt(leverage),
                side,
                order_type: tradeType,
                take_profit: parseFloat(takeProfit) || null,
                stop_loss: parseFloat(stopLoss) || null,
            });
            addStrategy(data);
            setSuccess(`Strategy started! ${data.levels} levels of ${dropPct}% drop on ${selectedSymbolDisplay}`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to start strategy');
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async (id) => {
        try {
            await stopStrategy(id);
            updateStrategyStatus(id, 'cancelled');
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="card h-full flex flex-col">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-white/5 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-indigo to-accent-purple flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white">Ladder Bot</h3>
                    <p className="text-[10px] text-white/35">Sequential order strategy</p>
                </div>
                {activeStrategies.length > 0 && (
                    <span className="ml-auto badge-green">{activeStrategies.length} active</span>
                )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {/* Side + Type */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="input-label">Direction</label>
                        <div className="flex gap-1 bg-dark-700 rounded-lg p-0.5">
                            {['buy', 'sell'].map((s) => (
                                <button key={s}
                                    onClick={() => setSide(s)}
                                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md capitalize transition-all ${side === s
                                            ? s === 'buy' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                                            : 'text-white/30 hover:text-white/50'
                                        }`}
                                >{s}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="input-label">Type</label>
                        <div className="flex gap-1 bg-dark-700 rounded-lg p-0.5">
                            {['futures', 'spot'].map((t) => (
                                <button key={t}
                                    onClick={() => setTradeType(t)}
                                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md capitalize transition-all ${tradeType === t ? 'bg-dark-500 text-white' : 'text-white/30 hover:text-white/50'
                                        }`}
                                >{t}</button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* First order price */}
                <div>
                    <label className="input-label">First Order Price (USDT) <span className="text-danger">*</span></label>
                    <input type="number" className="input" placeholder="e.g. 70000"
                        value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
                </div>

                {/* Drop % */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <label className="input-label mb-0">Drop % per Level <span className="text-danger">*</span></label>
                        <span className="text-accent-cyan font-bold text-sm">{dropPct}%</span>
                    </div>
                    <input type="number" className="input" placeholder="3" step="0.1" min="0.1" max="50"
                        value={dropPct} onChange={(e) => setDropPct(e.target.value)} />
                </div>

                {/* Levels */}
                <div>
                    <label className="input-label">Number of Levels <span className="text-danger">*</span></label>
                    <input type="number" className="input" placeholder="5" min="1" max="100"
                        value={levels} onChange={(e) => setLevels(e.target.value)} />
                </div>

                {/* Amount + Leverage */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="input-label">Amount/Order (USDT)</label>
                        <input type="number" className="input" placeholder="100"
                            value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div>
                        <label className="input-label">Leverage</label>
                        <input type="number" className="input" min="1" max="125" placeholder="10"
                            value={leverage} onChange={(e) => setLeverage(e.target.value)} />
                    </div>
                </div>

                {/* TP / SL */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="input-label text-success">Take Profit</label>
                        <input type="number" className="input text-success placeholder-success/30"
                            placeholder="Optional" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
                    </div>
                    <div>
                        <label className="input-label text-danger">Stop Loss</label>
                        <input type="number" className="input text-danger placeholder-danger/30"
                            placeholder="Optional" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
                    </div>
                </div>

                {/* ── Ladder Preview ── */}
                {preview.length > 0 && (
                    <div className="border border-white/8 rounded-xl overflow-hidden">
                        <button
                            onClick={() => setPreviewOpen(!previewOpen)}
                            className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-700/50 hover:bg-dark-700 transition-colors"
                        >
                            <span className="text-xs font-semibold text-white/60">
                                Ladder Preview — {preview.length} Levels
                            </span>
                            {previewOpen ? <ChevronUp className="w-3.5 h-3.5 text-white/40" /> : <ChevronDown className="w-3.5 h-3.5 text-white/40" />}
                        </button>

                        {previewOpen && (
                            <div className="max-h-48 overflow-y-auto">
                                <div className="px-3 py-2 space-y-1">
                                    {preview.map((row, i) => (
                                        <div key={row.level} className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${i === 0 ? 'bg-accent-cyan/8 border border-accent-cyan/15' : 'bg-white/[0.02]'
                                            }`}>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center ${i === 0 ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-white/5 text-white/30'
                                                    }`}>{row.level}</span>
                                                <span className="text-xs text-white/50">Level {row.level}</span>
                                            </div>
                                            <span className="text-xs font-mono font-semibold text-white">
                                                ${row.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="px-3 pb-2 pt-1 border-t border-white/5 flex justify-between text-[10px] text-white/30">
                                    <span>Total Cost: ${(parseFloat(amount || 0) * parseInt(levels || 0)).toLocaleString()}</span>
                                    <span>Each: ${parseFloat(amount || 0).toLocaleString()} @ {leverage}x</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Active strategies list */}
                {activeStrategies.length > 0 && (
                    <div className="border border-success/15 bg-success/5 rounded-xl p-3">
                        <p className="text-xs font-semibold text-success mb-2 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            Active Strategies
                        </p>
                        <div className="space-y-2">
                            {activeStrategies.map((s) => (
                                <div key={s.id} className="flex items-center justify-between">
                                    <div>
                                        <span className="text-xs font-medium text-white/70">{s.symbol?.split(':')[0]}</span>
                                        <span className="text-xs text-white/30 ml-2">Level {s.current_level}/{s.levels}</span>
                                    </div>
                                    <button
                                        onClick={() => handleStop(s.id)}
                                        className="p-1 rounded-lg hover:bg-danger/20 text-white/30 hover:text-danger transition-colors"
                                    >
                                        <StopCircle className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Error / Success */}
                {error && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-danger/10 border border-danger/20 rounded-xl text-xs text-danger">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                    </div>
                )}
                {success && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-success/10 border border-success/20 rounded-xl text-xs text-success">
                        <Check className="w-3.5 h-3.5 shrink-0" /> {success}
                    </div>
                )}
            </div>

            {/* CTA */}
            <div className="px-4 pb-4">
                <button
                    onClick={handleStart}
                    disabled={loading || !userId || !basePrice}
                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 bg-gradient-to-r from-accent-indigo to-accent-purple hover:from-accent-purple hover:to-accent-indigo text-white shadow-lg shadow-accent-indigo/20"
                >
                    {loading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Starting...</>
                    ) : (
                        <><Play className="w-4 h-4" /> Start Ladder Bot</>
                    )}
                </button>
            </div>
        </div>
    );
}
