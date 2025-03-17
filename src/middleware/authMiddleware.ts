import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DecodedToken {
  id: number;
}

export const protect = async (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  try {
    let token;
    
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;
      
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          username: true,
          matrixUserId: true,
          matrixAccessToken: true
        }
      });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Check if session exists
      const session = await prisma.session.findFirst({
        where: {
          userId: user.id,
          token
        }
      });
      
      if (!session) {
        throw new Error('Session expired');
      }
      
      // Attach user to request
      (req as any).user = user;
      
      next();
    } else {
      throw new Error('Not authorized, no token');
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ 
      message: error instanceof Error ? error.message : 'Not authorized' 
    });
  }
};