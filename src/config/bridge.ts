/**
 * Configuration for connecting to the mautrix-meta bridge
 */
export default {
  // URL where the mautrix-meta bridge is running
  // Using the direct container IP address since localhost is not working
  url: 'http://172.16.10.106:29319',
  
  // The shared secret from your bridge's config.yaml
  // This should match what's in provisioning.shared_secret in the bridge config
  sharedSecret: 'ys5zft1N0m0MBXlI6Utg3gtGwUne4NypxpIVGDPiXIvo8bhx69zAXbVDxqe8q9vu',
  
  // Debug flag - set to true to enable detailed debugging
  debug: true,
  
  // Meta bot Matrix ID
  botUserId: '@metabot:localhost',
  
  // API endpoints for the provisioning API
  // Note: Ensure these match exactly with the bridge configuration
  endpoints: {
    ping: '/_matrix/provision/v1/ping',
    login: '/_matrix/provision/v1/login',
    logout: '/_matrix/provision/v1/logout',
    listUsers: '/_matrix/provision/v1/list',
  }
}; 