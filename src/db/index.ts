import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env');
}

export const connection = mysql.createPool({
  uri: process.env.DATABASE_URL,

  waitForConnections: true,

  // 중요
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '10'),

  // 0 = 무제한 대기
  queueLimit: parseInt(process.env.DB_POOL_QUEUE_LIMIT || '0'),

  // 연결 timeout
  connectTimeout: parseInt(
    process.env.DB_CONNECT_TIMEOUT || '10000'
  ),

  // idle connection 관리
  maxIdle: parseInt(process.env.DB_POOL_MAX_IDLE || '10'),
  idleTimeout: parseInt(
    process.env.DB_POOL_IDLE_TIMEOUT || '60000'
  ),

  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const db = drizzle(connection, {
  schema,
  mode: 'default',
});