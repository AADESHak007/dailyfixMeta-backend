import * as sdk from 'matrix-js-sdk';
import { PrismaClient } from '@prisma/client';
import { createMatrixClient } from '../utils/matrixClient.js';
import config from '../config/matrix.js';

const prisma = new PrismaClient();

export const registerMatrixUser = async (username: string, password: string) => {
  try {
    const matrixClient = createMatrixClient({
      baseUrl: config.baseUrl
    });
    
    // First, try to get the flow information
    try {
      // Register the user with Matrix homeserver using a multi-step approach
      const registrationResult = await matrixClient.register(
        username, 
        password,
        null, // device ID (optional)
        { type: 'm.login.dummy' } // Start with dummy auth
      );
      
      return {
        userId: registrationResult.user_id,
        accessToken: registrationResult.access_token,
        deviceId: registrationResult.device_id
      };
    } catch (regError: any) {
      // If the error is M_USER_INTERACTIVE, it means we need to complete auth stages
      if (regError.name === "MatrixError" && 
          regError.data && 
          regError.data.flows && 
          regError.data.session) {
            
        // Get the session ID
        const session = regError.data.session;
        
        // Find a flow that supports password login
        const flow = regError.data.flows.find((f: any) => 
          f.stages.includes('m.login.password') || 
          f.stages.includes('m.login.dummy')
        );
        
        if (!flow) {
          throw new Error('No suitable registration flow found');
        }
        
        // Complete the registration with the required auth
        const authData = {
          type: flow.stages[0], // Use the first stage
          session: session,
        };
        
        if (flow.stages[0] === 'm.login.password') {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          authData.password = password;
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          authData.identifier = {
            type: 'm.id.user',
            user: username
          };
        }
        
        // Complete registration with auth data
        const registration = await matrixClient.register(
          username,
          password,
          null, // deviceId
          authData
        );
        
        return {
          userId: registration.user_id,
          accessToken: registration.access_token,
          deviceId: registration.device_id
        };
      } else {
        // Some other error occurred
        throw regError;
      }
    }
  } catch (error: any) {
    // Check if this is an M_USER_IN_USE error
    if (error.errcode === 'M_USER_IN_USE') {
      throw new Error('Username already exists on Matrix server');
    }
    
    console.error('Matrix registration error:', error);
    throw new Error('Failed to register with Matrix server');
  }
};

export const loginMatrixUser = async (username: string, password: string) => {
  try {
    const matrixClient = createMatrixClient({
      baseUrl: config.baseUrl
    });
    
    // Login to Matrix
    const loginResponse = await matrixClient.login('m.login.password', {
      user: username,
      password: password
    });
    
    return {
      userId: loginResponse.user_id,
      accessToken: loginResponse.access_token,
      deviceId: loginResponse.device_id
    };
  } catch (error) {
    console.error('Matrix login error:', error);
    throw new Error('Failed to login with Matrix server');
  }
};

export const syncMatrixRooms = async (userId: number) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user || !user.matrixAccessToken || !user.matrixUserId) {
      throw new Error('User not authenticated with Matrix');
    }
    
    const matrixClient = createMatrixClient({
      baseUrl: config.baseUrl,
      accessToken: user.matrixAccessToken ?? undefined,
      userId: user.matrixUserId ?? undefined,
      deviceId: user.matrixDeviceId ?? undefined
    });
    
    // Start client and wait for initial sync
    await matrixClient.startClient({ initialSyncLimit: config.initialSyncLimit });
    
    await new Promise<void>((resolve) => {
      const onSync = (state: string) => {
        if (state === 'PREPARED') {
          matrixClient.removeListener('sync' as any, onSync);
          resolve();
        }
      };
      matrixClient.on('sync' as any, onSync);
    });
    
    // Get room list
    const rooms = matrixClient.getRooms();
    
    // Save rooms to database for faster access later
    for (const room of rooms) {
      // Check if this is a WhatsApp bridged room
      const isWhatsAppBridge = room.getMembers().some(member => 
        member.userId.includes('@whatsapp_') || member.userId.includes('@instagram_')
      );
      
      const lastMessageDate = room.timeline && room.timeline.length > 0 
        ? new Date(room.timeline[room.timeline.length - 1].getDate() || Date.now())
        : new Date();
          
      // Check for encryption using room state events
      const isEncrypted = Boolean(room.currentState.getStateEvents('m.room.encryption').length > 0);
      
      await prisma.matrixRoom.upsert({
        where: { roomId: room.roomId },
        update: { 
          name: room.name,
          avatarUrl: room.getAvatarUrl(config.baseUrl, 96, 96, 'scale', false),
          lastMessageTime: lastMessageDate,
          isEncrypted: isEncrypted,
          isWhatsAppBridge: isWhatsAppBridge
        },
        create: {
          roomId: room.roomId,
          name: room.name,
          avatarUrl: room.getAvatarUrl(config.baseUrl, 96, 96, 'scale', false),
          lastMessageTime: lastMessageDate,
          isEncrypted: isEncrypted,
          isWhatsAppBridge: isWhatsAppBridge
        }
      });
    }
    
    // Stop the client after we're done
    matrixClient.stopClient();
    
    return rooms.length;
  } catch (error) {
    console.error('Matrix room sync error:', error);
    throw new Error('Failed to sync Matrix rooms');
  }
};