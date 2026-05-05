'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body: any = { student_id: studentId };
      if (isAdminMode) body.password = password;

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('username', data.username);
        localStorage.setItem('role', data.role);
        if (data.owner_id) localStorage.setItem('owner_id', data.owner_id);
        router.push(data.role === 'admin' ? '/admin' : '/dashboard');
      } else {
        setError(data.message || '로그인에 실패했습니다.');
      }
    } catch {
      setError('서버와 통신 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="card" style={{ width: '400px' }}>
        <h2 className="text-xl font-bold text-center mb-2">WSU 클라우드 포털</h2>
        <p className="text-center text-text-muted mb-6 text-sm">
          {isAdminMode ? '관리자 로그인' : '학번으로 로그인하세요'}
        </p>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block mb-2 text-sm">{isAdminMode ? '관리자 ID' : '학번'}</label>
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder={isAdminMode ? '관리자 ID 입력' : '학번 입력 (예: 20240001)'}
              className="input"
              required
              autoFocus
            />
          </div>

          {isAdminMode && (
            <div className="mb-4">
              <label className="block mb-2 text-sm">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="관리자 비밀번호"
                className="input"
                required
              />
            </div>
          )}

          {error && (
            <p className="text-error mb-4 text-sm">{error}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={() => { setIsAdminMode(!isAdminMode); setError(''); setPassword(''); }}
            className="bg-transparent border-none text-text-muted cursor-pointer text-sm underline hover:text-primary transition-colors"
          >
            {isAdminMode ? '학생 로그인으로 돌아가기' : '관리자 로그인'}
          </button>
        </div>
      </div>
    </div>
  );
}
