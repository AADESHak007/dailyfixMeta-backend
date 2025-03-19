import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { syncMatrixRooms as syncRooms, matrixEvents } from '../services/matrixService.js';

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
    
    // If no rooms found, try to sync first
    if (rooms.length === 0) {
      console.log('No rooms found, triggering sync...');
      await syncRooms(userId);
      
      // Get rooms again after sync
      const syncedRooms = await prisma.matrixRoom.findMany({
        orderBy: {
          lastMessageTime: 'desc'
        }
      });
      
      res.json(syncedRooms);
    } else {
      res.json(rooms);
    }
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
      success: true,
      message: `Successfully synced ${roomCount} rooms`
    });
  } catch (error) {
    console.error('Sync rooms error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to sync rooms'
    });
  }
};

// Add route to listen for incoming Matrix events via SSE
export const streamMatrixEvents = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial message
  res.write(`data: ${JSON.stringify({ event: 'connected', message: 'Connected to Matrix event stream' })}\n\n`);
  
  // Handlers for various events
  const loginUrlHandler = (data: any) => {
    if (data.userId === userId) {
      res.write(`data: ${JSON.stringify({ event: 'instagram_login_url', data })}\n\n`);
    }
  };
  
  const loginSuccessHandler = (data: any) => {
    if (data.userId === userId) {
      res.write(`data: ${JSON.stringify({ event: 'instagram_login_success', data })}\n\n`);
    }
  };
  
  const newRoomHandler = (data: any) => {
    if (data.userId === userId) {
      res.write(`data: ${JSON.stringify({ event: 'new_instagram_room', data })}\n\n`);
    }
  };
  
  // Register event handlers
  matrixEvents.on('instagram_login_url', loginUrlHandler);
  matrixEvents.on('instagram_login_success', loginSuccessHandler);
  matrixEvents.on('new_instagram_room', newRoomHandler);
  
  // Handle client disconnect
  req.on('close', () => {
    matrixEvents.off('instagram_login_url', loginUrlHandler);
    matrixEvents.off('instagram_login_success', loginSuccessHandler);
    matrixEvents.off('new_instagram_room', newRoomHandler);
  });
};