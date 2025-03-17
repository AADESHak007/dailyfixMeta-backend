import sdk from 'matrix-js-sdk';
import { PrismaClient } from '@prisma/client';
import config from '../config/matrix.js';

const prisma = new PrismaClient();

export interface MatrixClientOpts {
  baseUrl: string;
  accessToken?: string;
  userId?: string;
  deviceId?: string;
}

// Create a Matrix client instance
export const createMatrixClient = (opts: MatrixClientOpts) => {
  return sdk.createClient({
    baseUrl: opts.baseUrl,
    accessToken: opts.accessToken,
    userId: opts.userId,
    deviceId: opts.deviceId,
  });
};

// Get or create a Matrix client for a user
export const getUserMatrixClient = async (userId: number) => {
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