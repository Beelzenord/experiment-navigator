import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ContentHarvester } from './content_harvester.js';
import { Dataset } from 'crawlee';
import { z } from 'zod';

const PORT = Number(process.env.PORT) || 3000;

// Request schema for validation
const HarvestRequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50), // Limit to 50 URLs per request
  maxRequestsPerCrawl: z.number().int().positive().max(100).optional(),
  httpConcurrency: z.number().int().positive().max(20).optional(),
  jsConcurrency: z.number().int().positive().max(10).optional(),
});


// Response schema
interface HarvestResponse {
  success: boolean;
  data?: Array<unknown>;
  error?: string;
  stats?: {
    total: number;
    http: number;
    js: number;
  };
}

// Helper to parse JSON body
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON response
function sendJSON(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

// Handle CORS preflight
function handleCORS(res: ServerResponse): void {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

// Handle harvest request
async function handleHarvest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Parse and validate request
    const body = await parseBody(req);
    const validated = HarvestRequestSchema.parse(body);
    
    console.log(`[HTTP] Received harvest request for ${validated.urls.length} URL(s)`);
    
    // Create harvester instance
    const harvester = new ContentHarvester({
      startUrls: validated.urls,
      maxRequestsPerCrawl: validated.maxRequestsPerCrawl,
      httpConcurrency: validated.httpConcurrency,
      jsConcurrency: validated.jsConcurrency,
    });
    
    // Run harvester
    await harvester.run();
    
    // Get harvested data
    const dataset = await Dataset.open('content-harvest');
    const data = await dataset.getData();
    
    // Filter to only the requested URLs (in case of redirects or duplicates)
    const requestedUrls = new Set(validated.urls.map(url => url.toLowerCase()));
    const filteredItems = data.items.filter((item) => {
      const itemUrl = String(item.url || '').toLowerCase();
      return requestedUrls.has(itemUrl) || 
             Array.from(requestedUrls).some(reqUrl => itemUrl.startsWith(reqUrl));
    });
    
    // Count by render mode
    const httpCount = filteredItems.filter((item) => String(item.render_mode || '') === 'http').length;
    const jsCount = filteredItems.filter((item) => String(item.render_mode || '') === 'js').length;
    
    const response: HarvestResponse = {
      success: true,
      data: filteredItems,
      stats: {
        total: filteredItems.length,
        http: httpCount,
        js: jsCount,
      },
    };
    
    console.log(`[HTTP] Harvest completed: ${filteredItems.length} items (${httpCount} HTTP, ${jsCount} JS)`);
    sendJSON(res, 200, response);
    
  } catch (error) {
    console.error('[HTTP] Error handling harvest request:', error);
    
    let errorMessage = 'Internal server error';
    let statusCode = 500;
    
    if (error instanceof z.ZodError) {
      errorMessage = `Validation error: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
      statusCode = 400;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    const response: HarvestResponse = {
      success: false,
      error: errorMessage,
    };
    
    sendJSON(res, statusCode, response);
  }
}

// Main request handler
async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    handleCORS(res);
    return;
  }
  
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  
  if (url.pathname === '/harvest') {
    if (req.method !== 'POST') {
      sendJSON(res, 405, { success: false, error: 'Method not allowed. Use POST.' });
      return;
    }
    await handleHarvest(req, res);
  } else if (url.pathname === '/health') {
    sendJSON(res, 200, { success: true, status: 'ok', timestamp: new Date().toISOString() });
  } else {
    sendJSON(res, 404, { success: false, error: 'Not found. Use /harvest endpoint.' });
  }
}

// Create and start server
export function startServer(port: number = PORT): void {
  try {
    const server = createServer(requestHandler);
    
    server.listen(port, () => {
      console.log(`🚀 Content Harvester HTTP Server running on port ${port}`);
      console.log(`📡 Endpoints:`);
      console.log(`   POST /harvest - Harvest content from URLs`);
      console.log(`   GET  /health  - Health check`);
      console.log(`\nExample request:`);
      console.log(`curl -X POST http://localhost:${port}/harvest \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"urls": ["https://example.com"]}'`);
    });
    
    server.on('error', (error: Error) => {
      console.error('[HTTP] Server error:', error);
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Try a different port with: PORT=8080 pnpm server`);
      }
      process.exit(1);
    });

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n[Server] Shutting down...');
      server.close(() => {
        console.log('[Server] Server closed');
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\n[Server] Shutting down...');
      server.close(() => {
        console.log('[Server] Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Run server if this file is executed directly
// This file is meant to be run directly, not imported
console.log('[Server] Initializing Content Harvester HTTP Server...');
startServer();

