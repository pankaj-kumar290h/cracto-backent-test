import { Worker, Job } from 'bullmq';
import pool from './db';
import { connection } from './queue';
import logger from './logger';

// Job Data Interfaces
interface BookingJobData {
  booking_id: number;
  customer_id: number;
  event_id: number;
  seats: number;
}

interface EventUpdateJobData {
  event_id: number;
  event_name: string;
}

interface Customer {
  name: string;
  email: string;
}

// Background Task 1: Booking Confirmation
const bookingWorker = new Worker<BookingJobData>('bookingConfirmation', async (job: Job<BookingJobData>) => {
  const { booking_id, customer_id, event_id, seats } = job.data;
  
  try {
    // Fetch customer and event details
    const customerResult = await pool.query('SELECT name, email FROM customers WHERE id = $1', [customer_id]);
    const eventResult = await pool.query('SELECT name FROM events WHERE id = $1', [event_id]);
    
    if (customerResult.rows.length > 0 && eventResult.rows.length > 0) {
      const customer = customerResult.rows[0];
      const event = eventResult.rows[0];
      
      // Simulate sending email
      logger.info(`[Booking Confirmation] Email sent to ${customer.email} (${customer.name}) for booking ${seats} seat(s) at ${event.name}`);
    } else {
      throw new Error(`Failed to find customer or event data for booking ${booking_id}`);
    }
  } catch (error: any) {
    logger.error(`[Booking Confirmation] Error processing job ${job.id}: ${error.message}`);
    throw error; // Let BullMQ handle the retry mechanism
  }
}, { connection: connection as any });

bookingWorker.on('completed', (job: Job) => {
  logger.info(`Job ${job.id} for booking confirmation completed successfully.`);
});

bookingWorker.on('failed', (job: Job | undefined, err: Error) => {
  logger.error(`Job ${job?.id} for booking confirmation failed: ${err.message}`);
});

// Background Task 2: Event Update Notification
const eventUpdateWorker = new Worker<EventUpdateJobData>('eventUpdateNotification', async (job: Job<EventUpdateJobData>) => {
  const { event_id, event_name } = job.data;
  
  try {
    // Fetch all customers who booked this event
    const result = await pool.query(`
      SELECT DISTINCT c.name, c.email 
      FROM customers c
      JOIN bookings b ON c.id = b.customer_id
      WHERE b.event_id = $1 AND b.status = 'confirmed'
    `, [event_id]);
    
    const customers: Customer[] = result.rows;
    
    if (customers.length === 0) {
      logger.info(`[Event Update Notification] No confirmed bookings for event ${event_name} (ID: ${event_id})`);
      return;
    }
    
    logger.info(`[Event Update Notification] Notifying ${customers.length} customer(s) about updates to ${event_name}...`);
    for (const customer of customers) {
      logger.info(` -> Notification sent to ${customer.email} (${customer.name})`);
    }
  } catch (error: any) {
    logger.error(`[Event Update Notification] Error processing job ${job.id}: ${error.message}`);
    throw error; // Let BullMQ handle the retry mechanism
  }
}, { connection: connection as any });

eventUpdateWorker.on('completed', (job: Job) => {
  logger.info(`Job ${job.id} for event update notification completed successfully.`);
});

eventUpdateWorker.on('failed', (job: Job | undefined, err: Error) => {
  logger.error(`Job ${job?.id} for event update notification failed: ${err.message}`);
});

logger.info('Workers are safely running and listening for jobs...');
