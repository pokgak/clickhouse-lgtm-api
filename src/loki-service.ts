import { ClickHouseAdapter } from './clickhouse';
import { LogQLTranslator } from './logql-translator';
import {
  LokiQueryResponse,
  LokiQueryRangeResponse,
  LokiLabelsResponse,
  LokiLabelValuesResponse,
  LokiSeriesResponse,
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
      const results = await this.clickhouse.query<{ label: string }>(sql, params);
      
      return {
        status: 'success',
        data: results.map(r => r.label)
      };
    } catch (error) {
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getLabelValues(labelName: string): Promise<LokiLabelValuesResponse> {
    try {
      const { sql, params } = this.translator.translateLabelValuesQuery(labelName);
      const results = await this.clickhouse.query<{ value: string }>(sql, params);
      
      return {
        status: 'success',
        data: results.map(r => r.value).filter(v => v)
      };
    } catch (error) {
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
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
      const timestampNs = new Date(entry.Timestamp).getTime() * 1000000;
      stream.values.push([timestampNs.toString(), entry.Body]);
    }

    return Array.from(streamMap.values());
  }
}