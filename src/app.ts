import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createClickHouseAdapter } from './clickhouse';
import { LokiService } from './loki-service';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

const clickhouseConfig = {
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: parseInt(process.env.CLICKHOUSE_PORT || '8123'),
  username: process.env.CLICKHOUSE_USERNAME || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
};

const clickhouse = createClickHouseAdapter(clickhouseConfig);
const lokiService = new LokiService(clickhouse, process.env.LOGS_TABLE || 'otel_logs');

app.get('/loki/api/v1/query', async (req, res) => {
  const { query, time, limit, direction } = req.query;

  if (!query) {
    return res.status(400).json({
      status: 'error',
      error: 'query parameter is required'
    });
  }

  // Handle Grafana health check queries (Prometheus-style)
  if (query === 'vector(1)+vector(1)' || (query as string).startsWith('vector(')) {
    return res.json({
      status: 'success',
      data: {
        resultType: 'vector',
        result: [{
          metric: {},
          value: [Math.floor(Date.now() / 1000), '2']
        }]
      }
    });
  }

  const result = await lokiService.query(
    query as string,
    time as string,
    limit ? parseInt(limit as string) : undefined,
    direction as 'forward' | 'backward'
  );

  res.json(result);
});

app.get('/loki/api/v1/query_range', async (req, res) => {
  const { query, start, end, limit, direction } = req.query;

  if (!query || !start || !end) {
    return res.status(400).json({
      status: 'error',
      error: 'query, start, and end parameters are required'
    });
  }

  const result = await lokiService.queryRange(
    query as string,
    start as string,
    end as string,
    limit ? parseInt(limit as string) : undefined,
    direction as 'forward' | 'backward'
  );

  res.json(result);
});

app.get('/loki/api/v1/labels', async (req, res) => {
  const result = await lokiService.getLabels();
  res.json(result);
});

app.get('/loki/api/v1/label/:name/values', async (req, res) => {
  const { name } = req.params;
  const result = await lokiService.getLabelValues(name);
  res.json(result);
});

app.get('/loki/api/v1/series', async (req, res) => {
  const { match, start, end } = req.query;

  const matchArray = match ? (Array.isArray(match) ? match as string[] : [match as string]) : undefined;

  const result = await lokiService.getSeries(
    matchArray,
    start as string,
    end as string
  );

  res.json(result);
});

app.get('/loki/api/v1/detected_labels', async (req, res) => {
  const { query, start, end } = req.query;

  // Validate required parameters
  if (!start) {
    return res.status(400).json({
      status: 'error',
      error: 'start parameter is required'
    });
  }

  if (!end) {
    return res.status(400).json({
      status: 'error',
      error: 'end parameter is required'
    });
  }

  const result = await lokiService.getDetectedLabels(
    query as string,
    start as string,
    end as string
  );

  res.json(result);
});

app.get('/loki/api/v1/detected_fields', async (req, res) => {
  const { query, start, end } = req.query;

  // Validate required parameters
  if (!start) {
    return res.status(400).json({
      status: 'error',
      error: 'start parameter is required'
    });
  }

  if (!end) {
    return res.status(400).json({
      status: 'error',
      error: 'end parameter is required'
    });
  }

  const result = await lokiService.getDetectedFields(
    query as string,
    start as string,
    end as string
  );

  res.json(result);
});

app.get('/loki/api/v1/index/stats', async (req, res) => {
  const { query, start, end } = req.query;

  const result = await lokiService.getIndexStats(
    query as string,
    start as string,
    end as string
  );

  res.json(result);
});

app.get('/loki/api/v1/index/volume', async (req, res) => {
  const { query, start, end, limit, targetLabels, aggregateBy } = req.query;

  // Validate required parameters
  if (!query) {
    return res.status(400).json({
      status: 'error',
      error: 'query parameter is required'
    });
  }

  if (!start) {
    return res.status(400).json({
      status: 'error',
      error: 'start parameter is required'
    });
  }

  if (!end) {
    return res.status(400).json({
      status: 'error',
      error: 'end parameter is required'
    });
  }

  const result = await lokiService.getIndexVolume(
    query as string,
    start as string,
    end as string,
    limit ? parseInt(limit as string) : 100,
    targetLabels as string,
    aggregateBy as string
  );

  res.json(result);
});

app.get('/loki/api/v1/index/volume_range', async (req, res) => {
  const { query, start, end, step, targetLabels, aggregateBy } = req.query;

  // Validate required parameters
  if (!query) {
    return res.status(400).json({
      status: 'error',
      error: 'query parameter is required'
    });
  }

  if (!start) {
    return res.status(400).json({
      status: 'error',
      error: 'start parameter is required'
    });
  }

  if (!end) {
    return res.status(400).json({
      status: 'error',
      error: 'end parameter is required'
    });
  }

  const result = await lokiService.getIndexVolumeRange(
    query as string,
    start as string,
    end as string,
    step as string,
    targetLabels as string,
    aggregateBy as string
  );

  res.json(result);
});

app.get('/loki/api/v1/tail', async (req, res) => {
  const { query, start, limit } = req.query;

  if (!query) {
    return res.status(400).json({
      status: 'error',
      error: 'query parameter is required'
    });
  }

  // Set up Server-Sent Events headers with additional CORS headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
  });

  // Send initial connection message
  res.write('data: {"streams":[]}\n\n');

  let isConnected = true;

  // Handle client disconnect
  req.on('close', () => {
    isConnected = false;
  });

  // Send initial data immediately
  try {
    const initialResult = await lokiService.query(
      query as string,
      start as string,
      limit ? parseInt(limit as string) : 10,
      'forward'
    );

    if (initialResult.status === 'success' && initialResult.data.result.length > 0) {
      res.write(`data: ${JSON.stringify(initialResult.data)}\n\n`);
    }
  } catch (error) {
    console.error('Initial tail query error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.write(`data: {"error": "${errorMessage}"}\n\n`);
  }

  // Poll for new logs every 1 second (faster polling for better real-time feel)
  const pollInterval = setInterval(async () => {
    if (!isConnected) {
      clearInterval(pollInterval);
      return;
    }

    try {
      const result = await lokiService.query(
        query as string,
        start as string,
        limit ? parseInt(limit as string) : 10,
        'forward'
      );

      if (result.status === 'success' && result.data.result.length > 0) {
        // Send the new logs as SSE
        res.write(`data: ${JSON.stringify(result.data)}\n\n`);
      }
    } catch (error) {
      console.error('Tail endpoint error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.write(`data: {"error": "${errorMessage}"}\n\n`);

      // Close connection on error to prevent infinite error loops
      if (isConnected) {
        isConnected = false;
        clearInterval(pollInterval);
        res.end();
      }
    }
  }, 1000);

  // Clean up on client disconnect
  req.on('close', () => {
    isConnected = false;
    clearInterval(pollInterval);
  });
});

app.get('/loki/api/v1/patterns', async (req, res) => {
  const { query, start, end, step } = req.query;

  // Validate required parameters
  if (!query) {
    return res.status(400).json({
      status: 'error',
      error: 'query parameter is required'
    });
  }

  if (!start) {
    return res.status(400).json({
      status: 'error',
      error: 'start parameter is required'
    });
  }

  if (!end) {
    return res.status(400).json({
      status: 'error',
      error: 'end parameter is required'
    });
  }

  const result = await lokiService.getPatterns(
    query as string,
    start as string,
    end as string,
    step as string
  );

  res.json(result);
});

// Loki health check endpoints
app.get('/ready', async (req, res) => {
  const isHealthy = await clickhouse.ping();
  if (isHealthy) {
    res.status(200).send('ready');
  } else {
    res.status(503).send('not ready');
  }
});

app.get('/loki/api/v1/status/buildinfo', (req, res) => {
  res.json({
    version: "2.9.0",
    revision: "clickhouse-adapter",
    branch: "main",
    buildDate: new Date().toISOString(),
    buildUser: "clickhouse-lgtm-api",
    goVersion: "go1.21.0"
  });
});



app.get('/health', async (req, res) => {
  const isHealthy = await clickhouse.ping();
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    clickhouse: isHealthy
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'ClickHouse LGTM Adapter',
    version: '1.0.0',
    endpoints: {
      'Loki API': '/loki/api/v1/*',
      'Health': '/health',
      'Ready': '/ready',
      'OpenAPI Spec': '/openapi.yaml',
      'API Documentation': '/docs'
    },
    features: {
      'Implemented': 9,
      'Total': 10,
      'Missing': ['/loki/api/v1/patterns']
    }
  });
});

// Serve OpenAPI specification
app.get('/openapi.yaml', (req, res) => {
  res.setHeader('Content-Type', 'text/yaml');
  res.sendFile('openapi.yaml', { root: '.' });
});

// Serve API documentation (redirect to Swagger UI)
app.get('/docs', (req, res) => {
  res.redirect('https://editor.swagger.io/?url=' + encodeURIComponent(req.protocol + '://' + req.get('host') + '/openapi.yaml'));
});

// Catch-all for unhandled routes: return JSON 404
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    error: 'Not found',
    errorType: 'NotFound',
    path: req.originalUrl
  });
});

export default app;