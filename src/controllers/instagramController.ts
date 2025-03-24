import { Request, Response } from 'express';
import { 
  findOrCreateMetaBotRoom, 
  sendInstagramLoginCommand, 
  startListeningForMetaBotResponses,
  stopListeningForMetaBotResponses,
  syncMatrixRooms,
  getInstagramLoginStatus,
  sendUnencryptedCurlCommand,
  sendRustCurlCommand
} from '../services/matrixService.js';
import { createMatrixClient } from '../utils/matrixClient.js';
import { parseCurlCommand } from '../utils/curlParser.js';
import config from '../config/matrix.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const connectToInstagram = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    // Step 1: Sync rooms to ensure we have the latest data
    console.log('Syncing rooms before Instagram connection...');
    await syncMatrixRooms(userId);
    
    // Step 2: Find or create a metabot room
    console.log('Finding or creating metabot room...');
    const { roomId, existing } = await findOrCreateMetaBotRoom(userId);
    
    // Step 3: Start listening for metabot responses
    console.log('Starting listener for metabot responses...');
    await startListeningForMetaBotResponses(userId, roomId);
    
    // Step 4: Send the login command
    console.log('Sending Instagram login command...');
    await sendInstagramLoginCommand(userId, roomId);
    
    res.json({
      success: true,
      message: 'Instagram connection process initiated',
      roomId,
      roomExisted: existing
    });
  } catch (error) {
    console.error('Error connecting to Instagram:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to connect to Instagram'
    });
  }
};

// Updated function to send a curl command to the metabot room with encryption
export const sendCurlCommand = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { curlCommand, roomId } = req.body;
    
    if (!curlCommand || !roomId) {
      return res.status(400).json({
        success: false,
        message: 'Curl command and room ID are required'
      });
    }

    console.log(`Sending curl command to room ${roomId} (encrypted with Rust crypto)...`);
    console.log(`Curl command: ${curlCommand.substring(0, 100)}...`);
    
    // Send with Rust encryption - no fallback to unencrypted
    try {
      const result = await sendRustCurlCommand(userId, roomId, curlCommand);
      
      res.json({
        success: true,
        message: 'Curl command sent successfully'
      });
    } catch (error) {
      console.error('Error sending encrypted curl command:', error);
      throw new Error('Failed to send encrypted curl command');
    }
  } catch (error) {
    console.error('Error sending curl command:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send curl command'
    });
  }
};

// New function to send a structured curl command to the metabot room
export const sendStructuredCurlCommand = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { roomId, method, url, headers, cookies, data } = req.body;
    
    if (!roomId) {
      res.status(400).json({
        success: false,
        message: 'Room ID is required'
      });
      return;
    }

    if (!url) {
      res.status(400).json({
        success: false,
        message: 'URL is required'
      });
      return;
    }
    
    console.log(`[CURL] Building structured curl command for room ${roomId}`);
    
    // Build the curl command from structured data
    let curlCommand = `curl '${url}'`;
    
    // Add method if specified (default is GET)
    if (method && method.toUpperCase() !== 'GET') {
      curlCommand += ` -X ${method.toUpperCase()}`;
    }
    
    // Add headers
    if (headers && typeof headers === 'object') {
      Object.entries(headers).forEach(([key, value]) => {
        curlCommand += ` \\\n  -H '${key}: ${value}'`;
      });
    }
    
    // Add cookies
    if (cookies && typeof cookies === 'object') {
      const cookieString = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
      
      if (cookieString) {
        curlCommand += ` \\\n  -b '${cookieString}'`;
      }
    } else if (cookies && typeof cookies === 'string') {
      curlCommand += ` \\\n  -b '${cookies}'`;
    }
    
    // Add data
    if (data) {
      if (typeof data === 'object') {
        // For form data or JSON
        if (headers && 
            headers['content-type'] && 
            headers['content-type'].includes('application/json')) {
          // JSON data
          curlCommand += ` \\\n  --data '${JSON.stringify(data)}'`;
        } else if (headers && 
                  headers['content-type'] && 
                  headers['content-type'].includes('application/x-www-form-urlencoded')) {
          // Form data
          const formString = Object.entries(data)
            .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
            .join('&');
          curlCommand += ` \\\n  --data-raw '${formString}'`;
        } else {
          // Default to form data
          const formString = Object.entries(data)
            .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
            .join('&');
          curlCommand += ` \\\n  --data-raw '${formString}'`;
        }
      } else if (typeof data === 'string') {
        // Raw data string
        curlCommand += ` \\\n  --data-raw '${data}'`;
      }
    }
    
    console.log(`[CURL] Built command: ${curlCommand.substring(0, 100)}...`);
    
    // Try with the new Rust crypto method first
    try {
      console.log('Attempting to send structured curl command with Rust encryption...');
      const result = await sendRustCurlCommand(userId, roomId, curlCommand);
      
      res.json({
        success: true,
        message: result.encrypted ? 'Encrypted curl command sent successfully' : 'Curl command sent successfully',
        eventId: result.eventId,
        encrypted: result.encrypted
      });
    } catch (rustError) {
      console.error('Rust crypto approach failed:', rustError);
      
      // Fall back to unencrypted method
      console.log('Falling back to unencrypted method...');
      const fallbackResult = await sendUnencryptedCurlCommand(userId, roomId, curlCommand);
      
      res.json({
        success: true,
        message: 'Curl command sent successfully (unencrypted fallback)',
        eventId: fallbackResult.eventId,
        encrypted: false
      });
    }
  } catch (error) {
    console.error('[CURL] Error sending structured curl command:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send curl command'
    });
  }
};

export const getLoginUrl = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    console.log(`[DIRECT] getLoginUrl called for user ${userId}`);
    
    // Find user's Matrix credentials
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user || !user.matrixAccessToken || !user.matrixUserId) {
      throw new Error('User not authenticated with Matrix');
    }
    
    // Create Matrix client
    const matrixClient = createMatrixClient({
      baseUrl: config.baseUrl,
      accessToken: user.matrixAccessToken ?? undefined,
      userId: user.matrixUserId ?? undefined,
      deviceId: user.matrixDeviceId ?? undefined
    });
    
    // Start client and sync
    await matrixClient.startClient({ initialSyncLimit: 20 });
    
    await new Promise<void>((resolve) => {
      const onSync = (state: string) => {
        if (state === 'PREPARED') {
          matrixClient.removeListener('sync' as any, onSync);
          resolve();
        }
      };
      matrixClient.on('sync' as any, onSync);
    });
    
    // Get all rooms
    const rooms = matrixClient.getRooms();
    console.log(`[DIRECT] Found ${rooms.length} rooms`);
    
    // First, try to find a room with the metabot
    let metabotRooms = rooms.filter(room => 
      room.getMembers().some(member => member.userId === '@metabot:localhost')
    );
    
    console.log(`[DIRECT] Found ${metabotRooms.length} rooms with metabot`);
    
    // Search for Instagram URL in metabot rooms
    let foundUrl = null;
    let foundTimestamp = null;
    
    // Search function to find Instagram URLs in room timeline
    const searchRoomForUrl = (room: any) => {
      if (!room.timeline || room.timeline.length === 0) return null;
      
      console.log(`[DIRECT] Searching for URL in room: ${room.roomId} (${room.name || 'Unnamed'}) with ${room.timeline.length} messages`);
      
      // Look through recent messages (newest first)
      for (let i = room.timeline.length - 1; i >= 0; i--) {
        const event = room.timeline[i];
        
        // Only check messages from the metabot
        if (event.getSender() === '@metabot:localhost' && event.getType() === 'm.room.message') {
          const content = event.getContent();
          
          if (content.msgtype === 'm.text') {
            const body = content.body;
            
            // Search for Instagram URL
            const loginUrlRegex = /https?:\/\/(?:www\.)?instagram\.com\/?[^\s]*/;
            const urlMatch = body.match(loginUrlRegex);
            
            if (urlMatch) {
              console.log(`[DIRECT] Found Instagram URL: ${urlMatch[0]} in message: "${body.substring(0, 50)}..."`);
              return {
                url: urlMatch[0],
                timestamp: new Date(event.getDate() || Date.now()).toISOString()
              };
            }
          }
        }
      }
      return null;
    };
    
    // Check metabot rooms first
    for (const room of metabotRooms) {
      const result = searchRoomForUrl(room);
      if (result) {
        foundUrl = result.url;
        foundTimestamp = result.timestamp;
        break;
      }
    }
    
    // If no URL found in metabot rooms, check all rooms
    if (!foundUrl && rooms.length > metabotRooms.length) {
      console.log(`[DIRECT] No URL found in metabot rooms, checking all rooms`);
      
      for (const room of rooms) {
        // Skip already checked metabot rooms
        if (metabotRooms.includes(room)) continue;
        
        const result = searchRoomForUrl(room);
        if (result) {
          foundUrl = result.url;
          foundTimestamp = result.timestamp;
          break;
        }
      }
    }
    
    // Always clean up the client
    matrixClient.stopClient();
    
    if (foundUrl) {
      console.log(`[DIRECT] Successfully found Instagram URL: ${foundUrl}`);
      res.json({
        success: true,
        url: foundUrl,
        timestamp: foundTimestamp,
        method: 'direct_fetch'
      });
    } else {
      console.log(`[DIRECT] No Instagram URL found in any room`);
      res.json({
        success: false,
        message: 'No Instagram login URL found in any room messages. Try again after sending the login command.'
      });
    }
  } catch (error) {
    console.error('[DIRECT] Error getting login URL:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get login URL'
    });
  }
};

export const checkInstagramStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    const status = await getInstagramLoginStatus(userId);
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Error checking Instagram status:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to check Instagram status'
    });
  }
};

export const disconnectFromInstagram = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    // Stop the matrix client listener
    await stopListeningForMetaBotResponses(userId);
    
    res.json({
      success: true,
      message: 'Disconnected from Instagram listener'
    });
  } catch (error) {
    console.error('Error disconnecting from Instagram:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to disconnect from Instagram'
    });
  }
};