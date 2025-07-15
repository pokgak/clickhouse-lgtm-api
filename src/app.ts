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
  const { query, start, end, limit } = req.query;

  const result = await lokiService.getIndexVolume(
    query as string,
    start as string,
    end as string,
    limit ? parseInt(limit as string) : undefined
  );

  res.json(result);
});

app.get('/loki/api/v1/index/volume_range', async (req, res) => {
  const { query, start, end, step } = req.query;

  const result = await lokiService.getIndexVolumeRange(
    query as string,
    start as string,
    end as string,
    step as string
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

  // Set up Server-Sent Events headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write('data: {"streams":[]}\n\n');

  let isConnected = true;

  // Handle client disconnect
  req.on('close', () => {
    isConnected = false;
  });

  // Poll for new logs every 2 seconds
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
      res.write(`data: {"error": "${error instanceof Error ? error.message : 'Unknown error'}"}\n\n`);
    }
  }, 2000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(pollInterval);
  });
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
    message: 'ClickHouse LGTM API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      loki: '/loki/api/v1/*'
    }
  });
});

export default app;