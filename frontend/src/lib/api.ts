import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle 401 -> redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (data: { name: string; email: string; password: string; companyName: string }) =>
    api.post('/auth/register', data),
};

// Orders
export const ordersApi = {
  list: (params?: Record<string, any>) =>
    api.get('/orders', { params }),
  get: (id: string) =>
    api.get(`/orders/${id}`),
  getRisk: (orderId: string) =>
    api.get(`/orders/risk/${orderId}`),
  override: (id: string, recommendation: string, reason?: string) =>
    api.post(`/orders/${id}/override`, { recommendation, reason }),
};

// Blacklist
export const blacklistApi = {
  list: (params?: Record<string, any>) =>
    api.get('/blacklist', { params }),
  add: (data: { type: string; value: string; reason?: string }) =>
    api.post('/blacklist', data),
  remove: (id: string) =>
    api.delete(`/blacklist/${id}`),
};

// ML
export const mlApi = {
  metrics: () => api.get('/ml/metrics'),
  confusionMatrix: (days?: number) => api.get('/ml/confusion-matrix', { params: { days } }),
  threshold: (data: { block_threshold?: number; verify_threshold?: number }) =>
    api.post('/ml/threshold', data),
  versions: () => api.get('/ml/versions'),
  health: () => api.get('/ml/health'),
  performanceHistory: () => api.get('/ml/performance-history'),
  generateSnapshot: () => api.post('/ml/generate-snapshot'),
};

// Analytics
export const analyticsApi = {
  dashboard: (days?: number) =>
    api.get('/analytics', { params: { days } }),
  rtoReport: () =>
    api.get('/analytics/rto-report'),
  submitFeedback: (data: { orderId: string; outcome: string; reason?: string }) =>
    api.post('/analytics/rto-feedback', data),
  overrideStats: (days?: number) =>
    api.get('/analytics/override-stats', { params: { days } }),
};

export default api;
