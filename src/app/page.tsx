import Link from 'next/link';

export default function Home() {
  return (
    <div className="container" style={{ textAlign: 'center', paddingTop: '10rem' }}>
      <h1>WSU Server Dashboard</h1>
      <p style={{ margin: '1rem 0', color: 'var(--text-muted)' }}>
        VM 인프라 관리 및 API 테스트를 위한 대시보드입니다.
      </p>
      <Link href="/login">
        <button className="btn-primary" style={{ fontSize: '1.1rem', padding: '0.75rem 2rem' }}>
          로그인하여 시작하기
        </button>
      </Link>
    </div>
  );
}
