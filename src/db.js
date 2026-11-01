import mysql from 'mysql2/promise';
export function createPool(config) {
  return mysql.createPool({ ...config.database, multipleStatements: false, decimalNumbers: true, timezone: 'Z', charset: 'utf8mb4', waitForConnections: true });
}
export async function migrate(pool) {
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('cosmiccrm_migrate', 60) AS acquired");
    if (lock.acquired !== 1) throw new Error('Unable to acquire migration lock.');
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    const [versions] = await connection.query('SELECT version FROM schema_migrations');
    const applied = new Set(versions.map(row => row.version));
    const { migrations } = await import('./migrations.js');
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      // MySQL DDL commits implicitly; migration statements must be restart-safe.
      for (const sql of migration.statements) await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version]);
      console.log('Applied migration ' + migration.version);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('cosmiccrm_migrate')").catch(() => {});
    connection.release();
  }
}
