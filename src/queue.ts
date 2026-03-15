import { Queue } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    logger.warn(`Redis disconnected. Retrying connection (Attempt ${times})...`);
    return Math.min(times * 50, 2000); // Reconnect with backoff
  }
};

const connection = new Redis(redisConfig);

connection.on('error', (err: Error) => {
  logger.error(`Redis connection error: ${err.message}`);
});

export const bookingQueue = new Queue('bookingConfirmation', { 
  connection: connection as any,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } 
});

export const eventUpdateQueue = new Queue('eventUpdateNotification', { 
  connection: connection as any,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
});

export { connection };
