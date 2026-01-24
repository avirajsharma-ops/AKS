import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://10.0.2.2:5000/api'; // Android emulator localhost

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (error.response?.data?.code === 'TOKEN_EXPIRED') {
        try {
          const refreshToken = await AsyncStorage.getItem('refreshToken');
          const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });

          const { accessToken } = response.data;
          await AsyncStorage.setItem('accessToken', accessToken);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'user']);
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;

export const profileAPI = {
  get: () => api.get('/profile'),
  askClone: (question: string) => api.post('/profile/ask-clone', { question }),
  getQuestions: () => api.get('/profile/questions'),
};

export const userAPI = {
  getStats: () => api.get('/users/stats'),
  updatePermissions: (data: any) => api.post('/users/permissions', data),
};
