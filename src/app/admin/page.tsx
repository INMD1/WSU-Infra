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
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">관리자 패널</h1>
        <div className="flex gap-4">
          <button className="btn-secondary" onClick={() => router.push('/dashboard')}>대시보드</button>
          <button
            onClick={handleLogout}
            className="bg-transparent border border-border px-4 py-2 rounded-md text-text-muted text-sm hover:bg-border transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      <section className="card">
        <h2 className="text-lg font-semibold mb-4">학번 등록</h2>
        <form onSubmit={handleAdd} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block mb-2 text-sm">학번</label>
            <input
              type="text"
              value={newStudentId}
              onChange={e => setNewStudentId(e.target.value)}
              placeholder="예: 20240001"
              className="input"
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={adding} style={{ whiteSpace: 'nowrap' }}>
            {adding ? '등록 중...' : '학번 추가'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 bg-green-100 text-green-800 rounded-md text-sm">
            {success}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-4">등록된 학생 ({students.length}명)</h2>
        {loading ? (
          <p className="text-text-muted">로딩 중...</p>
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
                  <td colSpan={3} className="text-center text-text-muted py-4">
                    등록된 학생이 없습니다.
                  </td>
                </tr>
              ) : (
                students.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono font-medium">{s.username}</td>
                    <td>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        onClick={() => handleDelete(s.id, s.username)}
                        className="bg-red-100 text-red-800 border-none rounded px-3 py-1 cursor-pointer text-sm hover:bg-red-200 transition-colors"
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
