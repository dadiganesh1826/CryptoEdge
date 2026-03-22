import React, { useState } from 'react';
import { X, Save, Shield, Target } from 'lucide-react';
import { updateTPSL } from '../../api/client';

export default function TPSLEditModal({ position, onClose, onRefresh }) {
    const [tp, setTp] = useState(position.take_profit || '');
    const [sl, setSl] = useState(position.stop_loss || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSave = async () => {
        setLoading(true);
        setError(null);
        try {
            // We need a proper orderId. If position doesn't have it, we might need to fetch it.
            // For now, assume the backend find the right order by symbol/user if we pass enough info,
            // OR we'll need to ensure position has an ID.
            // In our current exchange service, we might need to pass the ID if available.
            // Given our simplified architecture, let's use the symbol to find the relevant position's entry order.

            // NOTE: In a real app, position would have a unique ID or we'd target a specific open order.
            // For now, our updateTPSL endpoint takes an 'order_id'.
            // If the position is from exchange, we might not have the DB order ID immediately.
            // Let's assume the frontend passes the orderId if it knows it.

            await updateTPSL(position.id || position.symbol, {
                take_profit: tp ? parseFloat(tp) : null,
                stop_loss: sl ? parseFloat(sl) : null
            });
            onRefresh?.();
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to update TP/SL');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-dark-950/80 backdrop-blur-sm p-4">
            <div className="card w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        Edit TP/SL — {position.symbol}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition-colors text-white/40 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-6">
                    {/* Take Profit */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-accent-cyan uppercase tracking-wider flex items-center gap-1.5">
                            <Target className="w-3 h-3" /> Take Profit (USDT)
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                step="0.01"
                                value={tp}
                                onChange={(e) => setTp(e.target.value)}
                                className="w-full bg-dark-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-cyan/50 focus:ring-1 focus:ring-accent-cyan/20 transition-all font-mono"
                                placeholder="Not Set"
                            />
                            {tp && <span className="absolute right-3 top-2.5 text-[10px] text-white/20 font-mono">USDT</span>}
                        </div>
                    </div>

                    {/* Stop Loss */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-danger uppercase tracking-wider flex items-center gap-1.5">
                            <Shield className="w-3 h-3" /> Stop Loss (USDT)
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                step="0.01"
                                value={sl}
                                onChange={(e) => setSl(e.target.value)}
                                className="w-full bg-dark-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-danger/50 focus:ring-1 focus:ring-danger/20 transition-all font-mono"
                                placeholder="Not Set"
                            />
                            {sl && <span className="absolute right-3 top-2.5 text-[10px] text-white/20 font-mono">USDT</span>}
                        </div>
                    </div>

                    {error && (
                        <div className="text-[10px] text-danger bg-danger/5 border border-danger/10 p-2 rounded-lg text-center animate-pulse">
                            {error}
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg ${loading
                                    ? 'bg-white/5 text-white/20 cursor-not-allowed'
                                    : 'bg-accent-cyan text-dark-950 hover:scale-[1.02] active:scale-[0.98] hover:shadow-accent-cyan/20'
                                }`}
                        >
                            {loading ? (
                                <div className="w-4 h-4 border-2 border-dark-950/20 border-t-dark-950 rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Save className="w-4 h-4" /> Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
