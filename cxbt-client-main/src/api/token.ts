export function getToken(): string | null {
  return localStorage.getItem('cxbt_token');
}

export function setToken(token: string) {
  localStorage.setItem('cxbt_token', token);
}

export function clearToken() {
  localStorage.removeItem('cxbt_token');
}
