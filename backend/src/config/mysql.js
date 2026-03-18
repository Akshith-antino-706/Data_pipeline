import mysql from 'mysql2/promise';

const pools = {};

/**
 * Get a named MySQL connection pool. Supports multiple remote MySQL servers.
 * @param {string} name - Pool name: 'primary' (MYSQL_*) or 'chats' (MYSQL2_*)
 */
export function getMySQLPool(name = 'primary') {
  if (!pools[name]) {
    const config = name === 'chats'
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
export async function mysqlQuery(sql, params = [], poolName = 'primary') {
  const p = getMySQLPool(poolName);
  const [rows] = await p.query(sql, params);
  return rows;
}
