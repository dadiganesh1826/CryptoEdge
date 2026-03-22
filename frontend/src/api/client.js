import axios from 'axios';

import useAppStore from '../store/useAppStore';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8000';

// ──────────────────────────────────────────────
// Axios instance
// ──────────────────────────────────────────────
const apiClient = axios.create({
    baseURL: GATEWAY_URL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach JWT from localStorage
apiClient.interceptors.request.use((config) => {
    const store = JSON.parse(localStorage.getItem('crypto-trading-store') || '{}');
    const token = store?.state?.accessToken;
    const userId = store?.state?.userId;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    if (userId) {
        config.headers['x-user-id'] = userId;
    }
    return config;
});

// Response interceptor — handle 401 Unauthorized
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            console.warn('Session expired or invalid. Logging out...');
            useAppStore.getState().logout();
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

// ──────────────────────────────────────────────
// Auth API
// ──────────────────────────────────────────────
export const connectExchange = (data) =>
    apiClient.post('/auth/connect', data).then((r) => r.data);

export const getMe = () =>
    apiClient.get('/auth/me').then((r) => r.data);

export const disconnectExchange = (userId) =>
    apiClient.delete(`/auth/disconnect/${userId}`).then((r) => r.data);

// ──────────────────────────────────────────────
// Exchange API
// ──────────────────────────────────────────────
export const getBalance = (tradeMode = 'futures') =>
    apiClient.get('/exchange/balance', { params: { trade_type: tradeMode } }).then((r) => r.data);

export const getPrice = (symbol) => {
    const path = symbol.replace('/', '-').replace(':', '-');
    return apiClient.get(`/exchange/price/${path}`).then((r) => r.data);
};

export const getPositions = (includeSpot = false) =>
    apiClient.get('/exchange/positions', { params: { include_spot: includeSpot } }).then((r) => r.data);

export const getMarkets = () =>
    apiClient.get('/exchange/markets').then((r) => r.data);

export const getOHLCV = (symbol, timeframe = '1m', limit = 100) => {
    const path = symbol.replace('/', '-').replace(':', '-');
    return apiClient.get(`/exchange/ohlcv/${path}`, {
        params: { timeframe, limit },
    }).then((r) => r.data);
};

export const placeOrderDirect = (data) =>
    apiClient.post('/exchange/order', data).then((r) => r.data);

// ──────────────────────────────────────────────
// Orders API
// ──────────────────────────────────────────────
export const placeOrder = (data) =>
    apiClient.post('/orders/place', data).then((r) => r.data);

export const getUserOrders = (userId, params = {}) =>
    apiClient.get(`/orders/user/${userId}`, { params }).then((r) => r.data);

export const getOrderHistory = (userId) =>
    apiClient.get(`/orders/history/${userId}`).then((r) => r.data);

export const updateTPSL = (orderId, data) =>
    apiClient.post(`/orders/tpsl/${orderId}`, data).then((r) => r.data);

export const getStrategyOrders = (strategyId) =>
    apiClient.get(`/orders/strategy/${strategyId}`).then((r) => r.data);

export const cancelOrder = (orderId) =>
    apiClient.delete(`/orders/${orderId}`).then((r) => r.data);

// ──────────────────────────────────────────────
// Strategy API
// ──────────────────────────────────────────────
export const createStrategy = (data) =>
    apiClient.post('/strategy/create', data).then((r) => r.data);

export const getStrategy = (id) =>
    apiClient.get(`/strategy/${id}`).then((r) => r.data);

export const getUserStrategies = (userId) =>
    apiClient.get(`/strategy/user/${userId}`).then((r) => r.data);

export const stopStrategy = (id) =>
    apiClient.delete(`/strategy/${id}`).then((r) => r.data);

export const previewLevels = (basePrice, dropPct, levels) =>
    apiClient.get('/strategy/preview/levels', {
        params: { base_price: basePrice, drop_pct: dropPct, levels },
    }).then((r) => r.data);

export default apiClient;
