import { useState } from 'react';
import { apiFetch, setToken } from '../../api';
import './AuthOverlay.css';

export default function AuthOverlay({ onLogin }: { onLogin: () => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const data = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (isLogin) {
        setToken(data.token);
        onLogin();
      } else {
        setIsLogin(true);
        setError('注册成功，请登录');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-box">
        <h2>{isLogin ? '登录创想兵团' : '注册新账号'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="auth-row">
            <label>用户名</label>
            <input value={username} onChange={e => setUsername(e.target.value)} required />
          </div>
          <div className="auth-row">
            <label>密 码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <div className="auth-actions">
            <button type="submit" disabled={loading}>
              {loading ? '请稍后...' : (isLogin ? '登 录' : '注 册')}
            </button>
            <button type="button" className="auth-switch" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? '没有账号？去注册' : '已有账号？去登录'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
