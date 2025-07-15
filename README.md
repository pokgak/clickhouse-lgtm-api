# ClickHouse LGTM API

A ClickHouse adapter that provides Loki-compatible API endpoints for querying OpenTelemetry logs stored in ClickHouse.

## Quick Start with Docker Compose

### Prerequisites
- Docker and Docker Compose
- At least 4GB RAM available for containers

### Running the Stack

1. **Start all services:**
```bash
# All logs
curl "http://localhost:5000/loki/api/v1/query?query={}"

# By service
curl "http://localhost:5000/loki/api/v1/query?query={service_name=\"otelgen\"}"

# By severity
curl "http://localhost:5000/loki/api/v1/query?query={severity=\"ERROR\"}"

# With text filter
curl "http://localhost:5000/loki/api/v1/query?query={service_name=\"otelgen\"} |= \"log\""
```

2. **Check service health:**
   ```bash
   docker-compose ps
   ```

3. **Access the services:**
   - **Grafana**: http://localhost:5001 (admin/admin)
   - **LGTM Adapter**: http://localhost:5000
   - **ClickHouse**: http://localhost:8123
   - **OpenTelemetry Collector**: http://localhost:8888/metrics

### Services Overview

| Service | Port | Description |
|---------|------|-------------|
| ClickHouse | 8123, 9000 | Database storing OpenTelemetry logs |
| LGTM Adapter | 5000 | Loki-compatible API for ClickHouse |
| OpenTelemetry Collector | 4317, 4318 | Receives and processes telemetry data |
| Grafana | 5001 | Visualization with pre-configured Loki datasource |
| OTelGen | - | Generates OpenTelemetry log data |

### Testing the Setup

1. **Check adapter health:**
   ```bash
   curl http://localhost:5000/health
   ```

2. **Query logs via Loki API:**
   ```bash
   # Get all logs
   curl "http://localhost:5000/loki/api/v1/query?query={}"
   
   # Filter by service
   curl "http://localhost:5000/loki/api/v1/query?query={service_name=\"otelgen\"}"
   
   # Filter by severity
   curl "http://localhost:5000/loki/api/v1/query?query={severity=\"ERROR\"}"
   ```

3. **Use Grafana:**
   - Open http://localhost:5001
   - Login with admin/admin
   - Go to Explore
   - Select "Loki (ClickHouse)" datasource
   - Try queries like: `{service_name="otelgen"}`

### Sending Custom Logs

Send logs to the OpenTelemetry Collector:

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [{
          "key": "service.name",
          "value": {"stringValue": "my-app"}
        }]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s%N)'",
          "severityText": "INFO",
          "body": {"stringValue": "Hello from my app!"}
        }]
      }]
    }]
  }'
```

### Stopping the Stack

```bash
docker-compose down -v  # -v removes volumes
```

## API Endpoints

The adapter provides these Loki-compatible endpoints:

- `GET /loki/api/v1/query` - Instant log queries
- `GET /loki/api/v1/query_range` - Time range queries  
- `GET /loki/api/v1/labels` - Get available labels
- `GET /loki/api/v1/label/{name}/values` - Get label values
- `GET /loki/api/v1/series` - Get log series

## Configuration

Environment variables for the adapter:

```env
PORT=3000
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default
LOGS_TABLE=otel_logs
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```