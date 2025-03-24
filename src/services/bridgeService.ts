import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import bridgeConfig from '../config/bridge.js';
import { syncMatrixRooms } from './matrixService.js';

const prisma = new PrismaClient();

// Define types for the API
interface InstagramCookies {
  sessionid?: string;
  csrftoken?: string;
  mid?: string;
  ig_did?: string;
  ds_user_id?: string;
  [key: string]: string | undefined;
}

interface BridgeLoginResponse {
  puppetId?: string;
  userId?: string;
  success?: boolean;
  error?: string;
}

// Add these interface definitions at the top of your file, after the existing interfaces
interface PingResponse {
  success: boolean;
}

interface LoginResponse {
  puppetId: string;
  error?: string;
}

interface ListResponse {
  puppets: Array<{
    userId: string;
    [key: string]: any;
  }>;
}

/**
 * Service for interacting with the mautrix-meta bridge provisioning API
 */
export class BridgeService {
  private baseUrl: string;
  private secret: string;
  
  constructor() {
    this.baseUrl = bridgeConfig.url;
    this.secret = bridgeConfig.sharedSecret;
  }
  
  /**
   * Check if the bridge API is available
   */
  async pingBridge(): Promise<boolean> {
    try {
      console.log(`Attempting to ping bridge at ${this.baseUrl}${bridgeConfig.endpoints.ping}`);
      console.log(`Using shared secret: ${this.secret.substring(0, 5)}...`);
      
      // Try the main approach first
      try {
        const response = await fetch(`${this.baseUrl}${bridgeConfig.endpoints.ping}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.secret}`,
            'Accept': 'application/json',
          }
        });
        
        console.log(`Ping response status: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json() as PingResponse;
          console.log(`Ping response data:`, data);
          return data.success === true;
        }
        
        // If response not ok, try to get error details
        try {
          const errorData = await response.text();
          console.error(`Bridge ping failed with status ${response.status}:`, errorData);
        } catch (e) {
          console.error(`Bridge ping failed with status ${response.status}, could not parse error response`);
        }
      } catch (mainError) {
        console.error('Error with main ping attempt:', mainError);
      }
      
      // Try alternate approach with a slightly different URL format
      try {
        console.log('Trying alternate approach...');
        const altResponse = await fetch(`${this.baseUrl}/_matrix/provision/v1/ping`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.secret}`,
            'Accept': 'application/json',
          }
        });
        
        console.log(`Alternate ping response status: ${altResponse.status}`);
        
        if (altResponse.ok) {
          const altData = await altResponse.json() as PingResponse;
          console.log(`Alternate ping response data:`, altData);
          return altData.success === true;
        }
        
        const altErrorData = await altResponse.text();
        console.error(`Alternate ping failed with status ${altResponse.status}:`, altErrorData);
      } catch (altError) {
        console.error('Error with alternate ping attempt:', altError);
      }
      
      // For debugging, check if the server is responding at all
      try {
        console.log('Checking if server is up at all...');
        const baseResponse = await fetch(this.baseUrl, {
          method: 'GET',
        });
        console.log(`Base URL response status: ${baseResponse.status}`);
      } catch (baseError) {
        console.error('Server base URL not responding:', baseError);
      }
      
      return false;
    } catch (error) {
      console.error('Error pinging bridge:', error);
      // More detailed error logging
      if (error instanceof Error) {
        console.error(`Error type: ${error.name}, Message: ${error.message}`);
        if (error.stack) {
          console.error(`Stack trace: ${error.stack}`);
        }
      }
      return false;
    }
  }
  
  /**
   * Log in to Instagram using the provisioning API
   */
  async loginToInstagram(userId: number, cookies: InstagramCookies): Promise<BridgeLoginResponse> {
    try {
      // Find the user in the database
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      
      if (!user || !user.matrixUserId) {
        throw new Error('User not authenticated with Matrix');
      }
      
      console.log(`Attempting to log in to Instagram for Matrix user: ${user.matrixUserId}`);
      
      // Filter to include only necessary cookies
      const requiredCookies = ['sessionid', 'csrftoken', 'mid', 'ig_did', 'ds_user_id'];
      const formattedCookies: Record<string, string> = {};
      
      for (const key of requiredCookies) {
        if (cookies[key]) {
          formattedCookies[key] = cookies[key] as string;
        }
      }
      
      // Check if we have the critical sessionid cookie
      if (!formattedCookies.sessionid) {
        throw new Error('Missing critical Instagram sessionid cookie');
      }
      
      console.log('Sending login request to mautrix-meta bridge API');
      
      // Make the API request to the bridge
      const response = await fetch(`${this.baseUrl}${bridgeConfig.endpoints.login}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.matrixUserId,
          cookies: formattedCookies
        })
      });
      
      const data = await response.json() as LoginResponse;
      
      if (!response.ok) {
        console.error('Bridge API login failed:', data);
        return {
          success: false,
          error: data.error || 'Failed to log in to Instagram via bridge'
        };
      }
      
      console.log('Successfully logged in to Instagram via bridge API');
      
      // Sync rooms to catch new Instagram rooms
      await syncMatrixRooms(userId);
      
      return {
        success: true,
        puppetId: data.puppetId,
        userId: user.matrixUserId
      };
    } catch (error: any) {
      console.error('Error in loginToInstagram:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Log out from Instagram
   */
  async logoutFromInstagram(userId: number): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      
      if (!user || !user.matrixUserId) {
        throw new Error('User not authenticated with Matrix');
      }
      
      console.log(`Attempting to log out from Instagram for Matrix user: ${user.matrixUserId}`);
      
      const response = await fetch(`${this.baseUrl}${bridgeConfig.endpoints.logout}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.matrixUserId
        })
      });
      
      if (!response.ok) {
        const data = await response.json();
        console.error('Bridge API logout failed:', data);
        return false;
      }
      
      console.log('Successfully logged out from Instagram via bridge API');
      return true;
    } catch (error) {
      console.error('Error in logoutFromInstagram:', error);
      return false;
    }
  }
  
  /**
   * List all Instagram puppets for this user
   */
  async listInstagramAccounts(matrixUserId: string): Promise<any[]> {
    try {
      console.log(`Fetching Instagram accounts for Matrix user: ${matrixUserId}`);
      
      const response = await fetch(`${this.baseUrl}${bridgeConfig.endpoints.listUsers}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.secret}`,
        }
      });
      
      if (!response.ok) {
        const data = await response.json();
        console.error('Bridge API list failed:', data);
        return [];
      }
      
      const data = await response.json() as ListResponse;
      
      // Filter to only show puppets belonging to this user
      const userPuppets = data.puppets.filter((puppet: any) => 
        puppet.userId === matrixUserId
      );
      
      console.log(`Found ${userPuppets.length} Instagram accounts for user`);
      return userPuppets;
    } catch (error) {
      console.error('Error in listInstagramAccounts:', error);
      return [];
    }
  }
}

// Export a singleton instance
export const bridgeService = new BridgeService(); 