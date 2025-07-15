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
  LokiPatternsResponse,
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
  ): Promise<LokiQueryRangeResponse | LokiIndexVolumeRangeResponse> {
    try {
      // Detect aggregation queries (count_over_time, sum by, etc.)
      const isAggregation = /count_over_time|sum by|rate|avg_over_time|sum_over_time|histogram_quantile/.test(query);

      console.log('queryRange called with:', { query, start, end, limit, direction, isAggregation });

      if (isAggregation) {
        // Use getIndexVolumeRange for log volume queries
        // Extract step from query if present (Grafana usually provides it as a query param, but fallback to 1m)
        let step = '60s';
        const stepMatch = query.match(/\[(\d+)([smhd])\]/);
        if (stepMatch) {
          const value = parseInt(stepMatch[1]);
          const unit = stepMatch[2];
          step = `${value}${unit}`;
        }

        // Extract target labels from sum by (label1, label2) syntax
        let targetLabels: string | undefined;
        const sumByMatch = query.match(/sum\s+by\s*\(([^)]+)\)/i);
        if (sumByMatch) {
          targetLabels = sumByMatch[1].split(',').map(label => label.trim()).join(',');
        }

        console.log('Detected aggregation query, using getIndexVolumeRange with step:', step, 'targetLabels:', targetLabels, 'sumByMatch:', sumByMatch);
        return await this.getIndexVolumeRange(query, start, end, step, targetLabels);
      }

      const logqlQuery = {
        query,
        start,
        end,
        limit,
        direction
      };

      const { sql, params } = this.translator.translateQuery(logqlQuery);
      console.log('Generated SQL:', sql);
      console.log('SQL params:', params);

      const results = await this.clickhouse.query<LogEntry>(sql, params);
      console.log('Query results count:', results.length);

      const streams = this.formatAsStreams(results);
      console.log('Formatted streams count:', streams.length);

      return {
        status: 'success',
        data: {
          resultType: 'streams',
          result: streams
        }
      };
    } catch (error) {
      console.error('queryRange error:', error);
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

      let values = results.map(r => r.value).filter(v => v);

      // Apply level mapping for severity/level labels to return Grafana-compatible values
      if (labelName === 'severity' || labelName === 'level') {
        // Get unique mapped values
        const mappedValues = new Set<string>();
        values.forEach(value => {
          mappedValues.add(this.mapSeverityToLevel(value));
        });
        values = Array.from(mappedValues).sort();
      }

      return {
        status: 'success',
        data: values
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

        // Add 'level' label for Grafana coloring (mapped to expected values)
        if (r.SeverityText) {
          labels.level = this.mapSeverityToLevel(r.SeverityText);
        }

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

  private mapSeverityToLevel(severityText: string): string {
    const severity = severityText.toLowerCase();

    // Map to Grafana's expected level values for coloring
    if (severity.includes('fatal') || severity.includes('critical') || severity.includes('emerg') || severity.includes('alert') || severity.includes('crit')) {
      return 'critical';
    }
    if (severity.includes('error') || severity.includes('err')) {
      return 'error';
    }
    if (severity.includes('warn')) {
      return 'warning';
    }
    if (severity.includes('info') || severity.includes('information') || severity.includes('informational') || severity.includes('notice')) {
      return 'info';
    }
    if (severity.includes('debug') || severity.includes('dbug')) {
      return 'debug';
    }
    if (severity.includes('trace')) {
      return 'trace';
    }

    // Default to unknown for unrecognized levels
    return 'unknown';
  }

  private formatAsStreams(results: LogEntry[]): LokiStream[] {
    const streamMap = new Map<string, LokiStream>();

    for (const entry of results) {
      const labels: Record<string, string> = {
        service_name: entry.ServiceName,
        severity: entry.SeverityText
      };

      // Add 'level' label for Grafana coloring (mapped to expected values)
      if (entry.SeverityText) {
        labels.level = this.mapSeverityToLevel(entry.SeverityText);
      }

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
          // Filter out service.name since it's already exposed as service_name
          const filteredResourceAttrs = { ...entry.ResourceAttributes };
          delete filteredResourceAttrs['service.name'];
          Object.assign(labels, filteredResourceAttrs);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }

      try {
        if (entry.LogAttributes && typeof entry.LogAttributes === 'object') {
          // Filter out service.name since it's already exposed as service_name
          const filteredLogAttrs = { ...entry.LogAttributes };
          delete filteredLogAttrs['service.name'];
          Object.assign(labels, filteredLogAttrs);
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

    async getPatterns(query: string, start: string, end: string, step?: string): Promise<LokiPatternsResponse> {
    try {
      // Parse timestamps
      const startTimestamp = this.parseTimestamp(start);
      const endTimestamp = this.parseTimestamp(end);
      const stepSeconds = step ? this.parseStep(step) : 60; // Default to 1 minute

      // Build SQL to analyze log patterns - get all log lines first
      let sql = `
        SELECT
          Timestamp,
          Body as log_line
        FROM ${this.translator['logsTable']}
        WHERE Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
      `;

      const params: Record<string, any> = {
        start: startTimestamp,
        end: endTimestamp
      };

      // Add query filters
      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: startTimestamp,
          end: endTimestamp
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          sql += ' AND ' + whereMatch[1];
          Object.assign(params, filterParams);
        }
      }

      sql += ` ORDER BY Timestamp DESC LIMIT 10000`;

      const results = await this.clickhouse.query<{
        Timestamp: string;
        log_line: string;
      }>(sql, params);

      // Group patterns across all timestamps
      const patternMap = new Map<string, Map<number, number>>();

      for (const result of results) {
        // Convert timestamp to Unix timestamp (seconds) and bucket it
        const timestampNs = this.parseClickHouseTimestamp(result.Timestamp);
        const timestampSeconds = Math.floor(timestampNs / 1000000000); // Convert nanoseconds to seconds
        const bucketedTimestamp = Math.floor(timestampSeconds / stepSeconds) * stepSeconds;

        // Extract pattern using Loki's format
        const pattern = this.extractLokiPattern(result.log_line);

        if (!patternMap.has(pattern)) {
          patternMap.set(pattern, new Map());
        }

        const patternSamples = patternMap.get(pattern)!;
        patternSamples.set(bucketedTimestamp, (patternSamples.get(bucketedTimestamp) || 0) + 1);
      }

      // Convert to response format
      const patterns = Array.from(patternMap.entries()).map(([pattern, samples]) => ({
        pattern,
        samples: Array.from(samples.entries())
          .sort(([a], [b]) => a - b) // Sort by timestamp
          .map(([timestamp, count]) => [timestamp, count] as [number, number])
      }));

      // Sort patterns by total frequency (descending)
      patterns.sort((a, b) => {
        const aTotal = a.samples.reduce((sum, [, count]) => sum + count, 0);
        const bTotal = b.samples.reduce((sum, [, count]) => sum + count, 0);
        return bTotal - aTotal;
      });

      return {
        status: 'success',
        data: patterns
      };
    } catch (error) {
      console.error('ClickHouse patterns error:', error);
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private extractLokiPattern(logLine: string): string {
    // Extract pattern using Loki's format with <_> placeholders
    let pattern = logLine
      // Replace timestamps (ISO format)
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<_>')
      // Replace Unix timestamps
      .replace(/\b\d{10,13}\b/g, '<_>')
      // Replace UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<_>')
      // Replace numbers (but keep small numbers like status codes)
      .replace(/\b\d{4,}\b/g, '<_>')
      // Replace IP addresses
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<_>')
      // Replace email addresses
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<_>')
      // Replace URLs
      .replace(/https?:\/\/[^\s]+/g, '<_>')
      // Replace file paths
      .replace(/\/[^\s]*\.[a-zA-Z]{2,4}/g, '<_>')
      // Replace request IDs
      .replace(/\b[0-9a-f]{16,}\b/gi, '<_>')
      // Replace durations (e.g., "200ms", "500ms")
      .replace(/\b\d+[a-z]+\b/g, '<_>')
      // Replace common variable parts in log messages
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b/g, '<_>') // IP:port
      .replace(/\b[A-Za-z0-9._-]+@[A-Za-z0-9._-]+\b/g, '<_>') // Simple email-like patterns
      .replace(/\b[A-Za-z0-9._-]+\.[A-Za-z]{2,}\b/g, '<_>'); // Domain names

    return pattern;
  }

  async getDetectedFields(query?: string, start?: string, end?: string): Promise<LokiLabelsResponse> {
    try {
      // Parse timestamps
      const startTimestamp = start ? this.parseTimestamp(start) : this.parseTimestamp((Date.now() - 24 * 60 * 60 * 1000).toString());
      const endTimestamp = end ? this.parseTimestamp(end) : this.parseTimestamp(Date.now().toString());

      // For detected_fields, we'll return common fields that can be extracted from log bodies
      // This is a simplified implementation - in a real scenario, you might want to analyze log content
      const commonFields = [
        'timestamp',
        'level',
        'message',
        'method',
        'path',
        'status_code',
        'duration',
        'user_id',
        'request_id',
        'ip',
        'user_agent',
        'error',
        'stack_trace'
      ];

      return {
        status: 'success',
        data: commonFields
      };
    } catch (error) {
      console.error('ClickHouse detected fields error:', error);
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDetectedLabels(query?: string, start?: string, end?: string): Promise<LokiLabelsResponse> {
    try {
      // Parse timestamps
      const startTimestamp = start ? this.parseTimestamp(start) : this.parseTimestamp((Date.now() - 24 * 60 * 60 * 1000).toString());
      const endTimestamp = end ? this.parseTimestamp(end) : this.parseTimestamp(Date.now().toString());

      let sql = `
        SELECT DISTINCT label_name
        FROM (
          SELECT 'service_name' as label_name FROM ${this.translator['logsTable']} WHERE ServiceName != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
          UNION ALL
          SELECT 'severity' as label_name FROM ${this.translator['logsTable']} WHERE SeverityText != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
          UNION ALL
          SELECT 'trace_id' as label_name FROM ${this.translator['logsTable']} WHERE TraceId != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
          UNION ALL
          SELECT 'span_id' as label_name FROM ${this.translator['logsTable']} WHERE SpanId != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
          UNION ALL
          SELECT 'scope_name' as label_name FROM ${this.translator['logsTable']} WHERE ScopeName != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
          UNION ALL
          SELECT 'scope_version' as label_name FROM ${this.translator['logsTable']} WHERE ScopeVersion != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
          UNION ALL
          SELECT 'level' as label_name FROM ${this.translator['logsTable']} WHERE SeverityText != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
        )
        ORDER BY label_name
      `;

      const params: Record<string, any> = {
        start: startTimestamp,
        end: endTimestamp
      };

      // Add query filters if provided
      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: startTimestamp,
          end: endTimestamp
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          // Replace the WHERE clause in each UNION subquery
          sql = sql.replace(/WHERE (.+?) AND Timestamp/g, `WHERE ${whereMatch[1]} AND Timestamp`);
          Object.assign(params, filterParams);
        }
      }

      const results = await this.clickhouse.query<{ label_name: string }>(sql, params);

      return {
        status: 'success',
        data: results.map(r => r.label_name)
      };
    } catch (error) {
      console.error('ClickHouse detected labels error:', error);
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
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

  async getIndexVolume(query: string, start: string, end: string, limit: number = 100, targetLabels?: string, aggregateBy: string = 'series'): Promise<LokiIndexVolumeResponse> {
    try {
      // Parse timestamps
      const startTimestamp = this.parseTimestamp(start);
      const endTimestamp = this.parseTimestamp(end);

      // Only use targetLabels for grouping if set
      let groupByLabels: string[] = [];
      if (targetLabels) {
        groupByLabels = targetLabels.split(',').map(label => label.trim());
      } else if (aggregateBy === 'labels') {
        // For labels aggregation, we need to extract label names from the query
        const labelMatches = query.match(/(\w+)=/g);
        if (labelMatches) {
          groupByLabels = labelMatches.map(match => match.replace('=', ''));
        }
      } else {
        // Extract labels from the query
        const labelMatches = query.match(/(\w+)=/g);
        if (labelMatches) {
          groupByLabels = labelMatches.map(match => match.replace('=', ''));
        }
      }

      // Build dynamic SQL based on available labels
      let selectClause = 'COUNT(*) as volume';
      let groupByClause = '';

      if (groupByLabels.length > 0) {
        const labelSelects = groupByLabels.map(label => {
          // Map common label names to our schema
          switch (label.toLowerCase()) {
            case 'service_name':
            case 'service':
              return 'ServiceName as service_name';
            case 'severity':
            case 'level':
              return `SeverityText as ${label}`;
            default:
              // For other labels, try to extract from LogAttributes
              return `LogAttributes['${label}'] as ${label}`;
          }
        });
        selectClause = labelSelects.join(', ') + ', ' + selectClause;
        groupByClause = 'GROUP BY ' + groupByLabels.map(label => {
          switch (label.toLowerCase()) {
            case 'service_name':
            case 'service':
              return 'ServiceName';
            case 'severity':
            case 'level':
              return 'SeverityText';
            default:
              return `LogAttributes['${label}']`;
          }
        }).join(', ');
      }

      let sql = `
        SELECT ${selectClause}
        FROM ${this.translator['logsTable']}
        WHERE Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
      `;

      const params: Record<string, any> = {
        start: startTimestamp,
        end: endTimestamp
      };

      // Add query filters
      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: startTimestamp,
          end: endTimestamp
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          sql += ' AND ' + whereMatch[1];
          Object.assign(params, filterParams);
        }
      }

      if (groupByClause) {
        sql += ` ${groupByClause}`;
      }

      sql += ` ORDER BY volume DESC LIMIT ${limit}`;

      const results = await this.clickhouse.query<any>(sql, params);

      // Convert to Prometheus vector format
      const vectorResult = results.map(row => {
        const metric: Record<string, string> = {};

        // Add all non-volume fields as metric labels
        Object.keys(row).forEach(key => {
          if (key !== 'volume' && row[key] !== null && row[key] !== undefined) {
            // Apply level mapping for severity/level labels
            if (key === 'severity' || key === 'level') {
              metric[key] = this.mapSeverityToLevel(row[key].toString());
            } else {
              metric[key] = row[key].toString();
            }
          }
        });

        return {
          metric,
          value: [Math.floor(Date.now() / 1000), row.volume.toString()] as [number, string]
        };
      });

      return {
        status: 'success',
        data: {
          resultType: 'vector',
          result: vectorResult
        }
      };
    } catch (error) {
      console.error('ClickHouse index volume error:', error);
      return {
        status: 'error',
        data: { resultType: 'vector', result: [] },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getIndexVolumeRange(query: string, start: string, end: string, step?: string, targetLabels?: string, aggregateBy: string = 'series'): Promise<LokiIndexVolumeRangeResponse> {
    try {
      // Parse step (default to 1 hour if not provided)
      const stepSeconds = step ? this.parseStep(step) : 3600;

      // Parse timestamps
      const startTimestamp = this.parseTimestamp(start);
      const endTimestamp = this.parseTimestamp(end);

      // Only use targetLabels for grouping if set
      let groupByLabels: string[] = [];
      if (targetLabels) {
        groupByLabels = targetLabels.split(',').map(label => label.trim());
      } else if (aggregateBy === 'labels') {
        // For labels aggregation, we need to extract label names from the query
        const labelMatches = query.match(/(\w+)=/g);
        if (labelMatches) {
          groupByLabels = labelMatches.map(match => match.replace('=', ''));
        }
      } else {
        // Extract labels from the query
        const labelMatches = query.match(/(\w+)=/g);
        if (labelMatches) {
          groupByLabels = labelMatches.map(match => match.replace('=', ''));
        }
      }

      // Build dynamic SQL based on available labels
      let selectClause = `toUnixTimestamp(toStartOfInterval(Timestamp, INTERVAL ${stepSeconds} SECOND)) as timestamp, COUNT(*) as volume`;
      let groupByClause = 'timestamp';

      if (groupByLabels.length > 0) {
        const labelSelects = groupByLabels.map(label => {
          // Map common label names to our schema
          switch (label.toLowerCase()) {
            case 'service_name':
            case 'service':
              return 'ServiceName as service_name';
            case 'severity':
            case 'level':
              return `SeverityText as ${label}`;
            default:
              // For other labels, try to extract from LogAttributes
              return `LogAttributes['${label}'] as ${label}`;
          }
        });
        selectClause = `toUnixTimestamp(toStartOfInterval(Timestamp, INTERVAL ${stepSeconds} SECOND)) as timestamp, ` + labelSelects.join(', ') + ', COUNT(*) as volume';
        groupByClause = 'timestamp, ' + groupByLabels.map(label => {
          switch (label.toLowerCase()) {
            case 'service_name':
            case 'service':
              return 'ServiceName';
            case 'severity':
            case 'level':
              return 'SeverityText';
            default:
              return `LogAttributes['${label}']`;
          }
        }).join(', ');
      }

      let sql = `
        SELECT ${selectClause}
        FROM ${this.translator['logsTable']}
        WHERE Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
      `;

      const params: Record<string, any> = {
        start: startTimestamp,
        end: endTimestamp
      };

      // Add query filters
      if (query && query !== '{}') {
        const logqlQuery = {
          query,
          start: startTimestamp,
          end: endTimestamp
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          sql += ' AND ' + whereMatch[1];
          Object.assign(params, filterParams);
        }
      }

      sql += ` GROUP BY ${groupByClause} ORDER BY timestamp`;

      const results = await this.clickhouse.query<any>(sql, params);

      // Group by metric labels for matrix format
      const metricMap = new Map<string, Array<[number, string]>>();

      for (const result of results) {
        const metric: Record<string, string> = {};

        // Add all non-timestamp and non-volume fields as metric labels
        Object.keys(result).forEach(key => {
          if (key !== 'timestamp' && key !== 'volume' && result[key] !== null && result[key] !== undefined) {
            // Apply level mapping for severity/level labels
            if (key === 'severity' || key === 'level') {
              metric[key] = this.mapSeverityToLevel(result[key].toString());
            } else {
              metric[key] = result[key].toString();
            }
          }
        });

        const metricKey = JSON.stringify(metric);
        if (!metricMap.has(metricKey)) {
          metricMap.set(metricKey, []);
        }

        metricMap.get(metricKey)!.push([result.timestamp, result.volume.toString()]);
      }

      const matrixResult = Array.from(metricMap.entries()).map(([metricKey, values]) => ({
        metric: JSON.parse(metricKey),
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