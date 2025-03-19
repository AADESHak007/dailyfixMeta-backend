/**
 * Utility to parse raw curl commands into structured objects
 */

interface CurlCommand {
  method: string;
  url: string;
  headers: Record<string, string>;
  cookies: string;
  data?: string | Record<string, any>;
}

/**
 * Parses a raw curl command into a structured object
 * @param curlString The raw curl command string
 * @returns Structured curl command object
 */
export function parseCurlCommand(curlString: string): CurlCommand {
  const result: CurlCommand = {
    method: 'GET',
    url: '',
    headers: {},
    cookies: '',
  };

  // Extract URL - usually the first argument after curl
  const urlMatch = curlString.match(/curl\s+['"]([^'"]+)['"]/);
  if (urlMatch && urlMatch[1]) {
    result.url = urlMatch[1];
  }

  // Extract method
  const methodMatch = curlString.match(/-X\s+([A-Z]+)/);
  if (methodMatch && methodMatch[1]) {
    result.method = methodMatch[1];
  } else if (curlString.includes('--data') || curlString.includes('-d ')) {
    // If no method is specified but data is included, assume POST
    result.method = 'POST';
  }

  // Extract headers
  const headerRegex = /-H\s+['"]([^:]+):\s*([^'"]+)['"]/g;
  let headerMatch;
  while ((headerMatch = headerRegex.exec(curlString)) !== null) {
    const key = headerMatch[1].trim();
    const value = headerMatch[2].trim();
    result.headers[key] = value;
  }

  // Extract cookies
  const cookieMatch = curlString.match(/-b\s+['"]([^'"]+)['"]/);
  if (cookieMatch && cookieMatch[1]) {
    result.cookies = cookieMatch[1];
  }

  // Extract data
  const dataRawMatch = curlString.match(/--data-raw\s+['"]([^'"]+)['"]/);
  if (dataRawMatch && dataRawMatch[1]) {
    result.data = dataRawMatch[1];
  } else {
    const dataMatch = curlString.match(/--data\s+['"]([^'"]+)['"]/);
    if (dataMatch && dataMatch[1]) {
      result.data = dataMatch[1];
    }
  }

  return result;
}

/**
 * Example usage:
 * const curlString = `curl 'https://api.example.com' -H 'Content-Type: application/json' --data '{"key":"value"}'`;
 * const parsedCommand = parseCurlCommand(curlString);
 * // Use with sendStructuredCurlCommand
 * // await sendStructuredCurlCommand({ ...req, body: { roomId: 'room123', ...parsedCommand } });
 */ 