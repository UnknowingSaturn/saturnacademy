/**
 * Trade Journal Bridge - Local Relay Server
 * 
 * This server bridges MT5 WebRequest (which has SSL/TLS limitations)
 * to the Supabase Edge Function for trade event ingestion.
 * 
 * Run this on the same machine as MT5.
 * 
 * Usage:
 *   node relay-server.js
 * 
 * Environment Variables:
 *   SUPABASE_URL     - Your Supabase project URL
 *   PORT             - Server port (default: 8080)
 */

const http = require('http');
const https = require('https');

// Configuration
const PORT = process.env.PORT || 8080;
const HOST = '127.0.0.1';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soosdjmnpcyuqppdjsse.supabase.co';
const EDGE_FUNCTION_PATH = '/functions/v1/ingest-events';

// Request statistics
let stats = {
  started: new Date().toISOString(),
  requests: 0,
  successful: 0,
  failed: 0,
  duplicates: 0
};

/**
 * Parse JSON body from request
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Limit body size to 1MB
      if (body.length > 1024 * 1024) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Forward request to Supabase Edge Function
 */
function forwardToSupabase(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    
    const url = new URL(SUPABASE_URL + EDGE_FUNCTION_PATH);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-api-key': apiKey
      }
    };
    
    const req = https.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', chunk => {
        responseBody += chunk.toString();
      });
      
      res.on('end', () => {
        try {
          const responseData = responseBody ? JSON.parse(responseBody) : {};
          resolve({
            statusCode: res.statusCode,
            body: responseData
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: { message: responseBody }
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    // Set timeout
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * Log with timestamp
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}`;
  
  if (data) {
    console.log(logLine, JSON.stringify(data, null, 2));
  } else {
    console.log(logLine);
  }
}

/**
 * Create HTTP server
 */
const server = http.createServer(async (req, res) => {
  // CORS headers for browser testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const url = req.url;
  
  // Health check endpoint
  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Trade Journal Bridge Relay',
      version: '1.0.0',
      stats: stats
    }));
    return;
  }
  
  // Stats endpoint
  if (url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
    return;
  }
  
  // Main trade ingestion endpoint
  if (url === '/api/trades' && req.method === 'POST') {
    stats.requests++;
    
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      stats.failed++;
      log('WARN', 'Missing API key');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing x-api-key header' }));
      return;
    }
    
    try {
      const payload = await parseBody(req);
      
      log('INFO', `Received event: ${payload.event_type} for ${payload.symbol}`, {
        idempotency_key: payload.idempotency_key,
        terminal_id: payload.terminal_id
      });
      
      // Forward to Supabase
      const response = await forwardToSupabase(apiKey, payload);
      
      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (response.body.status === 'duplicate') {
          stats.duplicates++;
          log('INFO', 'Duplicate event (already processed)');
        } else {
          stats.successful++;
          log('INFO', `Event forwarded successfully`, { 
            event_id: response.body.event_id,
            trade_id: response.body.trade_id 
          });
        }
      } else {
        stats.failed++;
        log('ERROR', `Supabase error: ${response.statusCode}`, response.body);
      }
      
      res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
      
    } catch (error) {
      stats.failed++;
      log('ERROR', `Request failed: ${error.message}`);
      
      if (error.message === 'Invalid JSON') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Failed to forward to backend',
          message: error.message 
        }));
      }
    }
    return;
  }
  
  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start server
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         Trade Journal Bridge - Relay Server               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Server running on http://${HOST}:${PORT}                  ║`);
  console.log('║                                                           ║');
  console.log('║  Endpoints:                                               ║');
  console.log('║    POST /api/trades  - Forward trade events               ║');
  console.log('║    GET  /health      - Health check                       ║');
  console.log('║    GET  /stats       - Request statistics                 ║');
  console.log('║                                                           ║');
  console.log('║  Press Ctrl+C to stop                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  log('INFO', 'Relay server started');
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('INFO', 'Shutting down...');
  server.close(() => {
    log('INFO', 'Server stopped');
    console.log('\nFinal stats:', stats);
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  log('ERROR', `Uncaught exception: ${error.message}`);
  console.error(error.stack);
});
