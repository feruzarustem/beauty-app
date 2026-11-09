export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 360, margin: "0 auto", padding: 16 }}>
      <h1>Вход</h1>
      {error && <p role="alert">Неверный логин или пароль</p>}
      <form method="POST" action="/api/auth/login" style={{ display: "grid", gap: 12 }}>
        <input name="login" placeholder="Логин" autoComplete="username" required />
        <input name="password" type="password" placeholder="Пароль" autoComplete="current-password" required />
        <button type="submit">Войти</button>
      </form>
    </main>
  );
}
