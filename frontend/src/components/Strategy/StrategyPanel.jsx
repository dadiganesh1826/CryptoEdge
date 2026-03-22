import React, { useState, useCallback, useEffect } from 'react';
import { Bot, Play, StopCircle, ChevronDown, ChevronUp, Loader2, AlertTriangle, Check, Plus, Trash2, Zap } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { createStrategy, stopStrategy } from '../../api/client';

// Pure calculation — exported for reuse
export function calcLadderLevels(basePrice, dropPct, levels, isAdvanced, customLevels) {
    if (isAdvanced) {
        const result = [];
        let lastPrice = parseFloat(basePrice) || 0;

        customLevels.forEach((l, i) => {
            let price = 0;
            const val = parseFloat(l.value) || 0;
            if (l.type === 'percent') {
                price = lastPrice * (1 - val / 100);
            } else {
                price = val;
            }

            if (price > 0) {
                result.push({
                    level: i + 1,
                    price: parseFloat(price.toFixed(6)),
                    amount: parseFloat(l.amount) || 0,
                    type: l.type,
                    inputValue: l.value
                });
                lastPrice = price;
            }
        });
        return result;
    }
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
    const { userId, selectedSymbol, selectedSymbolDisplay, addStrategy, strategies, updateStrategyStatus, currentPrice } = useAppStore();

    const [isAdvanced, setIsAdvanced] = useState(false);
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

    const [customLevels, setCustomLevels] = useState([
        { type: 'price', value: '', amount: '100' },
        { type: 'percent', value: '3', amount: '200' }
    ]);

    useEffect(() => {
        if (currentPrice && !basePrice) {
            setBasePrice(currentPrice.toString());
            // Sync first level price if empty
            if (customLevels[0].type === 'price' && !customLevels[0].value) {
                const newLevels = [...customLevels];
                newLevels[0].value = currentPrice.toString();
                setCustomLevels(newLevels);
            }
        }
    }, [currentPrice, basePrice, customLevels]);

    const preview = calcLadderLevels(basePrice, dropPct, levels, isAdvanced, customLevels);
    const activeStrategies = strategies.filter((s) => s.status === 'active');

    const handleStart = async () => {
        if (!userId) { setError('Not connected to exchange'); return; }

        let levels_config = null;
        if (isAdvanced) {
            levels_config = customLevels.map(l => {
                const cfg = { amount: parseFloat(l.amount) };
                if (l.type === 'percent') cfg.drop = parseFloat(l.value);
                else cfg.price = parseFloat(l.value);
                return cfg;
            }).filter(l => (l.drop > 0 || l.price > 0));

            if (levels_config.length === 0) { setError('Add at least one valid level'); return; }
        } else {
            if (!basePrice || !dropPct || !levels || !amount) { setError('Fill all required fields'); return; }
        }

        setLoading(true);
        setError('');
        setSuccess('');
        try {
            const data = await createStrategy({
                user_id: userId,
                symbol: selectedSymbol,
                base_price: isAdvanced ? (customLevels[0].type === 'price' ? parseFloat(customLevels[0].value) : parseFloat(basePrice)) : parseFloat(basePrice),
                drop_percentage: isAdvanced ? 0 : parseFloat(dropPct),
                levels: isAdvanced ? levels_config.length : parseInt(levels),
                amount_per_order: isAdvanced ? parseFloat(customLevels[0].amount) : parseFloat(amount),
                leverage: parseInt(leverage),
                side,
                order_type: tradeType,
                take_profit: parseFloat(takeProfit) || null,
                stop_loss: parseFloat(stopLoss) || null,
                levels_config
            });
            addStrategy(data);
            setSuccess(`Strategy started! ${data.levels} levels placed on ${selectedSymbolDisplay}`);
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

    const addLevel = () => {
        const lastLevel = customLevels[customLevels.length - 1];
        setCustomLevels([...customLevels, {
            type: lastLevel?.type || 'percent',
            value: lastLevel?.type === 'percent' ? lastLevel.value : '',
            amount: lastLevel?.amount || '100'
        }]);
    };

    const removeLevel = (index) => {
        if (customLevels.length <= 1) return;
        setCustomLevels(customLevels.filter((_, i) => i !== index));
    };

    const updateLevel = (index, field, value) => {
        const newLevels = [...customLevels];
        newLevels[index][field] = value;
        setCustomLevels(newLevels);
    };

    const toggleLevelType = (index) => {
        const newLevels = [...customLevels];
        const oldType = newLevels[index].type;
        newLevels[index].type = oldType === 'price' ? 'percent' : 'price';
        // Reset or convert value if possible? 
        // For now just toggle and let user enter.
        if (newLevels[index].type === 'percent' && !newLevels[index].value) newLevels[index].value = '3';
        setCustomLevels(newLevels);
    };

    const applyMartingale = () => {
        const startAmount = parseFloat(amount) || 100;
        const startPrice = parseFloat(basePrice) || currentPrice || 50000;
        const num = parseInt(levels) || 5;
        const drop = parseFloat(dropPct) || 3;

        const newLevels = [];
        for (let i = 0; i < num; i++) {
            if (i === 0) {
                newLevels.push({ type: 'price', value: startPrice.toString(), amount: startAmount.toString() });
            } else {
                newLevels.push({ type: 'percent', value: drop.toString(), amount: (startAmount * Math.pow(2, i)).toString() });
            }
        }
        setCustomLevels(newLevels);
        setIsAdvanced(true);
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

                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={() => setIsAdvanced(!isAdvanced)}
                        className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all border ${isAdvanced ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan' : 'bg-white/5 border-white/10 text-white/30'
                            }`}
                    >
                        {isAdvanced ? 'Advanced' : 'Basic'}
                    </button>
                    {activeStrategies.length > 0 && (
                        <span className="badge-green">{activeStrategies.length} active</span>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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

                {!isAdvanced ? (
                    <>
                        {/* Basic Mode Inputs */}
                        <div>
                            <label className="input-label">Start Price (USDT) <span className="text-danger">*</span></label>
                            <input type="number" className="input" placeholder="e.g. 70000"
                                value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="input-label">Drop % / Level</label>
                                <input type="number" className="input" placeholder="3" step="0.1"
                                    value={dropPct} onChange={(e) => setDropPct(e.target.value)} />
                            </div>
                            <div>
                                <label className="input-label">Num Levels</label>
                                <input type="number" className="input" placeholder="5"
                                    value={levels} onChange={(e) => setLevels(e.target.value)} />
                            </div>
                        </div>

                        <div>
                            <label className="input-label">Amount per Order (USDT)</label>
                            <div className="relative">
                                <input type="number" className="input pr-12" placeholder="100"
                                    value={amount} onChange={(e) => setAmount(e.target.value)} />
                                <button
                                    onClick={applyMartingale}
                                    title="Convert to Martingale Advanced Strategy"
                                    className="absolute right-2 top-1.5 p-1 rounded hover:bg-accent-indigo/20 text-accent-indigo transition-colors"
                                >
                                    <Zap className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="input-label mb-0">Custom Levels Config</label>
                            <button onClick={addLevel} className="flex items-center gap-1 text-[10px] font-bold text-accent-cyan hover:text-accent-cyan/80">
                                <Plus className="w-3 h-3" /> ADD LEVEL
                            </button>
                        </div>
                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                            {customLevels.map((lvl, idx) => (
                                <div key={idx} className="bg-white/[0.03] p-1.5 rounded-lg border border-white/5 flex flex-col gap-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-md bg-dark-600 flex items-center justify-center text-[9px] font-black text-white/20">
                                            {idx + 1}
                                        </div>
                                        <div className="flex bg-dark-800 rounded p-0.5 shrink-0">
                                            <button
                                                onClick={() => updateLevel(idx, 'type', 'price')}
                                                className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${lvl.type === 'price' ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-white/20'}`}
                                            >$</button>
                                            <button
                                                onClick={() => updateLevel(idx, 'type', 'percent')}
                                                className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${lvl.type === 'percent' ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-white/20'}`}
                                            >%</button>
                                        </div>
                                        <input
                                            type="number" className="input h-7 text-[10px] px-1.5 flex-1 min-w-[60px]"
                                            placeholder={lvl.type === 'price' ? "Price" : "Drop %"}
                                            value={lvl.value} onChange={(e) => updateLevel(idx, 'value', e.target.value)}
                                        />
                                        <div className="text-[9px] text-white/20 font-bold">AMT</div>
                                        <input
                                            type="number" className="input h-7 text-[10px] px-1.5 w-16"
                                            placeholder="Sum"
                                            value={lvl.amount} onChange={(e) => updateLevel(idx, 'amount', e.target.value)}
                                        />
                                        <button onClick={() => removeLevel(idx)} className="p-1 rounded hover:bg-danger/10 text-danger/30 hover:text-danger">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                    {lvl.type === 'percent' && preview[idx] && (
                                        <div className="flex items-center justify-between px-1">
                                            <div className="text-[9px] font-medium text-white/20">Estimated Entry:</div>
                                            <div className="text-[10px] font-mono font-bold text-accent-cyan">
                                                ${preview[idx].price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Shared Config */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="input-label">Leverage</label>
                        <input type="number" className="input" min="1" max="125" placeholder="10"
                            value={leverage} onChange={(e) => setLeverage(e.target.value)} />
                    </div>
                    <div>
                        <label className="input-label text-success">Take Profit</label>
                        <input type="number" className="input text-success placeholder-success/30"
                            placeholder="Optional" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
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
                                {isAdvanced ? 'Custom Preview' : 'Ladder Preview'} — {preview.length} Levels
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
                                                <span className="text-xs text-white/50">${isAdvanced ? row.amount : (amount || 0)}</span>
                                            </div>
                                            <span className="text-xs font-mono font-semibold text-white">
                                                ${row.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="px-3 pb-2 pt-1 border-t border-white/5 flex justify-between text-[10px] text-white/30">
                                    <span>Total Value: ${preview.reduce((acc, l) => acc + (isAdvanced ? (parseFloat(l.amount) || 0) : parseFloat(amount || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    <span>Margin: ${(preview.reduce((acc, l) => acc + (isAdvanced ? (parseFloat(l.amount) || 0) : parseFloat(amount || 0)), 0) / (tradeType === 'spot' ? 1 : (parseFloat(leverage) || 1))).toFixed(2)} USDT</span>
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
                                        <span className="text-xs text-white/30 ml-2">L{s.current_level}/{s.levels}</span>
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
                    disabled={loading || !userId || (!isAdvanced && !basePrice)}
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
