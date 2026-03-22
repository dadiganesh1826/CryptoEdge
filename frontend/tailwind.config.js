/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    theme: {
        extend: {
            colors: {
                dark: {
                    900: '#060d1e',
                    950: '#020617',
                    800: '#0a1229',
                    700: '#0f1a35',
                    600: '#162040',
                    500: '#1e2d54',
                },
                accent: {
                    cyan: '#06b6d4',
                    blue: '#3b82f6',
                    indigo: '#6366f1',
                    purple: '#8b5cf6',
                },
                success: '#10b981',
                danger: '#ef4444',
                warning: '#f59e0b',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            animation: {
                'fade-in': 'fadeIn 0.3s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'pulse-glow': 'pulseGlow 2s infinite',
                'shimmer': 'shimmer 2s infinite',
                'price-tick': 'priceTick 0.3s ease-out',
            },
            keyframes: {
                fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
                slideUp: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
                pulseGlow: { '0%,100%': { boxShadow: '0 0 0 0 rgba(6,182,212,0.4)' }, '50%': { boxShadow: '0 0 20px 4px rgba(6,182,212,0.2)' } },
                shimmer: { '0%': { backgroundPosition: '-200% center' }, '100%': { backgroundPosition: '200% center' } },
                priceTick: { '0%': { transform: 'scale(1.05)', opacity: 0.7 }, '100%': { transform: 'scale(1)', opacity: 1 } },
            },
            backdropBlur: { xs: '2px' },
            backgroundImage: {
                'grid-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
            },
            opacity: {
                '4': '0.04',
                '6': '0.06',
                '8': '0.08',
                '15': '0.15',
                '35': '0.35',
            },
        },
    },
    plugins: [],
};
