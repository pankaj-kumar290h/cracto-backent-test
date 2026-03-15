import { Pool } from 'pg';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000, 
});

pool.on('error', (err: Error) => {
  logger.error(`Unexpected database error on idle client: ${err.message}`);
});

// Test connection right away
pool.query('SELECT 1').catch((err: Error) => {
  logger.error(`Initial database connection failed: ${err.message}. Please check if the database is running.`);
});

export default pool;
