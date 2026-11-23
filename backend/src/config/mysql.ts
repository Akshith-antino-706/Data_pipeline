import mysql from 'mysql2/promise';
import type { Pool, PoolOptions } from 'mysql2/promise';

const pools: Record<string, Pool> = {};

/**
 * Get a named MySQL connection pool. Supports multiple remote MySQL servers.
 * @param {string} name - Pool name: 'primary' (MYSQL_*) or 'chats' (MYSQL2_*)
 */
export function getMySQLPool(name: string = 'primary'): Pool {
  if (!pools[name]) {
    const config: PoolOptions = name === 'chats'
      ? {
          host: process.env.MYSQL2_HOST,
          port: parseInt(process.env.MYSQL2_PORT || '3306'),
          user: process.env.MYSQL2_USER,
          password: process.env.MYSQL2_PASS,
          database: process.env.MYSQL2_DB,
        }
      : {
          host: process.env.MYSQL_HOST,
          port: parseInt(process.env.MYSQL_PORT || '3306'),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASS,
          database: process.env.MYSQL_DB,
        };

    pools[name] = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
      enableKeepAlive: true,
    });
  }
  return pools[name];
}

/**
 * Execute a read-only query against a remote MySQL database.
 * @param {string} sql
 * @param {Array} params
 * @param {string} poolName - 'primary' or 'chats'
 */
export async function mysqlQuery<R = mysql.RowDataPacket[]>(sql: string, params: unknown[] = [], poolName: string = 'primary'): Promise<R> {
  const p = getMySQLPool(poolName);
  const [rows] = await p.query(sql, params);
  return rows as R;
}
