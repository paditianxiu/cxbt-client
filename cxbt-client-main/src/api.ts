export const API_BASE = 'http://localhost:8080/api';
export const WS_BASE = 'ws://localhost:8080/ws';

export function getToken(): string | null {
  return localStorage.getItem('cxbt_token');
}

export function setToken(token: string) {
  localStorage.setItem('cxbt_token', token);
}

export function clearToken() {
  localStorage.removeItem('cxbt_token');
}

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
