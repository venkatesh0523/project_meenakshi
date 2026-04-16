const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@db:5432/farmdb";

const globalForDb = global;

const pool =
  globalForDb.farmDbPool ||
  new Pool({
    connectionString
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.farmDbPool = pool;
}

module.exports = {
  query: (text, params) => pool.query(text, params)
};
