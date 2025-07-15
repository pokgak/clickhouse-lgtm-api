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