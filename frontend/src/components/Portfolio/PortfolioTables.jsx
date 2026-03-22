import React, { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Minus, Edit2 } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { getUserOrders, getPositions, cancelOrder as cancelOrderApi, placeOrderDirect, getOrderHistory, updateTPSL } from '../../api/client';
import TPSLEditModal from './TPSLEditModal';

// ──────────────────────────────────────────────
// Orders Table
// ──────────────────────────────────────────────
export function OrdersTable() {
    const { userId, orders, setOrders } = useAppStore();
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('all');

    const fetchOrders = async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const params = filter !== 'all' ? { status: filter } : {};
            const data = await getUserOrders(userId, params);
            setOrders(data.orders || []);
        } catch { }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 5000);
        return () => clearInterval(interval);
    }, [userId, filter]);

    const statusBadge = (s) => {
        const map = { filled: 'badge-green', closed: 'badge-green', open: 'badge-blue', pending: 'badge-yellow', cancelled: 'badge-gray', failed: 'badge-red' };
        return <span className={map[s] || 'badge-gray'}>{s}</span>;
    };

    const handleCancel = async (id) => {
        try {
            await cancelOrderApi(id);
            fetchOrders();
        } catch { }
    };

    const displayed = orders.slice(0, 50);

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-0.5">
                    {['all', 'open', 'filled', 'cancelled'].map((f) => (
                        <button key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1 text-xs font-semibold rounded-md capitalize transition-all ${filter === f ? 'bg-dark-500 text-white' : 'text-white/30 hover:text-white/60'
                                }`}
                        >{f}</button>
                    ))}
                </div>
                <button onClick={fetchOrders} disabled={loading}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-white transition-colors">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                {displayed.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-white/20">
                        <Minus className="w-8 h-8 mb-2" />
                        <p className="text-sm">No orders yet</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="sticky top-0 bg-dark-800/90">
                            <tr>
                                {['Symbol', 'Side', 'Type', 'Price', 'Amount', 'Qty', 'Status', 'Level', ''].map((h) => (
                                    <th key={h} className="table-header text-left">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {displayed.map((o) => (
                                <tr key={o.id} className="table-row">
                                    <td className="table-cell font-medium text-white">{o.symbol?.split(':')[0] || '—'}</td>
                                    <td className="table-cell">
                                        <span className={o.side === 'buy' ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                                            {o.side?.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="table-cell text-white/50 capitalize">{o.order_type}</td>
                                    <td className="table-cell font-mono text-white/80">${(o.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="table-cell font-mono text-white/80">${(o.amount || 0).toFixed(2)}</td>
                                    <td className="table-cell font-mono text-white/50">{o.quantity || 0}</td>
                                    <td className="table-cell">{statusBadge(o.status || 'pending')}</td>
                                    <td className="table-cell text-white/40">{o.level ? `L${o.level}` : '—'}</td>
                                    <td className="table-cell">
                                        {['pending', 'open'].includes(o.status) && (
                                            <button onClick={() => handleCancel(o.id)}
                                                className="text-xs text-danger/50 hover:text-danger transition-colors">Cancel</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────
// Positions Table
// ──────────────────────────────────────────────
export function PositionsTable() {
    const { userId, positions, setPositions } = useAppStore();
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('all'); // all, spot, futures
    const [editingOrder, setEditingOrder] = useState(null);

    const fetchPositions = async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const data = await getPositions(userId, { include_spot: true });
            setPositions(data || []);
        } catch { }
        finally { setLoading(false); }
    };

    const handleClose = async (p) => {
        setLoading(true);
        const typeLabel = p.market === 'spot' ? 'Sell' : 'Close';
        if (!window.confirm(`${typeLabel} ${p.symbol} ${p.market === 'spot' ? 'holding' : 'position'}?`)) return;

        try {
            if (p.market === 'futures') {
                const side = p.side === 'long' ? 'sell' : 'buy';
                await placeOrderDirect({
                    user_id: userId,
                    symbol: p.symbol,
                    side: side,
                    type: 'market',
                    amount: Math.abs(p.contracts),
                    trade_type: 'futures',
                    is_close: true
                });
            } else {
                // Spot close = Sell the asset for USDT
                await placeOrderDirect({
                    user_id: userId,
                    symbol: p.symbol,
                    side: 'sell',
                    type: 'market',
                    amount: 0,
                    quantity: Math.abs(p.contracts),
                    trade_type: 'spot',
                });
            }
            setTimeout(fetchPositions, 1000);
        } catch (err) {
            let msg = 'Failed to close position';
            const detail = err.response?.data?.detail;
            if (typeof detail === 'string') msg = detail;
            else if (Array.isArray(detail)) msg = detail[0]?.msg || JSON.stringify(detail);
            else if (detail?.message) msg = detail.message;

            alert(msg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPositions();
        const interval = setInterval(fetchPositions, 5000);
        return () => clearInterval(interval);
    }, [userId]);

    if (!userId) return null;

    const filteredPositions = positions.filter(p => {
        if (filter === 'all') return true;
        return p.market === filter;
    });

    return (
        <div className="h-full flex flex-col relative">
            {editingOrder && (
                <TPSLEditModal
                    position={editingOrder}
                    onClose={() => setEditingOrder(null)}
                    onRefresh={fetchPositions}
                />
            )}

            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Positions</span>

                    <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-0.5">
                        {['all', 'spot', 'futures'].map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-2 py-0.5 text-[10px] font-bold rounded-md capitalize transition-all ${filter === f
                                    ? 'bg-dark-500 text-white shadow-sm'
                                    : 'text-white/30 hover:text-white/60'
                                    }`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>

                <button onClick={fetchPositions} disabled={loading}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-white transition-colors">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="flex-1 overflow-auto">
                {filteredPositions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-white/20">
                        <TrendingUp className="w-8 h-8 mb-2" />
                        <p className="text-sm">No {filter !== 'all' ? filter : ''} positions</p>
                    </div>
                ) : (
                    <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-dark-800/90 shadow-sm z-10">
                            <tr>
                                {['Symbol', 'Side', 'Qty/Size', 'Entry', 'Mark', 'PnL', 'TP / SL', ''].map((h) => (
                                    <th key={h} className="table-header text-left whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPositions.map((p, i) => {
                                const pnl = p.unrealizedPnl || 0;
                                const pnlPct = p.percentage || 0;
                                const isSpot = p.market === 'spot';

                                return (
                                    <tr key={i} className="table-row border-b border-white/[0.02]">
                                        <td className="table-cell font-medium text-white whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <span>{p.symbol?.split(':')[0]}</span>
                                                <span className={`px-1 py-0.5 rounded-[4px] text-[8px] font-black uppercase ${isSpot ? 'bg-warning/10 text-warning' : 'bg-accent-cyan/10 text-accent-cyan'}`}>
                                                    {p.market}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="table-cell">
                                            <span className={p.side === 'long' ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                                                {(p.side || '—').toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="table-cell font-mono text-white/80">{p.contracts?.toFixed(isSpot ? 4 : 2)}</td>
                                        <td className="table-cell font-mono text-white/50">${p.entryPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) || '0.00'}</td>
                                        <td className="table-cell font-mono text-white/50">${p.markPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) || '0.00'}</td>
                                        <td className="table-cell">
                                            <div className={`font-mono font-bold ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                                            </div>
                                            <div className={`text-[10px] font-bold ${pnlPct >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {pnlPct >= 0 ? '+' : ''}{pnlPct?.toFixed(2)}%
                                            </div>
                                        </td>
                                        <td className="table-cell">
                                            <div className="flex flex-col gap-0.5 relative group">
                                                <div className="text-[10px] flex items-center gap-1">
                                                    <span className="text-white/20 select-none">TP:</span>
                                                    <span className={p.take_profit ? 'text-success font-mono' : 'text-white/10'}>
                                                        {p.take_profit ? `$${p.take_profit}` : '—'}
                                                    </span>
                                                </div>
                                                <div className="text-[10px] flex items-center gap-1">
                                                    <span className="text-white/20 select-none">SL:</span>
                                                    <span className={p.stop_loss ? 'text-danger font-mono' : 'text-white/10'}>
                                                        {p.stop_loss ? `$${p.stop_loss}` : '—'}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => setEditingOrder(p)}
                                                    className="absolute -right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-dark-500 rounded-md shadow-lg text-accent-cyan hover:text-white"
                                                >
                                                    <Edit2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="table-cell text-right">
                                            <button
                                                onClick={() => handleClose(p)}
                                                className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${isSpot ? 'bg-warning/10 text-warning hover:bg-warning hover:text-dark-950' : 'bg-danger/10 text-danger hover:bg-danger hover:text-white'}`}
                                            >
                                                {isSpot ? 'Sell' : 'Close'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────
// History Table (Closed Positions / Realized PnL)
// ──────────────────────────────────────────────
export function HistoryTable() {
    const { userId } = useAppStore();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchHistory = async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const data = await getOrderHistory(userId);
            setHistory(data || []);
        } catch { }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, 10000);
        return () => clearInterval(interval);
    }, [userId]);

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/5">
                <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Trade History</span>
                <button onClick={fetchHistory} disabled={loading}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-white transition-colors">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="flex-1 overflow-auto">
                {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-white/20">
                        <Minus className="w-8 h-8 mb-2" />
                        <p className="text-sm">No trade history</p>
                    </div>
                ) : (
                    <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-dark-800/90 shadow-sm z-10">
                            <tr>
                                {['Symbol', 'Type', 'Side', 'Qty', 'Entry/Avg', 'Exit Price', 'Realized PnL', 'Time'].map((h) => (
                                    <th key={h} className="table-header text-left whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((h, i) => {
                                const pnl = h.realized_pnl || 0;
                                const isClose = h.is_close;

                                return (
                                    <tr key={h.id || i} className="table-row border-b border-white/[0.02]">
                                        <td className="table-cell font-medium text-white whitespace-nowrap">{h.symbol}</td>
                                        <td className="table-cell">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${h.trade_type === 'spot' ? 'bg-amber-500/10 text-amber-500' : 'bg-accent-cyan/10 text-accent-cyan'}`}>
                                                {h.trade_type}
                                            </span>
                                        </td>
                                        <td className="table-cell">
                                            <span className={h.side === 'buy' ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                                                {h.side?.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="table-cell font-mono text-white/80">{h.quantity?.toFixed(4)}</td>
                                        <td className="table-cell font-mono text-white/50">${h.price?.toLocaleString()}</td>
                                        <td className="table-cell font-mono text-white/50">${h.price?.toLocaleString()}</td>
                                        <td className="table-cell">
                                            {isClose ? (
                                                <div className={`font-mono font-bold ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                                    {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                                                </div>
                                            ) : (
                                                <span className="text-white/20">—</span>
                                            )}
                                        </td>
                                        <td className="table-cell text-white/30 whitespace-nowrap">
                                            {new Date(h.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
