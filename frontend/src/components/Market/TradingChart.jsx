import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { getOHLCV } from '../../api/client';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export default function TradingChart() {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);
    const candleSeries = useRef(null);
    const volSeries = useRef(null);
    const { selectedSymbol, currentPrice, isConnected } = useAppStore();
    const [timeframe, setTimeframe] = useState('15m');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!chartRef.current) return;

        const chart = createChart(chartRef.current, {
            layout: {
                background: { color: 'transparent' },
                textColor: 'rgba(255,255,255,0.4)',
                fontSize: 11,
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.03)' },
                horzLines: { color: 'rgba(255,255,255,0.03)' },
            },
            crosshair: {
                vertLine: { color: 'rgba(6,182,212,0.4)', width: 1, style: 0 },
                horzLine: { color: 'rgba(6,182,212,0.4)', width: 1, style: 0 },
            },
            timeScale: {
                borderColor: 'rgba(255,255,255,0.05)',
                timeVisible: true,
                secondsVisible: false,
            },
            rightPriceScale: {
                borderColor: 'rgba(255,255,255,0.05)',
            },
            handleScroll: true,
            handleScale: true,
        });

        const candles = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderUpColor: '#10b981',
            borderDownColor: '#ef4444',
            wickUpColor: 'rgba(16,185,129,0.6)',
            wickDownColor: 'rgba(239,68,68,0.6)',
        });

        const volume = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        chartInstance.current = chart;
        candleSeries.current = candles;
        volSeries.current = volume;

        const handleResize = () => {
            if (chartRef.current) {
                chart.applyOptions({ width: chartRef.current.offsetWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    const lastCandleRef = useRef(null);
    // Load OHLCV data
    useEffect(() => {
        if (!isConnected || !selectedSymbol) return;
        setLoading(true);
        getOHLCV(selectedSymbol, timeframe, 150)
            .then((data) => {
                if (!data?.candles?.length) return;
                const candles = data.candles.map((c) => ({
                    time: Math.floor(c.time / 1000),
                    open: c.open, high: c.high, low: c.low, close: c.close,
                }));
                const vols = data.candles.map((c) => ({
                    time: Math.floor(c.time / 1000),
                    value: c.volume,
                    color: c.close >= c.open ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
                }));
                candleSeries.current?.setData(candles);
                volSeries.current?.setData(vols);
                chartInstance.current?.timeScale().fitContent();

                // Save the very last candle so we can update it in real-time
                lastCandleRef.current = { ...candles[candles.length - 1] };
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [selectedSymbol, timeframe, isConnected]);

    // Update last candle on price tick
    useEffect(() => {
        if (!currentPrice || !candleSeries.current || !lastCandleRef.current) return;

        const lc = lastCandleRef.current;
        const updatedCandle = {
            time: lc.time, // Same timeframe bucket, updates existing
            open: lc.open,
            high: Math.max(lc.high, currentPrice),
            low: Math.min(lc.low, currentPrice),
            close: currentPrice,
        };

        candleSeries.current.update(updatedCandle);
        lastCandleRef.current = updatedCandle;
    }, [currentPrice]);

    const priceChange = useAppStore(s => s.priceChange24h);
    const isUp = priceChange >= 0;

    return (
        <div className="card flex flex-col h-full">
            {/* Chart header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <BarChart3 className="w-4 h-4 text-white/40" />
                    <span className="text-sm font-semibold text-white/70">Price Chart</span>
                    {loading && (
                        <span className="w-3 h-3 border border-accent-cyan/40 border-t-accent-cyan rounded-full animate-spin" />
                    )}
                </div>

                {/* Timeframe selector */}
                <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-0.5">
                    {TIMEFRAMES.map((tf) => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${timeframe === tf
                                ? 'bg-accent-cyan/20 text-accent-cyan'
                                : 'text-white/30 hover:text-white/60'
                                }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart area */}
            <div className="relative flex-1 min-h-[280px]">
                {!isConnected ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <BarChart3 className="w-12 h-12 text-white/10" />
                        <p className="text-white/25 text-sm">Connect exchange to view chart</p>
                    </div>
                ) : (
                    <div ref={chartRef} className="absolute inset-0 w-full h-full" />
                )}
            </div>
        </div>
    );
}
