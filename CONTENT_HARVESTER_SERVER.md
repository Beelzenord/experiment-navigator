# Content Harvester HTTP Server

HTTP server for the Content Harvester, designed for n8n integration.

## Usage

### Start the server

```bash
pnpm server
```

Or with a custom port:

```bash
PORT=8080 pnpm server
```

### Endpoints

#### POST `/harvest`

Harvest content from one or more URLs.

**Request Body:**
```json
{
  "urls": ["https://example.com", "https://another.com"],
  "maxRequestsPerCrawl": 10,  // optional, default: 100
  "httpConcurrency": 10,       // optional, default: 10
  "jsConcurrency": 5           // optional, default: 5
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "url": "https://example.com",
      "fetched_at": "2025-11-11T23:30:19.328Z",
      "render_mode": "http",
      "title": "Example Page",
      "main_text": "...",
      ...
    }
  ],
  "stats": {
    "total": 2,
    "http": 2,
    "js": 0
  }
}
```

**Limits:**
- Maximum 50 URLs per request
- Maximum 100 requests per crawl
- Maximum 20 HTTP concurrency
- Maximum 10 JS concurrency

#### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2025-11-11T23:30:19.328Z"
}
```

## n8n Integration

### HTTP Request Node Configuration

1. **Method:** POST
2. **URL:** `http://localhost:3000/harvest` (or your server URL)
3. **Headers:**
   - `Content-Type: application/json`
4. **Body (JSON):**
   ```json
   {
     "urls": ["{{ $json.url }}"]
   }
   ```

### Example Workflow

1. **Webhook** node receives URL
2. **HTTP Request** node calls `/harvest` endpoint
3. **Set** node extracts harvested data
4. **Continue** with processed data

## CORS

The server includes CORS headers, allowing requests from any origin. This is suitable for n8n integration but should be restricted in production.

## Error Handling

The server returns appropriate HTTP status codes:

- `200` - Success
- `400` - Validation error (invalid request body)
- `404` - Endpoint not found
- `405` - Method not allowed
- `500` - Internal server error

Error responses include an `error` field with details:

```json
{
  "success": false,
  "error": "Validation error: urls: Required"
}
```

