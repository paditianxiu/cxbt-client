import { API_BASE } from './config';
import { getToken } from './token';

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as any) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMessage = 'API Request Failed';
    try {
      const errData = await response.json();
      errMessage = errData.error || errMessage;
    } catch (e) {}
    throw new Error(errMessage);
  }

  return response.json();
}
