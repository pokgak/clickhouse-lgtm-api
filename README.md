# ClickHouse LGTM Adapter

A ClickHouse adapter that provides Loki-compatible API endpoints for querying OpenTelemetry logs stored in ClickHouse. This project enables you to use ClickHouse as a high-performance backend for log storage while maintaining compatibility with the Loki query API.

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Loki API Compatibility** | ✅ Complete | Full compatibility with Loki query API v1 |
| **Real-time Log Streaming** | ✅ Implemented | Server-Sent Events (SSE) for live log tailing |
| **OpenTelemetry Integration** | ✅ Complete | Native support for OTLP log ingestion |
| **ClickHouse Backend** | ✅ Optimized | High-performance log storage and querying |
| **Grafana Integration** | ✅ Pre-configured | Ready-to-use Grafana dashboards and datasource |
| **Docker Compose Setup** | ✅ Complete | One-command deployment with all services |
| **Health Monitoring** | ✅ Implemented | Health checks for all services |
| **LogQL Support** | ✅ Complete | Full LogQL query language support |
| **Label-based Filtering** | ✅ Complete | Support for all label operations |
| **Time Range Queries** | ✅ Complete | Efficient time-based log queries |
| **Index Statistics** | ✅ Complete | Log volume and statistics endpoints |
| **Series Discovery** | ✅ Complete | Log series metadata endpoints |

### Supported Loki Endpoints

> **Note**: The `/loki/api/v1/detected_labels` and `/loki/api/v1/detected_fields` endpoints are Grafana-specific extensions for the Logs Drilldown feature and are not part of the official Loki API specification.

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/loki/api/v1/query` | GET | ✅ | Instant log queries with LogQL |
| `/loki/api/v1/query_range` | GET | ✅ | Time range queries with step intervals |
| `/loki/api/v1/labels` | GET | ✅ | Get all available log labels |
| `/loki/api/v1/label/{name}/values` | GET | ✅ | Get values for specific labels |
| `/loki/api/v1/series` | GET | ✅ | Get log series metadata |
| `/loki/api/v1/index/stats` | GET | ✅ | Get index statistics |
| `/loki/api/v1/index/volume` | GET | ✅ | Get log volume by label |
| `/loki/api/v1/index/volume_range` | GET | ✅ | Get log volume over time |
| `/loki/api/v1/detected_labels` | GET | ✅ | Get detected labels for Grafana drilldown (Grafana-specific) |
| `/loki/api/v1/detected_fields` | GET | ✅ | Get detected fields for Grafana drilldown (Grafana-specific) |
| `/loki/api/v1/tail` | GET | ✅ | Real-time log streaming (SSE) |
| `/loki/api/v1/patterns` | GET | ❌ | Log pattern analysis (not implemented) |

### LogQL Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Label Matchers** | ✅ | `{service_name="app"}`, `{severity!="ERROR"}` |
| **Text Filters** | ✅ | `|= "text"`, `!= "text"`, `|~ "regex"` |
| **Time Range** | ✅ | `{...} [5m]`, `{...} [1h]` |
| **Aggregations** | ✅ | `rate()`, `count_over_time()`, `sum_over_time()` |
| **Functions** | ✅ | `json()`, `logfmt()`, `regexp()` |
| **Binary Operators** | ✅ | `and`, `or`, `unless` |

## Quick Start with Docker Compose

### Prerequisites
- Docker and Docker Compose
- At least 4GB RAM available for containers

### Running the Stack

1. **Start all services:**
```bash
docker-compose up -d
```

2. **Check service health:**
   ```bash
   docker-compose ps
   ```

3. **Access the services:**
   - **Grafana**: http://localhost:3001 (admin/admin)
   - **LGTM Adapter**: http://localhost:3100
   - **ClickHouse**: http://localhost:8123
   - **OpenTelemetry Collector**: http://localhost:4317 (gRPC), http://localhost:4318 (HTTP)

### Services Overview

| Service | Port | Description |
|---------|------|-------------|
| ClickHouse | 8123, 9000 | Database storing OpenTelemetry logs |
| LGTM Adapter | 3100 | Loki-compatible API for ClickHouse |
| OpenTelemetry Collector | 4317, 4318 | Receives and processes telemetry data |
| Grafana | 3001 | Visualization with pre-configured Loki datasource |
| OTelGen | - | Generates OpenTelemetry log data |

### Testing the Setup

1. **Check adapter health:**
   ```bash
   curl http://localhost:3100/health
   ```

2. **Query logs via Loki API:**
   ```bash
   # Get all logs
   curl "http://localhost:3100/loki/api/v1/query?query={}"

   # Filter by service
   curl "http://localhost:3100/loki/api/v1/query?query={service_name=\"otelgen\"}"

   # Filter by severity
   curl "http://localhost:3100/loki/api/v1/query?query={severity=\"ERROR\"}"

   # Real-time streaming
   curl "http://localhost:3100/loki/api/v1/tail?query={service_name=\"otelgen\"}"
   ```

3. **Use Grafana:**
   - Open http://localhost:3001
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

## API Endpoints Reference

### Core Query Endpoints

#### `GET /loki/api/v1/query`
Instant log queries with LogQL support.

**Parameters:**
- `query` (required): LogQL query string
- `time` (optional): Unix timestamp for query time
- `limit` (optional): Maximum number of entries to return
- `direction` (optional): `forward` or `backward`

**Example:**
```bash
curl "http://localhost:3100/loki/api/v1/query?query={service_name=\"otelgen\"}&limit=10"
```

#### `GET /loki/api/v1/query_range`
Time range queries with step intervals.

**Parameters:**
- `query` (required): LogQL query string
- `start` (required): Start timestamp (Unix or RFC3339)
- `end` (required): End timestamp (Unix or RFC3339)
- `step` (optional): Query resolution step width
- `limit` (optional): Maximum number of entries to return
- `direction` (optional): `forward` or `backward`

**Example:**
```bash
curl "http://localhost:3100/loki/api/v1/query_range?query={service_name=\"otelgen\"}&start=1640995200&end=1640998800&step=60"
```

### Label and Series Endpoints

#### `GET /loki/api/v1/labels`
Get all available log labels.

**Parameters:**
- `start` (optional): Start timestamp
- `end` (optional): End timestamp

#### `GET /loki/api/v1/label/{name}/values`
Get values for a specific label.

**Parameters:**
- `start` (optional): Start timestamp
- `end` (optional): End timestamp

#### `GET /loki/api/v1/series`
Get log series metadata.

**Parameters:**
- `match[]` (optional): Series matcher(s)
- `start` (optional): Start timestamp
- `end` (optional): End timestamp

### Index and Statistics Endpoints

#### `GET /loki/api/v1/index/stats`
Get index statistics.

**Parameters:**
- `query` (optional): Query filter
- `start` (optional): Start timestamp
- `end` (optional): End timestamp

#### `GET /loki/api/v1/index/volume`
Get log volume by label.

**Parameters:**
- `query` (optional): Query filter
- `start` (optional): Start timestamp
- `end` (optional): End timestamp
- `limit` (optional): Maximum number of results

#### `GET /loki/api/v1/index/volume_range`
Get log volume over time.

**Parameters:**
- `query` (optional): Query filter
- `start` (required): Start timestamp
- `end` (required): End timestamp
- `step` (required): Time step interval

### Real-time Streaming

#### `GET /loki/api/v1/tail`
Real-time log streaming using Server-Sent Events (SSE).

**Parameters:**
- `query` (required): LogQL query string
- `start` (optional): Start timestamp
- `limit` (optional): Maximum number of entries per poll

**Example:**
```bash
curl "http://localhost:3100/loki/api/v1/tail?query={service_name=\"otelgen\"}"
```

## Tempo and Mimir/Prometheus Support

### Current Status

This project currently focuses on **Loki-compatible log querying** using ClickHouse as the backend. Here's the status of other observability components:

| Component | Status | Notes |
|-----------|--------|-------|
| **Loki (Logs)** | ✅ Complete | Full API compatibility implemented |
| **Tempo (Traces)** | ❌ Not Implemented | Would require ClickHouse trace schema and API |
| **Mimir/Prometheus (Metrics)** | ❌ Not Implemented | Would require ClickHouse metrics schema and API |

### Future Roadmap

#### Tempo Support
- **ClickHouse Schema**: Implement trace-specific tables (spans, services, operations)
- **API Compatibility**: Implement Tempo-compatible query API
- **Trace Queries**: Support for trace ID lookups, service graphs, and span queries
- **Integration**: Grafana datasource for trace visualization

#### Mimir/Prometheus Support
- **ClickHouse Schema**: Implement metrics-specific tables (samples, labels, metadata)
- **API Compatibility**: Implement Prometheus-compatible query API
- **Metrics Queries**: Support for PromQL queries and aggregations
- **Integration**: Grafana datasource for metrics visualization

### Architecture Considerations

The current architecture can be extended to support Tempo and Mimir:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │   Application   │    │   Application   │
│     Logs        │    │    Traces       │    │    Metrics      │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ OpenTelemetry   │    │ OpenTelemetry   │    │ OpenTelemetry   │
│   Collector     │    │   Collector     │    │   Collector     │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ClickHouse                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Logs      │  │   Traces    │  │   Metrics   │            │
│  │   Table     │  │   Tables    │  │   Tables    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   LGTM API      │    │   Tempo API     │    │   Mimir API     │
│ (Loki Compat)   │    │ (Tempo Compat)  │    │ (Prom Compat)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Configuration

Environment variables for the adapter:

```env
PORT=3100
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

## Contributing

Contributions are welcome! Areas for improvement:

1. **Tempo Support**: Implement trace storage and querying
2. **Mimir Support**: Implement metrics storage and querying
3. **Performance**: Optimize ClickHouse queries and indexing
4. **Features**: Add missing Loki endpoints (patterns, etc.)
5. **Testing**: Expand test coverage
6. **Documentation**: Improve API documentation and examples

## License

This project is open source and available under the MIT License.