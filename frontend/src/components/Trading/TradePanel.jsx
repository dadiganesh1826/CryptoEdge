import React, { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, DollarSign, Sliders, AlertTriangle, Loader2 } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { placeOrder } from '../../api/client';

export default function TradePanel() {
    const { userId, currentPrice, selectedSymbol, selectedSymbolDisplay, tradeMode, setTradeMode, tradeSide, setTradeSide, addOrder, spotBalance, futuresBalance } = useAppStore();

    const [orderType, setOrderType] = useState('limit');
    const [price, setPrice] = useState('');
    const [amount, setAmount] = useState('');
    const [leverage, setLeverage] = useState(10);
    const [takeProfit, setTakeProfit] = useState('');
    const [stopLoss, setStopLoss] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const entryPrice = parseFloat(price) || currentPrice || 0;
    const entryAmount = parseFloat(amount) || 0;
    const effectiveLeverage = tradeMode === 'spot' ? 1 : leverage;
    const positionSize = entryAmount * effectiveLeverage;
    const quantity = entryPrice > 0 ? (positionSize / entryPrice).toFixed(6) : '0';
    const liqPrice =
        tradeSide === 'buy'
            ? (entryPrice * (1 - 1 / leverage)).toFixed(2)
            : (entryPrice * (1 + 1 / leverage)).toFixed(2);

    const handleTrade = async () => {
        if (!userId) return;
        if (!price && orderType === 'limit') return;
        if (!amount) return;

        // Balance Validation
        const quoteCurrency = selectedSymbolDisplay?.split('/')[1] || 'USDT';
        const baseCurrency = selectedSymbolDisplay?.split('/')[0] || 'BTC';
        const isBuy = tradeSide === 'buy';
        const reqAmount = parseFloat(amount);
        const reqPrice = parseFloat(price) || currentPrice || 1;

        if (tradeMode === 'spot' && !isBuy) {
            const availBase = spotBalance?.free?.[baseCurrency] || 0;
            const neededBase = reqAmount / reqPrice;
            if (availBase < neededBase) {
                return setResult({ success: false, msg: `Insufficient ${baseCurrency} balance. Needed: ${neededBase.toFixed(4)}` });
            }
        } else {
            const activeBalance = tradeMode === 'spot' ? spotBalance : futuresBalance;
            const availQuote = activeBalance?.free?.[quoteCurrency] || 0;
            if (availQuote < reqAmount) {
                return setResult({ success: false, msg: `Insufficient ${quoteCurrency} balance. Needed: ${reqAmount}` });
            }
        }

        setLoading(true);
        setResult(null);
        try {
            const data = await placeOrder({
                user_id: userId,
                symbol: selectedSymbol,
                side: tradeSide,
                order_type: orderType,
                trade_type: tradeMode,
                price: parseFloat(price) || currentPrice,
                amount: parseFloat(amount),
                quantity: parseFloat(quantity),
                leverage: effectiveLeverage,
                take_profit: parseFloat(takeProfit) || null,
                stop_loss: parseFloat(stopLoss) || null,
            });
            addOrder(data);
            setResult({ success: true, msg: `Order placed — ID: ${data.exchange_order_id || data.id?.slice(0, 8)}` });
            setPrice('');
            setAmount('');
            setTakeProfit('');
            setStopLoss('');
        } catch (err) {
            setResult({ success: false, msg: err.response?.data?.detail || 'Order failed' });
        } finally {
            setLoading(false);
        }
    };

    const isBuy = tradeSide === 'buy';

    return (
        <div className="card h-full flex flex-col">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white/70 mb-3">Place Order</h3>

                {/* Spot / Futures toggle */}
                <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-0.5 mb-3">
                    {['spot', 'futures'].map((m) => (
                        <button
                            key={m}
                            onClick={() => setTradeMode(m)}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md capitalize transition-all ${tradeMode === m ? 'bg-dark-500 text-white' : 'text-white/30 hover:text-white/60'
                                }`}
                        >
                            {m}
                        </button>
                    ))}
                </div>

                {/* Buy / Sell toggle */}
                <div className="grid grid-cols-2 gap-1.5">
                    <button
                        onClick={() => setTradeSide('buy')}
                        className={`py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${isBuy
                            ? 'bg-success text-white shadow-lg shadow-success/20'
                            : 'bg-success/10 text-success/60 hover:bg-success/20'
                            }`}
                    >
                        <ArrowUpRight className="w-4 h-4" /> Buy / Long
                    </button>
                    <button
                        onClick={() => setTradeSide('sell')}
                        className={`py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${!isBuy
                            ? 'bg-danger text-white shadow-lg shadow-danger/20'
                            : 'bg-danger/10 text-danger/60 hover:bg-danger/20'
                            }`}
                    >
                        <ArrowDownLeft className="w-4 h-4" /> Sell / Short
                    </button>
                </div>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {/* Order type */}
                <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-0.5">
                    {['limit', 'market'].map((t) => (
                        <button
                            key={t}
                            onClick={() => setOrderType(t)}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md capitalize transition-all ${orderType === t ? 'bg-dark-500 text-white' : 'text-white/30 hover:text-white/60'
                                }`}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                {/* Price */}
                {orderType === 'limit' && (
                    <div>
                        <label className="input-label">Price (USDT)</label>
                        <div className="relative">
                            <input
                                type="number"
                                className="input pr-16"
                                placeholder={currentPrice?.toFixed(2) || '0.00'}
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                            />
                            <button
                                onClick={() => setPrice(currentPrice?.toFixed(2) || '')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent-cyan hover:text-white transition-colors px-1.5 py-0.5 rounded bg-accent-cyan/10"
                            >
                                Market
                            </button>
                        </div>
                    </div>
                )}

                {/* Amount */}
                <div>
                    <label className="input-label">Amount (USDT)</label>
                    <input
                        type="number"
                        className="input"
                        placeholder="100"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                </div>

                {/* Leverage (futures only) */}
                {tradeMode === 'futures' && (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="input-label mb-0 flex items-center gap-1"><Sliders className="w-3 h-3" /> Leverage</label>
                            <span className="text-sm font-bold text-accent-cyan">{leverage}x</span>
                        </div>
                        <input
                            type="range" min="1" max="125" value={leverage}
                            onChange={(e) => setLeverage(Number(e.target.value))}
                            className="w-full accent-cyan-400 h-1.5 rounded-full"
                        />
                        <div className="flex justify-between text-xs text-white/25 mt-1">
                            {[1, 25, 50, 100, 125].map((v) => (
                                <button key={v} onClick={() => setLeverage(v)} className="hover:text-accent-cyan transition-colors">{v}x</button>
                            ))}
                        </div>
                    </div>
                )}

                {/* TP / SL */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="input-label text-success">Take Profit</label>
                        <input
                            type="number" className="input text-success placeholder-success/30"
                            placeholder="Optional" value={takeProfit}
                            onChange={(e) => setTakeProfit(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="input-label text-danger">Stop Loss</label>
                        <input
                            type="number" className="input text-danger placeholder-danger/30"
                            placeholder="Optional" value={stopLoss}
                            onChange={(e) => setStopLoss(e.target.value)}
                        />
                    </div>
                </div>

                {/* Order info */}
                {tradeMode === 'futures' && entryAmount > 0 && entryPrice > 0 && (
                    <div className="bg-dark-700 rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex justify-between">
                            <span className="text-white/40">Position Size</span>
                            <span className="text-white font-mono font-semibold">${positionSize.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-white/40">Quantity</span>
                            <span className="text-white font-mono">{quantity}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-white/40">Liq. Price (est.)</span>
                            <span className="text-danger font-mono font-semibold">${liqPrice}</span>
                        </div>
                    </div>
                )}

                {/* Result message */}
                {result && (
                    <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.success ? 'bg-success/10 border border-success/20 text-success' : 'bg-danger/10 border border-danger/20 text-danger'
                        }`}>
                        {result.success ? '✓' : <AlertTriangle className="w-3.5 h-3.5" />}
                        {result.msg}
                    </div>
                )}
            </div>

            {/* Submit */}
            <div className="px-4 pb-4">
                <button
                    onClick={handleTrade}
                    disabled={loading || !userId}
                    className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 ${isBuy
                        ? 'bg-success hover:bg-emerald-400 text-white shadow-lg shadow-success/20'
                        : 'bg-danger hover:bg-red-400 text-white shadow-lg shadow-danger/20'
                        }`}
                >
                    {loading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Placing Order...</>
                    ) : (
                        <>{isBuy ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                            {isBuy ? 'Buy' : 'Sell'} {selectedSymbolDisplay?.split('/')[0]}</>
                    )}
                </button>
            </div>
        </div>
    );
}
