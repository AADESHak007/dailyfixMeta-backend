import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { syncMatrixRooms as syncRooms } from '../services/matrixService.js';

const prisma = new PrismaClient();

export const getMatrixRooms = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    // Get rooms from database
    const rooms = await prisma.matrixRoom.findMany({
      orderBy: {
        lastMessageTime: 'desc'
      }
    });
    
    res.json(rooms);
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to get rooms'
    });
  }
};

export const syncMatrixRooms = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    const roomCount = await syncRooms(userId);
    
    res.json({
      message: `Successfully synced ${roomCount} rooms`
    });
  } catch (error) {
    console.error('Sync rooms error:', error);
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to sync rooms'
    });
  }
};