import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import * as sdk from 'matrix-js-sdk';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { getUserMatrixClient } from '../utils/matrixClient.js';

const prisma = new PrismaClient();

// Map to store active client connections by user ID
const activeClients: Map<number, { 
  socketId: string, 
  matrixClient: sdk.MatrixClient 
}> = new Map();

export const initSocketServer = (server: HttpServer) => {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: number };
      
      // Store the user ID in the socket
      socket.data.userId = decoded.id;
      
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    
    try {
      const userId = socket.data.userId;
      
      // Set up Matrix client for this user
      const matrixClient = await getUserMatrixClient(userId);
      
      // Store in our active clients map
      activeClients.set(userId, { 
        socketId: socket.id, 
        matrixClient 
      });

      // Start the Matrix client
      matrixClient.startClient({ initialSyncLimit: 10 });
      
      // Wait for initial sync
      await new Promise<void>((resolve) => {
        const onSync = (state: string) => {
          if (state === 'PREPARED') {
            matrixClient.removeListener('sync' as any, onSync);
            resolve();
          }
        };
        matrixClient.on('sync' as any, onSync);
      });
      
      // Listen for Matrix events and forward to the socket
      matrixClient.on('Room.timeline' as any, (event: any, room: any) => {
        if (event.getType() === 'm.room.message') {
          const content = event.getContent();
          const sender = event.getSender();
          
          // Forward to connected client
          socket.emit('message', {
            roomId: room.roomId,
            eventId: event.getId(),
            sender,
            content,
            timestamp: event.getDate().toISOString()
          });
        }
      });
      
      // Listen for typing indicators
      matrixClient.on('RoomMember.typing' as any, (event: any, member: any) => {
        socket.emit('typing', {
          roomId: member.roomId,
          userId: member.userId,
          typing: member.typing
        });
      });
      
      // Handle room list request
      socket.on('getRooms', async () => {
        const rooms = matrixClient.getRooms();
        const formattedRooms = rooms.map(room => ({
          roomId: room.roomId,
          name: room.name,
          avatarUrl: room.getAvatarUrl(process.env.MATRIX_BASE_URL!, 96, 96, 'scale', false),
          lastMessage: room.timeline && room.timeline.length > 0 
            ? (room.timeline[room.timeline.length - 1]?.event?.content?.body || '') 
            : '',
          isDirect: Boolean(room.getDMInviter?.())
        }));
        
        socket.emit('roomList', formattedRooms);
      });
      
      // Handle room message history request
      socket.on('getRoomMessages', async (roomId) => {
        const room = matrixClient.getRoom(roomId);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }
        
        const messages = room.timeline
          .filter(event => event.getType() === 'm.room.message')
          .map(event => ({
            eventId: event.getId(),
            sender: event.getSender(),
            content: event.getContent(),
            timestamp: (event.getDate()?.toISOString() || new Date().toISOString())
          }));
        
        socket.emit('roomMessages', { roomId, messages });
      });
      
      // Handle sending messages
      socket.on('sendMessage', async (data) => {
        try {
          const { roomId, message } = data;
          const content = {
            body: message,
            msgtype: 'm.text'
          };
          
          const result = await matrixClient.sendEvent(roomId, 'm.room.message' as any, content);
          socket.emit('messageSent', { roomId, eventId: result.event_id });
        } catch (error) {
          console.error('Send message error:', error);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });
      
      // Handle typing indicators
      socket.on('typing', (data) => {
        const { roomId, typing } = data;
        matrixClient.sendTyping(roomId, typing, 30000);
      });
      
      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (activeClients.has(userId)) {
          const client = activeClients.get(userId);
          if (client?.matrixClient) {
            client.matrixClient.stopClient();
          }
          activeClients.delete(userId);
        }
      });
      
    } catch (error) {
      console.error('Socket setup error:', error);
      socket.emit('error', { message: 'Failed to set up real-time connection' });
      socket.disconnect();
    }
  });

  return io;
};