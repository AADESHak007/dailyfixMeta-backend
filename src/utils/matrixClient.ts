import * as sdk from 'matrix-js-sdk';
import { PrismaClient } from '@prisma/client';
import config from '../config/matrix.js';

const prisma = new PrismaClient();

// Define our own extended MatrixClient type
export type ExtendedMatrixClient = sdk.MatrixClient & {
  initRustCrypto?: (opts: { useIndexedDB?: boolean }) => Promise<void>;
  uploadKeys?: () => Promise<any>;
  sendMessage?: (roomId: string, content: any) => Promise<{event_id: string}>;
  sendTextMessage?: (roomId: string, text: string) => Promise<{event_id: string}>;
};

export interface MatrixClientOpts {
  baseUrl: string;
  accessToken?: string;
  userId?: string;
  deviceId?: string;
}

// Debug function to check available methods
export const debugMatrixClient = (client: ExtendedMatrixClient) => {
  console.log('Matrix Client Debug:');
  console.log('- Has initRustCrypto:', typeof client.initRustCrypto === 'function');
  console.log('- Has sendMessage:', typeof client.sendMessage === 'function');
  console.log('- Has sendTextMessage:', typeof client.sendTextMessage === 'function');
  console.log('- Has sendEvent:', typeof client.sendEvent === 'function');
  
  // List all methods for debugging
  console.log('Available methods:');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    .filter(name => typeof (client as any)[name] === 'function')
    .slice(0, 20); // Just show first 20 to avoid console spam
  
  console.log(methods);
};

// Create a Matrix client instance
export const createMatrixClient = (opts: MatrixClientOpts): ExtendedMatrixClient => {
  const client = sdk.createClient({
    baseUrl: opts.baseUrl,
    accessToken: opts.accessToken,
    userId: opts.userId,
    deviceId: opts.deviceId,
  }) as ExtendedMatrixClient;
  
  // Debug the client
  debugMatrixClient(client);
  
  return client;
};

// Initialize Olm for encryption
export const initOlm = async (): Promise<void> => {
  if (!global.Olm) {
    try {
      // Import Olm dynamically
      const Olm = await import('@matrix-org/olm');
      global.Olm = Olm;
    } catch (error) {
      console.error('Failed to load Olm library:', error);
      throw new Error('Encryption support not available: Failed to load Olm library');
    }
  }
};

// Get or create a Matrix client for a user
export const getUserMatrixClient = async (userId: number): Promise<ExtendedMatrixClient> => {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user || !user.matrixAccessToken || !user.matrixUserId) {
    throw new Error('User not authenticated with Matrix');
  }

  return createMatrixClient({
    baseUrl: config.baseUrl,
    accessToken: user.matrixAccessToken ?? undefined,
    userId: user.matrixUserId ?? undefined,
    deviceId: user.matrixDeviceId ?? undefined,
  });
};