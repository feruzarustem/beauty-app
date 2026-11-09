export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="script">Lash Golden</div>
        <small>beauty studio</small>
        {error && <p role="alert" className="alert">Неверный логин или пароль</p>}
        <form method="POST" action="/api/auth/login" className="stack" style={{ maxWidth: "none" }}>
          <input name="login" placeholder="Логин" autoComplete="username" required />
          <input name="password" type="password" placeholder="Пароль" autoComplete="current-password" required />
          <button type="submit">Войти</button>
        </form>
      </div>
    </div>
  );
}
