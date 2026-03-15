import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import logger from './logger';

const JWT_SECRET = process.env.JWT_SECRET || 'dummy-secret-key';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    role: 'customer' | 'organizer';
  };
}

// Dummy JWT generator for testing
export const generateDummyToken = (userId: number, role: 'customer' | 'organizer') => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '1h' });
};

// Middleware to verify JWT token
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn(`Unauthorized API access attempt: No token provided on ${req.method} ${req.url}`);
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err: any) {
    logger.warn(`Forbidden API access attempt: Invalid token on ${req.method} ${req.url}`);
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// Middleware to restrict access based on roles
export const authorizeRole = (requiredRole: 'customer' | 'organizer') => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    if (req.user.role !== requiredRole) {
      logger.warn(`Forbidden API access attempt: User ${req.user.userId} (${req.user.role}) attempted to access ${requiredRole} route.`);
      res.status(403).json({ error: `Access denied. ${requiredRole} role required.` });
      return;
    }

    next();
  };
};
