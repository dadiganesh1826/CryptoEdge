// Zustand global store for Crypto Trading Platform

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAppStore = create(
    persist(
        (set, get) => ({
            // ─── Auth / Connection ───────────────────────
            user: null, // { id, email, name, connected }
            isLoggedIn: false,
            userId: null,
            accessToken: null,
            refreshToken: null,
            exchange: null,
            exchangeLabel: null,
            isConnected: false,

            setLogin: (data) => set({
                user: { id: data.user_id, email: data.email, name: data.name },
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                isLoggedIn: true,
                userId: data.user_id,
            }),

            setAuth: (data) => set({
                userId: data.user_id,
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                exchange: data.exchange,
                exchangeLabel: data.label,
                isConnected: true,
                user: { ...get().user, connected: true }
            }),

            logout: () => set({
                user: null,
                isLoggedIn: false,
                userId: null,
                accessToken: null,
                refreshToken: null,
                exchange: null,
                exchangeLabel: null,
                isConnected: false,
                balance: {},
                positions: [],
                orders: [],
                strategies: [],
            }),

            // ─── Market Data ─────────────────────────────
            selectedSymbol: 'BTC/USDT:USDT',
            selectedSymbolDisplay: 'BTC/USDT',
            currentPrice: null,
            priceChange24h: 0,
            volume24h: 0,
            high24h: 0,
            low24h: 0,
            bid: null,
            ask: null,

            setSelectedSymbol: (symbol) => set({
                selectedSymbol: symbol,
                selectedSymbolDisplay: symbol.split(':')[0],
            }),

            updatePrice: (data) => set({
                currentPrice: data.price,
                priceChange24h: data.change_24h || 0,
                volume24h: data.volume_24h || 0,
                high24h: data.high_24h || 0,
                low24h: data.low_24h || 0,
                bid: data.bid,
                ask: data.ask,
            }),

            // ─── Balances ────────────────────────────────
            spotBalance: {},
            futuresBalance: {},
            setSpotBalance: (bal) => set({ spotBalance: bal }),
            setFuturesBalance: (bal) => set({ futuresBalance: bal }),

            // ─── Positions ───────────────────────────────
            positions: [],
            setPositions: (positions) => set({ positions }),

            // ─── Orders ──────────────────────────────────
            orders: [],
            setOrders: (orders) => set({ orders }),
            addOrder: (order) => set((state) => ({
                orders: [order, ...state.orders].slice(0, 200),
            })),

            // ─── Strategies ──────────────────────────────
            strategies: [],
            setStrategies: (strategies) => set({ strategies }),
            addStrategy: (strategy) => set((state) => ({
                strategies: [strategy, ...state.strategies],
            })),
            updateStrategyStatus: (id, status) => set((state) => ({
                strategies: state.strategies.map(s =>
                    s.id === id ? { ...s, status } : s
                ),
            })),

            // ─── UI State ────────────────────────────────
            activeTab: 'trade',
            setActiveTab: (tab) => set({ activeTab: tab }),
            tradeMode: 'futures',
            setTradeMode: (mode) => set({ tradeMode: mode }),
            tradeSide: 'buy',
            setTradeSide: (side) => set({ tradeSide: side }),

            // ─── WebSocket ───────────────────────────────
            wsConnected: false,
            setWsConnected: (status) => set({ wsConnected: status }),
        }),
        {
            name: 'crypto-trading-store',
            partialize: (state) => ({
                user: state.user,
                isLoggedIn: state.isLoggedIn,
                userId: state.userId,
                accessToken: state.accessToken,
                refreshToken: state.refreshToken,
                exchange: state.exchange,
                exchangeLabel: state.exchangeLabel,
                isConnected: state.isConnected,
                selectedSymbol: state.selectedSymbol,
                selectedSymbolDisplay: state.selectedSymbolDisplay,
            }),
        }
    )
);

export default useAppStore;
