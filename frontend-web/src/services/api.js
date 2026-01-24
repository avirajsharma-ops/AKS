import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Check if token expired
      if (error.response?.data?.code === 'TOKEN_EXPIRED') {
        try {
          const refreshToken = localStorage.getItem('refreshToken');
          const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
          
          const { accessToken } = response.data;
          localStorage.setItem('accessToken', accessToken);
          
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          // Refresh failed, redirect to login
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// API helper functions
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken })
};

export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (data) => api.patch('/users/me', data),
  getPermissions: () => api.get('/users/permissions'),
  updatePermissions: (data) => api.post('/users/permissions', data),
  getStats: () => api.get('/users/stats'),
  deleteAccount: () => api.delete('/users/me'),
  exportData: () => api.post('/users/data-export')
};

export const transcriptAPI = {
  getAll: (params) => api.get('/transcripts', { params }),
  getOne: (id) => api.get(`/transcripts/${id}`),
  search: (query, limit) => api.get('/transcripts/search', { params: { q: query, limit } }),
  getSessions: () => api.get('/transcripts/sessions'),
  getTopics: () => api.get('/transcripts/topics/summary'),
  delete: (id) => api.delete(`/transcripts/${id}`)
};

export const profileAPI = {
  get: () => api.get('/profile'),
  getFull: () => api.get('/profile/full'),
  updateBasic: (data) => api.patch('/profile/basic', data),
  getQuestions: () => api.get('/profile/questions'),
  askClone: (question) => api.post('/profile/ask-clone', { question }),
  getRelationships: () => api.get('/profile/relationships'),
  getPreferences: (category) => api.get(`/profile/preferences/${category}`),
  deletePreference: (category, item) => api.delete(`/profile/preferences/${category}/${encodeURIComponent(item)}`),
  getKnowledge: () => api.get('/profile/knowledge'),
  reset: () => api.post('/profile/reset')
};

export const speechAPI = {
  synthesize: (text, voiceId) => api.post('/speech/synthesize', { text, voiceId }),
  transcribe: (audioBlob, language) => {
    const formData = new FormData();
    formData.append('audio', audioBlob);
    if (language) formData.append('language', language);
    return api.post('/speech/transcribe', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getVoices: () => api.get('/speech/voices')
};
