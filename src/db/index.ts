import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env');
}

export const connection = mysql.createPool(process.env.DATABASE_URL);

export const db = drizzle(connection, { schema, mode: 'default' });
