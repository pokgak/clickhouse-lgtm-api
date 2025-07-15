import { ClickHouseAdapter } from './clickhouse';
import { LogQLTranslator } from './logql-translator';
import {
  LokiQueryResponse,
  LokiQueryRangeResponse,
  LokiLabelsResponse,
  LokiLabelValuesResponse,
  LokiSeriesResponse,
  LokiIndexStatsResponse,
  LokiIndexVolumeResponse,
  LokiIndexVolumeRangeResponse,
  LokiStream,
  LogEntry
} from './types';

export class LokiService {
  private clickhouse: ClickHouseAdapter;
  private translator: LogQLTranslator;

  constructor(clickhouse: ClickHouseAdapter, logsTable: string = 'otel_logs') {
    this.clickhouse = clickhouse;
    this.translator = new LogQLTranslator(logsTable);
  }

  async query(query: string, time?: string, limit?: number, direction?: 'forward' | 'backward'): Promise<LokiQueryResponse> {
    try {
      const logqlQuery = {
        query,
        start: time,
        limit,
        direction
      };

      const { sql, params } = this.translator.translateQuery(logqlQuery);
      console.log('Executing ClickHouse query:', sql, 'with params:', params);
      const results = await this.clickhouse.query<LogEntry>(sql, params);

      const streams = this.formatAsStreams(results);

      return {
        status: 'success',
        data: {
          resultType: 'streams',
          result: streams
        }
      };
    } catch (error) {
      console.error('ClickHouse query error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        data: { resultType: 'streams', result: [] },
        error: `ClickHouse error: ${errorMessage}`
      };
    }
  }

  async queryRange(
    query: string,
    start: string,
    end: string,
    limit?: number,
    direction?: 'forward' | 'backward'
  ): Promise<LokiQueryRangeResponse> {
    try {
      const logqlQuery = {
        query,
        start,
        end,
        limit,
        direction
      };

      const { sql, params } = this.translator.translateQuery(logqlQuery);
      const results = await this.clickhouse.query<LogEntry>(sql, params);

      const streams = this.formatAsStreams(results);

      return {
        status: 'success',
        data: {
          resultType: 'streams',
          result: streams
        }
      };
    } catch (error) {
      return {
        status: 'error',
        data: { resultType: 'streams', result: [] },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getLabels(): Promise<LokiLabelsResponse> {
    try {
      const { sql, params } = this.translator.translateLabelsQuery();
      console.log('Full labels query SQL:');
      console.log(sql);
      console.log('Query params:', params);
      const results = await this.clickhouse.query<{ label: string }>(sql, params);

      return {
        status: 'success',
        data: results.map(r => r.label)
      };
    } catch (error) {
      console.error('ClickHouse labels query error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        data: [],
        error: `ClickHouse error: ${errorMessage}`
      };
    }
  }

  async getLabelValues(labelName: string): Promise<LokiLabelValuesResponse> {
    try {
      const { sql, params } = this.translator.translateLabelValuesQuery(labelName);
      console.log('Executing label values query:', sql, 'with params:', params);
      const results = await this.clickhouse.query<{ value: string }>(sql, params);

      return {
        status: 'success',
        data: results.map(r => r.value).filter(v => v)
      };
    } catch (error) {
      console.error('ClickHouse label values query error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        data: [],
        error: `ClickHouse error: ${errorMessage}`
      };
    }
  }

  async getSeries(match?: string[], start?: string, end?: string): Promise<LokiSeriesResponse> {
    try {
      const { sql, params } = this.translator.translateSeriesQuery(match, start, end);
      const results = await this.clickhouse.query<{
        ServiceName: string;
        SeverityText: string;
        ResourceAttributes: any;
        LogAttributes: any;
      }>(sql, params);

      const series = results.map(r => {
        const labels: Record<string, string> = {
          service_name: r.ServiceName,
          severity: r.SeverityText
        };

        // Parse JSON attributes safely
        try {
          if (r.ResourceAttributes && typeof r.ResourceAttributes === 'object') {
            Object.assign(labels, r.ResourceAttributes);
          }
        } catch (e) {
          // Ignore JSON parse errors
        }

        try {
          if (r.LogAttributes && typeof r.LogAttributes === 'object') {
            Object.assign(labels, r.LogAttributes);
          }
        } catch (e) {
          // Ignore JSON parse errors
        }

        return labels;
      });

      return {
        status: 'success',
        data: series
      };
    } catch (error) {
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private formatAsStreams(results: LogEntry[]): LokiStream[] {
    const streamMap = new Map<string, LokiStream>();

    for (const entry of results) {
      const labels: Record<string, string> = {
        service_name: entry.ServiceName,
        severity: entry.SeverityText
      };

      // Add trace/span info if available
      if (entry.TraceId) {
        labels.trace_id = entry.TraceId;
      }
      if (entry.SpanId) {
        labels.span_id = entry.SpanId;
      }

      // Parse JSON attributes safely
      try {
        if (entry.ResourceAttributes && typeof entry.ResourceAttributes === 'object') {
          Object.assign(labels, entry.ResourceAttributes);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }

      try {
        if (entry.LogAttributes && typeof entry.LogAttributes === 'object') {
          Object.assign(labels, entry.LogAttributes);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }

      // Add scope info if available
      if (entry.ScopeName) {
        labels.scope_name = entry.ScopeName;
      }
      if (entry.ScopeVersion) {
        labels.scope_version = entry.ScopeVersion;
      }

      const streamKey = JSON.stringify(labels);

      if (!streamMap.has(streamKey)) {
        streamMap.set(streamKey, {
          stream: labels,
          values: []
        });
      }

      const stream = streamMap.get(streamKey)!;
      // Convert ClickHouse DateTime64 to Unix timestamp in nanoseconds
      const timestampNs = this.parseClickHouseTimestamp(entry.Timestamp);
      stream.values.push([timestampNs.toString(), entry.Body]);
    }

    return Array.from(streamMap.values());
  }

  async getIndexStats(query?: string, start?: string, end?: string): Promise<LokiIndexStatsResponse> {
    try {
      // Build a basic stats query
      let sql = `
        SELECT
          COUNT(DISTINCT ServiceName) as streams,
          COUNT(*) as entries,
          SUM(length(Body)) as bytes
        FROM ${this.translator['logsTable']}
      `;

      const conditions: string[] = [];
      const params: Record<string, any> = {};

      if (start) {
        conditions.push('Timestamp >= {start:DateTime64}');
        params.start = this.parseTimestamp(start);
      }

      if (end) {
        conditions.push('Timestamp <= {end:DateTime64}');
        params.end = this.parseTimestamp(end);
      }

      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: start ? this.parseTimestamp(start) : undefined,
          end: end ? this.parseTimestamp(end) : undefined
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        // Extract WHERE conditions from the filter query
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          conditions.push(whereMatch[1]);
          Object.assign(params, filterParams);
        }
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      console.log('Index stats SQL:', sql);
      console.log('Index stats params:', JSON.stringify(params, null, 2));
      const results = await this.clickhouse.query<{
        streams: number;
        entries: number;
        bytes: number;
      }>(sql, params);

      const stats = results[0] || { streams: 0, entries: 0, bytes: 0 };

      return {
        status: 'success',
        data: {
          streams: stats.streams,
          chunks: Math.ceil(stats.entries / 1000), // Estimate chunks
          entries: stats.entries,
          bytes: stats.bytes
        }
      };
    } catch (error) {
      console.error('ClickHouse index stats error:', error);
      return {
        status: 'error',
        data: { streams: 0, chunks: 0, entries: 0, bytes: 0 },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getIndexVolume(query?: string, start?: string, end?: string, limit?: number): Promise<LokiIndexVolumeResponse> {
    try {
      let sql = `
        SELECT
          ServiceName as name,
          COUNT(*) as volume
        FROM ${this.translator['logsTable']}
      `;

      const conditions: string[] = [];
      const params: Record<string, any> = {};

      if (start) {
        conditions.push('Timestamp >= {start:DateTime64}');
        params.start = this.parseTimestamp(start);
      }

      if (end) {
        conditions.push('Timestamp <= {end:DateTime64}');
        params.end = this.parseTimestamp(end);
      }

      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: start ? this.parseTimestamp(start) : undefined,
          end: end ? this.parseTimestamp(end) : undefined
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          conditions.push(whereMatch[1]);
          Object.assign(params, filterParams);
        }
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' GROUP BY ServiceName ORDER BY volume DESC';

      if (limit) {
        sql += ` LIMIT ${limit}`;
      }

      const results = await this.clickhouse.query<{
        name: string;
        volume: number;
      }>(sql, params);

      return {
        status: 'success',
        data: {
          volumes: results
        }
      };
    } catch (error) {
      console.error('ClickHouse index volume error:', error);
      return {
        status: 'error',
        data: { volumes: [] },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getIndexVolumeRange(query?: string, start?: string, end?: string, step?: string): Promise<LokiIndexVolumeRangeResponse> {
    try {
      // Parse step (default to 1 hour if not provided)
      const stepSeconds = step ? this.parseStep(step) : 3600;
      const startTime = start ? new Date(start) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endTime = end ? new Date(end) : new Date();

      let sql = `
        SELECT
          ServiceName,
          toUnixTimestamp(toStartOfInterval(Timestamp, INTERVAL ${stepSeconds} SECOND)) as timestamp,
          COUNT(*) as volume
        FROM ${this.translator['logsTable']}
      `;

      const conditions: string[] = [];
      const params: Record<string, any> = {};

      conditions.push('Timestamp >= {start:DateTime64}');
      conditions.push('Timestamp <= {end:DateTime64}');
      params.start = startTime.toISOString().replace('Z', '');
      params.end = endTime.toISOString().replace('Z', '');

      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: start ? this.parseTimestamp(start) : undefined,
          end: end ? this.parseTimestamp(end) : undefined
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          conditions.push(whereMatch[1]);
          Object.assign(params, filterParams);
        }
      }

      sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' GROUP BY ServiceName, timestamp ORDER BY ServiceName, timestamp';

      const results = await this.clickhouse.query<{
        ServiceName: string;
        timestamp: number;
        volume: number;
      }>(sql, params);

      // Group by service name
      const serviceMap = new Map<string, Array<[number, string]>>();

      for (const result of results) {
        if (!serviceMap.has(result.ServiceName)) {
          serviceMap.set(result.ServiceName, []);
        }
        serviceMap.get(result.ServiceName)!.push([result.timestamp, result.volume.toString()]);
      }

      const matrixResult = Array.from(serviceMap.entries()).map(([serviceName, values]) => ({
        metric: { service_name: serviceName },
        values
      }));

      return {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: matrixResult
        }
      };
    } catch (error) {
      console.error('ClickHouse index volume range error:', error);
      return {
        status: 'error',
        data: { resultType: 'matrix', result: [] },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private parseStep(step: string): number {
    const match = step.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // Default to 1 hour

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600;
    }
  }

  private parseTimestamp(timestamp: string): string {
    // Handle nanosecond timestamps from Grafana
    let date: Date;
    if (timestamp.length > 13 && /^\d+$/.test(timestamp)) {
      // Convert nanoseconds to milliseconds
      const ms = parseInt(timestamp.substring(0, 13));
      date = new Date(ms);
    } else {
      // Remove Z if present, replace T with space
      let clean = timestamp.replace('T', ' ').replace('Z', '');
      // If fractional seconds are missing, add .000000
      if (!/\.\d{6,}/.test(clean)) {
        // Add microseconds if only seconds are present
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(clean)) {
          clean += '.000000';
        } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,5}$/.test(clean)) {
          // Pad to 6 digits
          clean = clean.replace(/(\.\d{1,5})$/, (m) => m.padEnd(7, '0'));
        }
      }
      return clean;
    }
    // Format as 'YYYY-MM-DD HH:MM:SS.ssssss'
    const pad = (n: number, z = 2) => n.toString().padStart(z, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const min = pad(date.getMinutes());
    const sec = pad(date.getSeconds());
    const ms = date.getMilliseconds();
    // Convert ms to microseconds (pad to 6 digits)
    const micro = pad(ms, 3) + '000';
    return `${year}-${month}-${day} ${hour}:${min}:${sec}.${micro}`;
  }

  private parseClickHouseTimestamp(timestamp: string): number {
    // Parse ClickHouse DateTime64 format: "2025-07-15 12:04:14.350566000"
    // Convert to Unix timestamp in nanoseconds
    const date = new Date(timestamp.replace(' ', 'T') + 'Z');
    return date.getTime() * 1000000;
  }
}