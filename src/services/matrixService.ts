// import * as sdk from 'matrix-js-sdk';
import { PrismaClient } from '@prisma/client';
import { createMatrixClient, ExtendedMatrixClient } from '../utils/matrixClient.js';
import config from '../config/matrix.js';
import { EventEmitter } from 'events';

const prisma = new PrismaClient();

// Meta bot Matrix ID - update this with your actual metabot ID
export const META_BOT_ID = '@metabot:localhost';

// Event emitter for Matrix events
export const matrixEvents = new EventEmitter();

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
    
    // Get all current rooms from Matrix server
    const matrixRooms = matrixClient.getRooms();
    console.log(`Found ${matrixRooms.length} rooms on Matrix server`);
    
    // Get all rooms from database for this user
    const dbRooms = await prisma.matrixRoom.findMany();
    console.log(`Found ${dbRooms.length} rooms in local database`);
    
    // Create a Set of room IDs from Matrix for easy lookup
    const matrixRoomIds = new Set(matrixRooms.map(room => room.roomId));
    
    // Delete rooms from database that no longer exist on Matrix server
    const roomsToDelete = dbRooms.filter(room => !matrixRoomIds.has(room.roomId));
    
    if (roomsToDelete.length > 0) {
      console.log(`Deleting ${roomsToDelete.length} rooms that no longer exist on server`);
      
      for (const room of roomsToDelete) {
        await prisma.matrixRoom.delete({
          where: { roomId: room.roomId }
        });
      }
    }
    
    // Save rooms to database for faster access later
    for (const room of matrixRooms) {
      // Check if this is a bridged room
      const isInstagramBridge = room.getMembers().some(member => 
        member.userId.includes('@metabot:localhost')
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
          isInstagramBridge: isInstagramBridge
        },
        create: {
          roomId: room.roomId,
          name: room.name,
          avatarUrl: room.getAvatarUrl(config.baseUrl, 96, 96, 'scale', false),
          lastMessageTime: lastMessageDate,
          isEncrypted: isEncrypted,
          isInstagramBridge: isInstagramBridge
        }
      });
    }
    
    // Stop the client after we're done
    matrixClient.stopClient();
    
    return matrixRooms.length;
  } catch (error) {
    console.error('Matrix room sync error:', error);
    throw new Error('Failed to sync Matrix rooms');
  }
};

// New function to find or create a DM room with metabot

export const findOrCreateMetaBotRoom = async (userId: number) => {
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
    
    // Find existing DM room with metabot
    const rooms = matrixClient.getRooms();
    console.log(`Checking ${rooms.length} rooms for metabot DM`);
    console.log(`Looking for rooms with bot ID: ${META_BOT_ID}`);
    
    // Debug: Log all rooms and their members
    rooms.forEach(room => {
      const members = room.getMembers();
      console.log(`Room ${room.roomId} (${room.name || 'Unnamed'}) has ${members.length} members:`);
      members.forEach(member => console.log(`- ${member.userId} (${member.name})`));
    });
    
    const metabotRoom = rooms.find(room => {
      const members = room.getMembers();
      // Check if room has the metabot
      return members.some(member => member.userId === META_BOT_ID);
    });
    
    if (metabotRoom) {
      console.log(`Found existing metabot room: ${metabotRoom.roomId}`);
      matrixClient.stopClient();
      return { roomId: metabotRoom.roomId, existing: true };
    }
    
    // No existing room found, create a new DM with metabot
    console.log('Creating new metabot room...');
    const createRoomResponse = await matrixClient.createRoom({
      preset: 'private_chat' as any,
      invite: [META_BOT_ID],
      is_direct: true,
      visibility: 'private' as any,
      initial_state: [{
        type: 'm.room.encryption',
        state_key: '',
        content: {
          algorithm: 'm.megolm.v1.aes-sha2'
        }
      }]
    });
    
    // Wait for encryption to be set up
    await new Promise<void>((resolve) => {
      const checkEncryption = () => {
        const room = matrixClient.getRoom(createRoomResponse.room_id);
        if (room && room.currentState.getStateEvents('m.room.encryption').length > 0) {
          resolve();
        } else {
          setTimeout(checkEncryption, 1000);
        }
      };
      checkEncryption();
    });
    
    // Wait for the bot to join
    const roomId = createRoomResponse.room_id;
    console.log(`Created room ${roomId}, waiting for metabot to join...`);
    
    // Stop the client
    matrixClient.stopClient();
    
    return { roomId, existing: false };
  } catch (error) {
    console.error('Error finding/creating metabot room:', error);
    throw new Error('Failed to create chat with Instagram metabot');
  }
};

// Send Instagram login command to metabot
export const sendInstagramLoginCommand = async (userId: number, roomId: string) => {
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
    
    // Send the login command
    console.log(`Sending Instagram login command to room ${roomId}`);
    const result = await matrixClient.sendEvent(
      roomId,
      'm.room.message' as any,
      {
        msgtype: 'm.text',
        body: '!ig login'
      },
      undefined // txnId parameter
    );
    
    return { success: true, eventId: result.event_id };
  } catch (error) {
    console.error('Error sending Instagram login command:', error);
    throw new Error('Failed to send Instagram login command');
  }
};

// Start a client for listening to metabot responses
export const startListeningForMetaBotResponses = async (userId: number, roomId: string) => {
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
    
    // Track this client to avoid memory leaks
    // Store client reference with userId to allow stopping it later
    globalListeningClients[userId] = matrixClient;
    
    // Start client and listen for events
    await matrixClient.startClient({ initialSyncLimit: 20 });
    
    console.log(`[DEBUG] Started listening for metabot responses in room ${roomId}`);
    console.log(`[DEBUG] Looking for messages from bot ID: ${META_BOT_ID}`);
    
    // Set up event handler for login URL and other responses
    matrixClient.on('Room.timeline' as any, (event: any, room: any) => {
      // Enhanced debugging
      console.log(`[DEBUG] Message received in room: ${room.roomId}`);
      console.log(`[DEBUG] Expected room: ${roomId}`);
      console.log(`[DEBUG] Message sender: ${event.getSender()}`);
      console.log(`[DEBUG] Expected sender: ${META_BOT_ID}`);
      console.log(`[DEBUG] Event type: ${event.getType()}`);
      
      // Room ID check
      if (room.roomId !== roomId) {
        console.log(`[DEBUG] Ignoring message: wrong room ID`);
        return;
      }
      
      // Sender check
      if (event.getSender() !== META_BOT_ID) {
        console.log(`[DEBUG] Ignoring message: not from metabot`);
        return;
      }
      
      // Event type check
      if (event.getType() !== 'm.room.message') {
        console.log(`[DEBUG] Ignoring event: not a message`);
        return;
      }
      
      const content = event.getContent();
      console.log(`[DEBUG] Message content:`, content);
      
      // Check for text messages
      if (content.msgtype === 'm.text') {
        const body = content.body;
        console.log(`[DEBUG] Message body: ${body}`);
        
        // Look for login URL in the message with more flexible regex
        // This regex will match any URL containing instagram.com
        const loginUrlRegex = /https?:\/\/(?:www\.)?instagram\.com\/?[^\s]*/;
        const urlMatch = body.match(loginUrlRegex);
        
        console.log(`[DEBUG] URL match result:`, urlMatch);
        
        if (urlMatch) {
          const loginUrl = urlMatch[0];
          console.log(`[DEBUG] Found Instagram login URL: ${loginUrl} for user ${userId}`);
          
          // Emit an event with the login URL
          matrixEvents.emit('instagram_login_url', {
            userId,
            roomId,
            url: loginUrl,
            timestamp: new Date().toISOString()
          });
          
          console.log(`[DEBUG] Emitted instagram_login_url event for user ${userId}`);
        } else {
          console.log(`[DEBUG] No Instagram URL found in message`);
        }
        
        // Look for successful login confirmation
        if (body.includes('Successfully logged in') || body.includes('Login successful')) {
          console.log('Instagram login successful');
          
          // Emit success event
          matrixEvents.emit('instagram_login_success', {
            userId,
            roomId,
            timestamp: new Date().toISOString()
          });
          
          // Trigger a room sync to get new Instagram rooms
          syncMatrixRooms(userId).then(roomCount => {
            console.log(`Synced ${roomCount} rooms after successful login`);
          });
        }
      } else {
        console.log(`[DEBUG] Ignoring message: not text (msgtype: ${content.msgtype})`);
      }
    });
    
    // Set up listener for new rooms
    matrixClient.on('Room' as any, (room: any) => {
      // Check if this is a new Instagram bridge room
      const isInstagramRoom = room.getMembers().some((member: any) => 
        member.userId.includes('@instagram_')
      );
      
      if (isInstagramRoom) {
        console.log(`New Instagram room detected: ${room.roomId}`);
        
        // Emit new room event
        matrixEvents.emit('new_instagram_room', {
          userId,
          roomId: room.roomId,
          roomName: room.name,
          timestamp: new Date().toISOString()
        });
        
        // Trigger a room sync
        syncMatrixRooms(userId).then(roomCount => {
          console.log(`Synced ${roomCount} rooms after new room detection`);
        });
      }
    });
    
    return { success: true, message: 'Started listening for metabot responses' };
  } catch (error) {
    console.error('Error starting listener:', error);
    throw new Error('Failed to start listening for metabot responses');
  }
};

// Store matrix clients that are listening for events to avoid memory leaks
const globalListeningClients: Record<number, any> = {};

// Stop listening for a specific user
export const stopListeningForMetaBotResponses = async (userId: number) => {
  try {
    const client = globalListeningClients[userId];
    if (client) {
      console.log(`Stopping matrix client for user ${userId}`);
      client.stopClient();
      delete globalListeningClients[userId];
    }
    return { success: true, message: 'Stopped listening for metabot responses' };
  } catch (error) {
    console.error('Error stopping listener:', error);
    throw new Error('Failed to stop listening for metabot responses');
  }
};

// Get Instagram login status
export const getInstagramLoginStatus = async (userId: number) => {
  try {
    // Find Instagram bridged rooms
    const rooms = await prisma.matrixRoom.findMany({
      where: {
        isInstagramBridge: true
      }
    });
    
    return {
      isLoggedIn: rooms.length > 0,
      roomCount: rooms.length,
      rooms: rooms
    };
  } catch (error) {
    console.error('Error checking Instagram login status:', error);
    throw new Error('Failed to check Instagram login status');
  }
};

export const sendEncryptedCurlCommand = async (userId: number, roomId: string, curlCommand: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user || !user.matrixAccessToken || !user.matrixUserId) {
      throw new Error('User not authenticated with Matrix');
    }
    
    // Load Olm library
    if (!global.Olm) {
      try {
        // Import Olm dynamically
        const Olm = await import('@matrix-org/olm');
        global.Olm = Olm;
        console.log('Olm library loaded successfully');
      } catch (error) {
        console.error('Failed to load Olm library:', error);
      }
    }
    
    // Create a matrix client with our extended type
    const matrixClient: ExtendedMatrixClient = createMatrixClient({
      baseUrl: config.baseUrl,
      accessToken: user.matrixAccessToken ?? undefined,
      userId: user.matrixUserId ?? undefined,
      deviceId: user.matrixDeviceId ?? undefined
    });
    
    // Start the client without trying to initialize crypto
    await matrixClient.startClient({ initialSyncLimit: 1 });
    
    // Wait for the client to be ready
    await new Promise<void>((resolve) => {
      const onSync = (state: string) => {
        if (state === 'PREPARED') {
          matrixClient.removeListener('sync' as any, onSync);
          resolve();
        }
      };
      matrixClient.on('sync' as any, onSync);
    });
    
    // Send the message with error handling
    try {
      // Try using sendMessage which is a higher-level method that handles encryption automatically
      console.log(`Attempting to send message to room ${roomId}`);
      
      if (matrixClient.sendMessage) {
        const result = await matrixClient.sendMessage(roomId, {
          msgtype: 'm.text',
          body: curlCommand
        });
        
        matrixClient.stopClient();
        return { success: true, eventId: result.event_id };
      } else {
        console.log('sendMessage method not available, trying alternatives');
        throw new Error('sendMessage method not available');
      }
    } catch (sendError: any) {
      console.error('Error sending message with sendMessage:', sendError);
      
      // Fallback to sendTextMessage (another alternative to sendEvent)
      try {
        console.log('Falling back to sendTextMessage');
        
        if (matrixClient.sendTextMessage) {
          const fallbackResult = await matrixClient.sendTextMessage(roomId, curlCommand);
          matrixClient.stopClient();
          return { 
            success: true, 
            eventId: fallbackResult.event_id,
            warning: 'Sent with fallback method'
          };
        } else {
          console.log('sendTextMessage method not available, trying another alternative');
          throw new Error('sendTextMessage method not available');
        }
      } catch (fallbackError: any) {
        console.error('Fallback to sendTextMessage also failed:', fallbackError);
        
        // Last resort - try sending a plain event
        try {
          console.log('Attempting last resort: plain sendEvent');
          const lastResortResult = await matrixClient.sendEvent(
            roomId,
            'm.room.message' as any,
            {
              msgtype: 'm.text',
              body: curlCommand
            },
            undefined
          );
          
          matrixClient.stopClient();
          return { 
            success: true, 
            eventId: lastResortResult.event_id,
            warning: 'Sent as unencrypted message - encryption failed'
          };
        } catch (lastError: any) {
          console.error('All send attempts failed:', lastError);
          throw new Error(`Failed to send message after multiple attempts: ${lastError.message}`);
        }
      }
    }
  } catch (error) {
    console.error('Error in sendEncryptedCurlCommand:', error);
    throw error;
  }
};

// Add this new function that uses Rust crypto
export const sendRustCurlCommand = async (userId: number, roomId: string, curlCommand: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user || !user.matrixAccessToken || !user.matrixUserId) {
      throw new Error('User not authenticated with Matrix');
    }
    
    console.log('Creating Matrix client for encrypted communication...');
    
    // Create a matrix client with our extended type
    const matrixClient: ExtendedMatrixClient = createMatrixClient({
      baseUrl: config.baseUrl,
      accessToken: user.matrixAccessToken ?? undefined,
      userId: user.matrixUserId ?? undefined,
      deviceId: user.matrixDeviceId ?? undefined
    });
    
    // Initialize Rust Crypto - this is the key difference
    // We don't need to manually load Olm anymore
    if (matrixClient.initRustCrypto) {
      console.log('Initializing Rust crypto...');
      try {
        // Use in-memory store for Node.js
        await matrixClient.initRustCrypto({ useIndexedDB: false });
        console.log('Rust crypto initialized successfully');
      } catch (cryptoError) {
        console.error('Failed to initialize Rust crypto:', cryptoError);
        throw new Error('Failed to initialize encryption');
      }
    } else {
      console.warn('Rust crypto not available on this client');
    }
    
    // Start the client
    console.log('Starting Matrix client...');
    await matrixClient.startClient({ initialSyncLimit: 1 });
    
    // Wait for the client to be ready
    await new Promise<void>((resolve) => {
      const onSync = (state: string) => {
        if (state === 'PREPARED') {
          matrixClient.removeListener('sync' as any, onSync);
          resolve();
        }
      };
      matrixClient.on('sync' as any, onSync);
    });
    
    console.log('Matrix client ready');
    
    // Verify room is encrypted
    const room = matrixClient.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    
    const isEncrypted = room.currentState.getStateEvents('m.room.encryption').length > 0;
    console.log(`Room ${roomId} is${isEncrypted ? '' : ' not'} encrypted`);
    
    // Send the message
    try {
      console.log(`Sending ${isEncrypted ? 'encrypted' : 'unencrypted'} message to room ${roomId}`);
      const result = await matrixClient.sendEvent(
        roomId,
        'm.room.message' as any,
        {
          msgtype: 'm.text',
          body: curlCommand
        },
        undefined
      );
      
      matrixClient.stopClient();
      return { 
        success: true, 
        eventId: result.event_id,
        encrypted: isEncrypted
      };
    } catch (sendError: any) {
      console.error('Error sending message:', sendError);
      
      // Inside the catch block in sendRustCurlCommand
      // Replace the fallback to use sendEncryptedCurlCommand
      if (isEncrypted && sendError.message && sendError.message.includes('encryption')) {
        console.log('Encryption error, trying fallback with plain event...');
        
        try {
          // Try sending as a plain unencrypted message
          const fallbackResult = await matrixClient.sendEvent(
            roomId,
            'm.room.message' as any,
            {
              msgtype: 'm.text',
              body: curlCommand
            },
            undefined
          );
          
          matrixClient.stopClient();
          return { 
            success: true, 
            eventId: fallbackResult.event_id,
            encrypted: false
          };
        } catch (fallbackError) {
          console.error('Fallback also failed:', fallbackError);
          matrixClient.stopClient();
          throw fallbackError;
        }
      }
      
      matrixClient.stopClient();
      throw sendError;
    }
  } catch (error) {
    console.error('Error in sendRustCurlCommand:', error);
    throw error;
  }
};

export const sendUnencryptedCurlCommand = async (userId: number, roomId: string, curlCommand: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user || !user.matrixAccessToken || !user.matrixUserId) {
      throw new Error('User not authenticated with Matrix');
    }
    
    console.log('Creating Matrix client for unencrypted communication...');
    
    // Create a matrix client with our extended type
    const matrixClient: ExtendedMatrixClient = createMatrixClient({
      baseUrl: config.baseUrl,
      accessToken: user.matrixAccessToken ?? undefined,
      userId: user.matrixUserId ?? undefined,
      deviceId: user.matrixDeviceId ?? undefined
    });
    
    // Start the client without initializing crypto
    console.log('Starting Matrix client...');
    await matrixClient.startClient({ initialSyncLimit: 1 });
    
    // Wait for the client to be ready
    await new Promise<void>((resolve) => {
      const onSync = (state: string) => {
        if (state === 'PREPARED') {
          matrixClient.removeListener('sync' as any, onSync);
          resolve();
        }
      };
      matrixClient.on('sync' as any, onSync);
    });
    
    console.log('Matrix client ready');
    
    try {
      // Send a simple unencrypted message
      console.log(`Sending unencrypted message to room ${roomId}`);
      const result = await matrixClient.sendEvent(
        roomId,
        'm.room.message' as any,
        {
          msgtype: 'm.text',
          body: curlCommand
        },
        undefined
      );
      
      matrixClient.stopClient();
      return { 
        success: true, 
        eventId: result.event_id 
      };
    } catch (sendError) {
      console.error('Error sending unencrypted message:', sendError);
      matrixClient.stopClient();
      throw sendError;
    }
  } catch (error) {
    console.error('Error in sendUnencryptedCurlCommand:', error);
    throw error;
  }
};