'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function authFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export default function AdminPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newStudentId, setNewStudentId] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  useEffect(() => {
    const role = localStorage.getItem('role');
    if (!role || role !== 'admin') {
      router.push('/login');
      return;
    }
    fetchStudents();
  }, [router]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/students');
      if (res.status === 401 || res.status === 403) { router.push('/login'); return; }
      const data = await res.json();
      setStudents(data.data || []);
    } catch {
      setError('학생 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAdding(true);

    try {
      const res = await authFetch('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify({ student_id: newStudentId }),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(`학번 ${newStudentId} 등록 완료`);
        setNewStudentId('');
        fetchStudents();
      } else {
        setError(data.message || '등록에 실패했습니다.');
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`학번 ${username}을 삭제하시겠습니까?`)) return;
    setError('');
    setSuccess('');

    try {
      const res = await authFetch(`/api/admin/students/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSuccess(`학번 ${username} 삭제 완료`);
        setStudents(prev => prev.filter(s => s.id !== id));
      } else {
        const data = await res.json();
        setError(data.message || '삭제에 실패했습니다.');
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    router.push('/login');
  };

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>관리자 패널</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn-secondary" onClick={() => router.push('/dashboard')}>대시보드</button>
          <button
            onClick={handleLogout}
            style={{ background: 'none', border: '1px solid var(--border)', padding: '0.5rem 1rem', borderRadius: '0.375rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}
          >
            로그아웃
          </button>
        </div>
      </header>

      <section className="card">
        <h2 style={{ marginBottom: '1rem' }}>학번 등록</h2>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>학번</label>
            <input
              type="text"
              value={newStudentId}
              onChange={e => setNewStudentId(e.target.value)}
              placeholder="예: 20240001"
              required
              style={{ marginBottom: 0 }}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={adding} style={{ whiteSpace: 'nowrap' }}>
            {adding ? '등록 중...' : '학번 추가'}
          </button>
        </form>

        {error && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem' }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#dcfce7', color: '#166534', borderRadius: '0.5rem' }}>
            {success}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: '1rem' }}>등록된 학생 ({students.length}명)</h2>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>학번</th>
                <th>등록일</th>
                <th style={{ width: '100px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    등록된 학생이 없습니다.
                  </td>
                </tr>
              ) : (
                students.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 500 }}>{s.username}</td>
                    <td>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        onClick={() => handleDelete(s.id, s.username)}
                        style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
