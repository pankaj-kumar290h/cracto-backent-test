import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import pool from './db';
import { bookingQueue, eventUpdateQueue } from './queue';
import logger from './logger';
import { authenticateToken, authorizeRole, generateDummyToken, AuthRequest } from './auth';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Get dummy tokens for testing
app.get('/api/auth/token', (req: Request, res: Response) => {
  const userId = parseInt(req.query.userId as string) || 1;
  const role = (req.query.role as string) || 'customer';

  if (role !== 'customer' && role !== 'organizer') {
    res.status(400).json({ error: 'Role must be customer or organizer' });
    return;
  }

  const token = generateDummyToken(userId, role as 'customer' | 'organizer');
  res.json({ token, decoded: { userId, role } });
});

// Validation Schemas
const bookingSchema = Joi.object({
  event_id: Joi.number().integer().required(),
  seats: Joi.number().integer().min(1).required()
});

const eventSchema = Joi.object({
  name: Joi.string().required(),
  date: Joi.date().iso().required(),
  location: Joi.string().required()
});

// Interfaces
interface Booking {
  id: number;
  customer_id: number;
  event_id: number;
  seats: number;
  status: string;
  created_at: string;
}

interface Event {
  id: number;
  name: string;
  date: string;
  location: string;
  created_at: string;
  updated_at: string;
}

// Create a booking (Customers Only)
app.post('/api/bookings', authenticateToken, authorizeRole('customer'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { error, value } = bookingSchema.validate(req.body);
  if (error) {
    logger.warn(`Booking validation failed: ${error.details?.[0]?.message || 'Unknown error'}`);
    res.status(400).json({ error: error.details?.[0]?.message || 'Invalid input' });
    return;
  }

  const { event_id, seats } = value;
  const customer_id = req.user!.userId;
  try {
    // Check for duplicate booking
    const duplicateCheck = await pool.query(
      'SELECT id FROM bookings WHERE customer_id = $1 AND event_id = $2',
      [customer_id, event_id]
    );

    if (duplicateCheck.rows.length > 0) {
      logger.warn(`Duplicate booking attempt by user ${customer_id} for event ${event_id}`);
      res.status(400).json({ error: 'User has already booked this event' });
      return;
    }

    const result = await pool.query(
      'INSERT INTO bookings (customer_id, event_id, seats) VALUES ($1, $2, $3) RETURNING *',
      [customer_id, event_id, seats]
    );

    const booking: Booking = result.rows[0];

    // Background Task 1: Adding job to booking confirmation queue
    try {
      await bookingQueue.add('sendEmail', {
        booking_id: booking.id,
        customer_id,
        event_id,
        seats
      });
      logger.info(`Booking job enqueued for booking ID ${booking.id}`);
    } catch (queueError: any) {
      logger.error(`Failed to enqueue booking job for ID ${booking.id}: ${queueError.message}`);
    }
    console.log("Booking successful for customer id", customer_id);
    res.status(201).json({ message: 'Booking successful', booking });
  } catch (dbError: any) {
    logger.error(`Database error during booking: ${dbError.message}`);
    res.status(500).json({ error: 'Internal server error while processing booking' });
  }
});

// Update an event (Organizers Only)
app.put('/api/events/:id', authenticateToken, authorizeRole('organizer'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { error, value } = eventSchema.validate(req.body);
  if (error) {
    logger.warn(`Event update validation failed: ${error.details?.[0]?.message || 'Unknown error'}`);
    res.status(400).json({ error: error.details?.[0]?.message || 'Invalid input' });
    return;
  }

  const { name, date, location } = value;

  try {
    const result = await pool.query(
      'UPDATE events SET name = $1, date = $2, location = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [name, date, location, id]
    );

    if (result.rowCount === 0) {
      logger.warn(`Event update attempted on non-existent ID ${id}`);
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const event: Event = result.rows[0];

    // Background Task 2: Adding job to event update notification queue
    try {
      await eventUpdateQueue.add('notifyCustomers', {
        event_id: event.id,
        event_name: event.name
      });
      logger.info(`Event update job enqueued for event ID ${event.id}`);
    } catch (queueError: any) {
      logger.error(`Failed to enqueue event update job for ID ${event.id}: ${queueError.message}`);
    }

    res.json({ message: 'Event updated successfully', event });
  } catch (dbError: any) {
    logger.error(`Database error during event update: ${dbError.message}`);
    res.status(500).json({ error: 'Internal server error while updating event' });
  }
});

app.use((err: Error, req: Request, res: Response, next: Function) => {
  logger.error(`Unhandled API error: ${err.message}`);
  res.status(500).json({ error: 'Critical system error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`API Server running on port ${PORT}`);
});
