// WebSocket hook for real-time price/order updates

import { useEffect, useRef, useCallback } from 'react';
import useAppStore from '../store/useAppStore';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8005';

export function useWebSocket() {
    const ws = useRef(null);
    const reconnectTimer = useRef(null);
    const { userId, accessToken, selectedSymbol, updatePrice, setWsConnected } = useAppStore();

    const connect = useCallback(() => {
        if (!userId || !accessToken || !selectedSymbol) return;
        if (ws.current?.readyState === WebSocket.OPEN) return;

        const symbol = encodeURIComponent(selectedSymbol);
        const url = `${WS_URL}/ws/connect?user_id=${userId}&token=${accessToken}&symbol=${symbol}`;

        try {
            ws.current = new WebSocket(url);

            ws.current.onopen = () => {
                setWsConnected(true);
                console.log('[WS] Connected');
            };

            ws.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'price') {
                        updatePrice(data);
                    }
                } catch (e) {
                    console.warn('[WS] Parse error', e);
                }
            };

            ws.current.onclose = () => {
                setWsConnected(false);
                console.log('[WS] Disconnected — reconnecting in 3s');
                reconnectTimer.current = setTimeout(connect, 3000);
            };

            ws.current.onerror = (err) => {
                console.error('[WS] Error', err);
                ws.current?.close();
            };
        } catch (e) {
            console.error('[WS] Connection failed', e);
        }
    }, [userId, accessToken, selectedSymbol, updatePrice, setWsConnected]);

    const send = useCallback((data) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(data));
        }
    }, []);

    const changeSymbol = useCallback((newSymbol) => {
        send({ type: 'subscribe', symbol: newSymbol });
    }, [send]);

    const ping = useCallback(() => {
        send({ type: 'ping' });
    }, [send]);

    useEffect(() => {
        connect();
        const pingInterval = setInterval(ping, 30000);
        return () => {
            clearInterval(pingInterval);
            clearTimeout(reconnectTimer.current);
            ws.current?.close();
        };
    }, [connect, ping]);

    // Re-subscribe when symbol changes
    useEffect(() => {
        changeSymbol(selectedSymbol);
    }, [selectedSymbol, changeSymbol]);

    return { changeSymbol };
}
