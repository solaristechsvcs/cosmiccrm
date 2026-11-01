import { loadConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
const pool=createPool(await loadConfig());
try { await migrate(pool); } finally { await pool.end(); }
