import axios from 'axios';

/**
 * Shared axios instance for Super Admin API calls.
 * Automatically adds the Authorization header from localStorage.
 */
const adminApi = axios.create({
  baseURL: '/api/admin',
});

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('hms_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default adminApi;
