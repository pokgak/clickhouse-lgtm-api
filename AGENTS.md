# AGENTS.md

## Project Overview
TypeScript API project for ClickHouse LGTM (Logs, Grafana, Traces, Metrics) integration with Loki endpoints.

## Build/Test Commands
- No package.json found - this appears to be a minimal TypeScript project
- Use `tsc` to compile TypeScript files
- Use `node dist/index.js` to run the compiled application
- No test framework configured yet

## Code Style Guidelines
- Language: TypeScript
- File structure: `src/` directory with `app.ts` and `index.ts` entry points
- Currently minimal codebase with empty source files
- Follow standard TypeScript conventions when implementing

## API Documentation
Loki API endpoints to implement:
- GET /loki/api/v1/query
- GET /loki/api/v1/query_range  
- GET /loki/api/v1/labels
- GET /loki/api/v1/label/<name>/values
- GET /loki/api/v1/series
- GET /loki/api/v1/index/stats
- GET /loki/api/v1/index/volume
- GET /loki/api/v1/index/volume_range
- GET /loki/api/v1/patterns
- GET /loki/api/v1/tail

## References
- Loki: https://grafana.com/docs/loki/latest/reference/loki-http-api/#query-endpoints
- ClickHouse HTTP interface: https://clickhouse.com/docs/interfaces/http#querying