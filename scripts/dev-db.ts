import EmbeddedPostgres from "embedded-postgres";

// Локальный PostgreSQL для разработки (данные в .pgdata, порт 5433). Остановка: Ctrl+C.
const pg = new EmbeddedPostgres({
  databaseDir: ".pgdata",
  user: "postgres",
  password: "postgres",
  port: 5433,
  persistent: true,
});

async function main() {
  const fs = await import("node:fs");
  if (!fs.existsSync(".pgdata/PG_VERSION")) await pg.initialise();
  await pg.start();
  for (const name of ["beauty", "beauty_test"]) {
    try {
      await pg.createDatabase(name);
    } catch {
      /* уже существует */
    }
  }
  console.log("PostgreSQL запущен на порту 5433 (базы: beauty, beauty_test)");
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main();
