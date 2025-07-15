import { ClickHouseAdapter, createClickHouseAdapter } from './clickhouse';
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
  LogEntry,
  DetectedFieldsResponse,
  DetectedField,
  DetectedLabelsResponse,
  Limits,
  QueryLimiter
} from './types';
import { DefaultLimits, LimitsMiddleware, QueryLimiterImpl, formatBytes } from './limits';
import { nowDateTime64, dateTime64HoursAgo } from './utils/date';

export class LokiService {
  private clickhouse: ClickHouseAdapter;
  private translator: LogQLTranslator;
  private config: {
    patternPersistenceEnabled?: boolean;
    queryIngestersWithin?: number; // in milliseconds
    queryPatternIngestersWithin?: number; // in milliseconds
  };
  private limits: Limits;
  private limitsMiddleware: LimitsMiddleware;

  constructor(
    clickhouse: ClickHouseAdapter,
    logsTable: string = 'otel_logs',
    config: {
      patternPersistenceEnabled?: boolean;
      queryIngestersWithin?: number;
      queryPatternIngestersWithin?: number;
    } = {},
    limits?: Limits
  ) {
    this.clickhouse = clickhouse;
    this.translator = new LogQLTranslator(logsTable);
    this.config = {
      patternPersistenceEnabled: true,
      queryIngestersWithin: 3 * 60 * 60 * 1000, // 3 hours default
      queryPatternIngestersWithin: 1 * 60 * 60 * 1000, // 1 hour default
      ...config
    };
    this.limits = limits || new DefaultLimits();
    this.limitsMiddleware = new LimitsMiddleware(this.limits);
  }

  async query(query: string, time?: string, limit?: number, direction?: 'forward' | 'backward', ctx?: any, userID?: string): Promise<LokiQueryResponse> {
    try {
      // Validate query limits
      if (ctx && userID) {
        const timeMs = time ? Number(this.parseTimestamp(time)) : Date.now();
        const validationError = this.limitsMiddleware.validateQuery(ctx, userID, query, timeMs, timeMs);
        if (validationError) {
          return {
            status: 'error',
            data: { resultType: 'streams', result: [] },
            error: validationError
          };
        }
      }

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
    direction?: 'forward' | 'backward',
    ctx?: any,
    userID?: string
  ): Promise<LokiQueryRangeResponse | LokiIndexVolumeRangeResponse> {
    try {
      // Validate query limits
      if (ctx && userID) {
        const startMs = Number(this.parseTimestamp(start));
        const endMs = Number(this.parseTimestamp(end));
        const validationError = this.limitsMiddleware.validateQuery(ctx, userID, query, startMs, endMs);
        if (validationError) {
          return {
            status: 'error',
            data: { resultType: 'streams', result: [] },
            error: validationError
          };
        }
      }
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

      // Parse step (default to 1 minute if not provided)
      const stepMs = step ? this.parseStep(step) : 60000;

      // Build query to get log entries for pattern detection
      let sql = `
        SELECT Body, Timestamp
        FROM ${this.translator['logsTable']}
        WHERE Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
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
          sql = sql.replace('WHERE ', `WHERE (${whereMatch[1]}) AND `);
          Object.assign(params, filterParams);
        }
      }

      sql += ' ORDER BY Timestamp';

      const results = await this.clickhouse.query<{ Body: string; Timestamp: string }>(sql, params);

      // Group logs by time buckets based on step and extract patterns
      const patterns = new Map<string, { pattern: string; samples: Array<[number, number]>; totalCount: number }>();

      for (const log of results) {
        const pattern = this.extractLokiPattern(log.Body);
        const timestamp = this.parseClickHouseTimestamp(log.Timestamp);
        const bucket = Math.floor(timestamp / (stepMs / 1000)) * (stepMs / 1000);

        if (!patterns.has(pattern)) {
          patterns.set(pattern, {
            pattern,
            samples: [],
            totalCount: 0
          });
        }

        const patternData = patterns.get(pattern)!;
        patternData.totalCount++;

        const existingSample = patternData.samples.find(sample => sample[0] === bucket);

        if (existingSample) {
          existingSample[1]++;
        } else {
          patternData.samples.push([bucket, 1]);
        }
      }

      // If pattern persistence is enabled, try to merge with stored patterns
      let mergedPatterns = Array.from(patterns.values());

      if (this.config.patternPersistenceEnabled) {
        // For now, we'll implement a simple in-memory pattern store
        // In a real implementation, this would be persisted to ClickHouse or another storage
        const storedPatterns = await this.getStoredPatterns(query, startTimestamp, endTimestamp);
        mergedPatterns = this.mergePatterns(mergedPatterns, storedPatterns);

        // Store current patterns for future queries
        await this.storePatterns(query, Array.from(patterns.values()), startTimestamp, endTimestamp);
      }

      // Convert to response format and sort by total occurrences
      const patternArray = mergedPatterns
        .map(p => ({
          pattern: p.pattern,
          samples: p.samples.sort((a, b) => a[0] - b[0]) // Sort by timestamp
        }))
        .sort((a, b) => {
          // Sort by total occurrences (descending)
          const aTotal = a.samples.reduce((sum, sample) => sum + sample[1], 0);
          const bTotal = b.samples.reduce((sum, sample) => sum + sample[1], 0);
          return bTotal - aTotal;
        });

      return {
        status: 'success',
        data: patternArray
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

  private async getStoredPatterns(query: string, start: string, end: string): Promise<Array<{ pattern: string; samples: Array<[number, number]>; totalCount: number }>> {
    try {
      // Query stored patterns from ClickHouse
      const sql = `
        SELECT
          pattern,
          timestamp,
          count
        FROM ${this.translator['logsTable']}_patterns
        WHERE query_hash = {queryHash:String}
          AND timestamp >= {start:DateTime64}
          AND timestamp <= {end:DateTime64}
        ORDER BY pattern, timestamp
      `;

      const params = {
        queryHash: this.hashQuery(query),
        start,
        end
      };

      const results = await this.clickhouse.query<{ pattern: string; timestamp: string; count: number }>(sql, params);

      // Group by pattern
      const patternMap = new Map<string, { pattern: string; samples: Array<[number, number]>; totalCount: number }>();

      for (const result of results) {
        const timestamp = this.parseClickHouseTimestamp(result.timestamp);
        const bucket = Math.floor(timestamp / 1000); // Convert to seconds

        if (!patternMap.has(result.pattern)) {
          patternMap.set(result.pattern, {
            pattern: result.pattern,
            samples: [],
            totalCount: 0
          });
        }

        const patternData = patternMap.get(result.pattern)!;
        patternData.samples.push([bucket, result.count]);
        patternData.totalCount += result.count;
      }

      return Array.from(patternMap.values());
    } catch (error) {
      // If the patterns table doesn't exist, return empty array
      console.log('No stored patterns found (this is normal for new installations):', error);
      return [];
    }
  }

  private async storePatterns(
    query: string,
    patterns: Array<{ pattern: string; samples: Array<[number, number]>; totalCount: number }>,
    start: string,
    end: string
  ): Promise<void> {
    try {
      // Create patterns table if it doesn't exist
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${this.translator['logsTable']}_patterns (
          query_hash String,
          pattern String,
          timestamp DateTime64(3),
          count UInt32,
          created_at DateTime64(3) DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY (query_hash, pattern, timestamp)
      `;

      await this.clickhouse.query(createTableSQL);

      // Prepare data for insertion
      const values: Array<{ queryHash: string; pattern: string; timestamp: string; count: number }> = [];

      for (const pattern of patterns) {
        for (const [timestamp, count] of pattern.samples) {
          values.push({
            queryHash: this.hashQuery(query),
            pattern: pattern.pattern,
            timestamp: new Date(timestamp * 1000).toISOString(),
            count
          });
        }
      }

      // Insert patterns in batches
      if (values.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < values.length; i += batchSize) {
          const batch = values.slice(i, i + batchSize);
          const insertSQL = `
            INSERT INTO ${this.translator['logsTable']}_patterns (query_hash, pattern, timestamp, count)
            VALUES
          ` + batch.map(v => `('${v.queryHash}', '${v.pattern}', '${v.timestamp}', ${v.count})`).join(',');

          await this.clickhouse.query(insertSQL);
        }
      }
    } catch (error) {
      console.error('Error storing patterns:', error);
      // Don't throw - pattern storage is optional
    }
  }

  private hashQuery(query: string): string {
    // Simple hash function for query identification
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private mergePatterns(
    currentPatterns: Array<{ pattern: string; samples: Array<[number, number]>; totalCount: number }>,
    storedPatterns: Array<{ pattern: string; samples: Array<[number, number]>; totalCount: number }>
  ): Array<{ pattern: string; samples: Array<[number, number]>; totalCount: number }> {
    const merged = new Map<string, { pattern: string; samples: Array<[number, number]>; totalCount: number }>();

    // Add current patterns
    for (const pattern of currentPatterns) {
      merged.set(pattern.pattern, { ...pattern });
    }

    // Merge with stored patterns
    for (const storedPattern of storedPatterns) {
      if (merged.has(storedPattern.pattern)) {
        // Merge samples for existing pattern
        const existing = merged.get(storedPattern.pattern)!;
        const sampleMap = new Map<number, number>();

        // Add existing samples
        for (const [timestamp, count] of existing.samples) {
          sampleMap.set(timestamp, count);
        }

        // Add stored samples
        for (const [timestamp, count] of storedPattern.samples) {
          sampleMap.set(timestamp, (sampleMap.get(timestamp) || 0) + count);
        }

        // Convert back to array
        existing.samples = Array.from(sampleMap.entries()).sort((a, b) => a[0] - b[0]);
        existing.totalCount += storedPattern.totalCount;
      } else {
        // Add new pattern
        merged.set(storedPattern.pattern, { ...storedPattern });
      }
    }

    return Array.from(merged.values());
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

  async getDetectedFields(query?: string, start?: string, end?: string): Promise<DetectedFieldsResponse> {
    try {
      // Parse timestamps
      const startTimestamp = start ? this.parseTimestamp(start) : dateTime64HoursAgo(24);
      const endTimestamp = end ? this.parseTimestamp(end) : nowDateTime64();

      // Handle empty query - logs-drilldown expects empty string, not {}
      const processedQuery = query === '{}' ? '' : query;

      // Build query to get log entries for field detection
      let sql = `
        SELECT Body, SeverityText, ResourceAttributes, LogAttributes
        FROM ${this.translator['logsTable']}
        WHERE Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
      `;

      const params: Record<string, any> = {
        start: startTimestamp,
        end: endTimestamp
      };

      // Add query filters if provided
      if (processedQuery && processedQuery !== '') {
        const logqlQuery = {
          query: processedQuery,
          start: startTimestamp,
          end: endTimestamp
        };
        const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
        const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
        if (whereMatch) {
          sql = sql.replace(/WHERE (.+?) AND Timestamp/g, `WHERE ${whereMatch[1]} AND Timestamp`);
          Object.assign(params, filterParams);
        }
      }

      sql += ' ORDER BY Timestamp DESC LIMIT 1000';

      const results = await this.clickhouse.query<{
        Body: string;
        SeverityText: string;
        ResourceAttributes: Record<string, string>;
        LogAttributes: Record<string, string>;
      }>(sql, params);

      // Process log entries to detect fields
      const detectedFields = new Map<string, {
        type: 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes';
        cardinality: Set<string>;
        parsers: Set<string>;
        jsonPath?: string[];
      }>();

      // Add structured metadata fields
      detectedFields.set('detected_level', {
        type: 'string',
        cardinality: new Set(),
        parsers: new Set(),
      });

      for (const entry of results) {
        // Add detected_level from severity
        if (entry.SeverityText) {
          const level = this.mapSeverityToLevel(entry.SeverityText);
          detectedFields.get('detected_level')!.cardinality.add(level);
        }

        // Parse log body for fields
        this.parseLogBodyForFields(entry.Body, detectedFields);
      }

      // Convert to response format
      const fields: Array<{
        cardinality: number;
        jsonPath: string[];
        label: string;
        parsers: string[] | null;
        type: string;
      }> = [];

      for (const [label, field] of detectedFields) {
        fields.push({
          label,
          type: field.type,
          cardinality: field.cardinality.size,
          parsers: Array.from(field.parsers),
          jsonPath: field.jsonPath || [],
        });
      }

      // Sort by cardinality (descending)
      fields.sort((a, b) => b.cardinality - a.cardinality);

      return {
        status: 'success',
        fields
      };
    } catch (error) {
      console.error('ClickHouse detected fields error:', error);
      return {
        status: 'error',
        fields: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private parseLogBodyForFields(body: string, detectedFields: Map<string, {
    type: 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes';
    cardinality: Set<string>;
    parsers: Set<string>;
    jsonPath?: string[];
  }>) {
    // Try JSON parsing first
    try {
      const jsonData = JSON.parse(body);
      this.extractJSONFields(jsonData, detectedFields, []);
      return;
    } catch {
      // Not JSON, try logfmt parsing
      this.extractLogfmtFields(body, detectedFields);
    }
  }

  private extractJSONFields(obj: any, detectedFields: Map<string, {
    type: 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes';
    cardinality: Set<string>;
    parsers: Set<string>;
    jsonPath?: string[];
  }>, path: string[]) {
    for (const [key, value] of Object.entries(obj)) {
      const fieldName = this.sanitizeFieldName(key);
      const fullPath = [...path, key];
      const fieldKey = fullPath.join('_');

      if (!detectedFields.has(fieldKey)) {
        detectedFields.set(fieldKey, {
          type: 'string',
          cardinality: new Set(),
          parsers: new Set(['json']),
          jsonPath: fullPath,
        });
      }

      const field = detectedFields.get(fieldKey)!;
      field.parsers.add('json');

      if (value !== null && value !== undefined) {
        const stringValue = String(value);
        field.cardinality.add(stringValue);

        // Update type based on value
        const detectedType = this.determineFieldType(stringValue);
        if (this.getTypePriority(detectedType) > this.getTypePriority(field.type)) {
          field.type = detectedType;
        }
      }

      // Recursively process nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.extractJSONFields(value, detectedFields, fullPath);
      }
    }
  }

  private extractLogfmtFields(line: string, detectedFields: Map<string, {
    type: 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes';
    cardinality: Set<string>;
    parsers: Set<string>;
    jsonPath?: string[];
  }>) {
    // Simple logfmt parsing: key=value pattern
    const logfmtRegex = /(\w+)=([^\s]+)/g;
    let match;

    while ((match = logfmtRegex.exec(line)) !== null) {
      const [, key, value] = match;
      const fieldName = this.sanitizeFieldName(key);

      if (!detectedFields.has(fieldName)) {
        detectedFields.set(fieldName, {
          type: 'string',
          cardinality: new Set(),
          parsers: new Set(['logfmt']),
        });
      }

      const field = detectedFields.get(fieldName)!;
      field.parsers.add('logfmt');
      field.cardinality.add(value);

      // Update type based on value
      const detectedType = this.determineFieldType(value);
      if (this.getTypePriority(detectedType) > this.getTypePriority(field.type)) {
        field.type = detectedType;
      }
    }
  }

  private sanitizeFieldName(name: string): string {
    // Replace invalid characters with underscores
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private determineFieldType(value: string): 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes' {
    // Remove quotes if present
    const cleanValue = value.replace(/^["']|["']$/g, '');

    // Check for boolean
    if (cleanValue.toLowerCase() === 'true' || cleanValue.toLowerCase() === 'false') {
      return 'boolean';
    }

    // Check for integer
    if (/^-?\d+$/.test(cleanValue)) {
      return 'int';
    }

    // Check for float
    if (/^-?\d+\.\d+$/.test(cleanValue)) {
      return 'float';
    }

    // Check for duration (e.g., "1s", "2m", "3h")
    if (/^\d+[smhd]$/.test(cleanValue)) {
      return 'duration';
    }

    // Check for bytes (e.g., "1KB", "2MB", "3GB")
    if (/^\d+[KMGT]?B$/.test(cleanValue.toUpperCase())) {
      return 'bytes';
    }

    // Default to string
    return 'string';
  }

  private getTypePriority(type: 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes'): number {
    const priorities = {
      'string': 1,
      'boolean': 2,
      'int': 3,
      'float': 4,
      'duration': 5,
      'bytes': 6
    };
    return priorities[type] || 1;
  }

  async getDetectedFieldValues(fieldName: string, query?: string, start?: string, end?: string): Promise<DetectedFieldsResponse> {
    try {
      // Parse timestamps
      const startTimestamp = start ? this.parseTimestamp(start) : dateTime64HoursAgo(24);
      const endTimestamp = end ? this.parseTimestamp(end) : nowDateTime64();

      // Build query to get log entries for field value extraction
      let sql = `
        SELECT Body, SeverityText
        FROM ${this.translator['logsTable']}
        WHERE Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}
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
          sql = sql.replace(/WHERE (.+?) AND Timestamp/g, `WHERE ${whereMatch[1]} AND Timestamp`);
          Object.assign(params, filterParams);
        }
      }

      sql += ' ORDER BY Timestamp DESC LIMIT 1000';

      const results = await this.clickhouse.query<{
        Body: string;
        SeverityText: string;
      }>(sql, params);

      // Extract values for the specific field
      const values = new Set<string>();

      for (const entry of results) {
        const fieldValues = this.extractFieldValues(entry.Body, fieldName);
        fieldValues.forEach(value => values.add(value));
      }

      return {
        status: 'success',
        values: Array.from(values).sort()
      };
    } catch (error) {
      console.error('ClickHouse detected field values error:', error);
      return {
        status: 'error',
        values: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private extractFieldValues(body: string, fieldName: string): string[] {
    const values: string[] = [];

    // Try JSON parsing first
    try {
      const jsonData = JSON.parse(body);
      const jsonValues = this.extractJSONFieldValues(jsonData, fieldName);
      values.push(...jsonValues);
    } catch {
      // Not JSON, try logfmt parsing
      const logfmtValues = this.extractLogfmtFieldValues(body, fieldName);
      values.push(...logfmtValues);
    }

    return values;
  }

  private extractJSONFieldValues(obj: any, fieldName: string): string[] {
    const values: string[] = [];
    const fieldParts = fieldName.split('_');

    // Handle nested field names (e.g., "user_id" -> ["user", "id"])
    let current = obj;
    for (const part of fieldParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return values; // Field not found
      }
    }

    if (current !== null && current !== undefined) {
      values.push(String(current));
    }

    return values;
  }

  private extractLogfmtFieldValues(line: string, fieldName: string): string[] {
    const values: string[] = [];
    const logfmtRegex = new RegExp(`${fieldName}=([^\\s]+)`, 'g');
    let match;

    while ((match = logfmtRegex.exec(line)) !== null) {
      const [, value] = match;
      values.push(value);
    }

    return values;
  }

  async getDetectedLabels(query?: string, start?: string, end?: string): Promise<DetectedLabelsResponse> {
    try {
      // Parse timestamps (default: last 24h)
      const startTimestamp = start ? this.parseTimestamp(start) : dateTime64HoursAgo(24);
      const endTimestamp = end ? this.parseTimestamp(end) : nowDateTime64();

      // Handle empty query - logs-drilldown expects empty string, not {}
      const processedQuery = query === '{}' ? '' : query;

      // Build a set of candidate label names (Loki-style, not all possible fields)
      const candidateLabels = [
        'service_name',
        'severity',
        'level',
        'trace_id',
        'span_id',
        'scope_name',
        'scope_version',
        'host',
        'container',
        'pod',
        'namespace',
        'job'
      ];

      // For each candidate, check if it exists in the time range (and query filter if provided)
      const detectedLabels: Array<{ cardinality: number; label: string }> = [];

      for (const label of candidateLabels) {
        let sql = '';
        let params: Record<string, any> = { start: startTimestamp, end: endTimestamp };

        switch (label) {
          case 'service_name':
            sql = `SELECT ServiceName, COUNT(DISTINCT ServiceName) as cardinality FROM ${this.translator['logsTable']} WHERE ServiceName != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'severity':
          case 'level':
            sql = `SELECT SeverityText, COUNT(DISTINCT SeverityText) as cardinality FROM ${this.translator['logsTable']} WHERE SeverityText != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'trace_id':
            sql = `SELECT TraceId, COUNT(DISTINCT TraceId) as cardinality FROM ${this.translator['logsTable']} WHERE TraceId != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'span_id':
            sql = `SELECT SpanId, COUNT(DISTINCT SpanId) as cardinality FROM ${this.translator['logsTable']} WHERE SpanId != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'scope_name':
            sql = `SELECT ScopeName, COUNT(DISTINCT ScopeName) as cardinality FROM ${this.translator['logsTable']} WHERE ScopeName != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'scope_version':
            sql = `SELECT ScopeVersion, COUNT(DISTINCT ScopeVersion) as cardinality FROM ${this.translator['logsTable']} WHERE ScopeVersion != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'host':
            sql = `SELECT ResourceAttributes['host.name'], COUNT(DISTINCT ResourceAttributes['host.name']) as cardinality FROM ${this.translator['logsTable']} WHERE ResourceAttributes['host.name'] != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'container':
            sql = `SELECT ResourceAttributes['container.name'], COUNT(DISTINCT ResourceAttributes['container.name']) as cardinality FROM ${this.translator['logsTable']} WHERE ResourceAttributes['container.name'] != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'pod':
            sql = `SELECT ResourceAttributes['k8s.pod.name'], COUNT(DISTINCT ResourceAttributes['k8s.pod.name']) as cardinality FROM ${this.translator['logsTable']} WHERE ResourceAttributes['k8s.pod.name'] != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'namespace':
            sql = `SELECT ResourceAttributes['k8s.namespace.name'], COUNT(DISTINCT ResourceAttributes['k8s.namespace.name']) as cardinality FROM ${this.translator['logsTable']} WHERE ResourceAttributes['k8s.namespace.name'] != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
          case 'job':
            sql = `SELECT ResourceAttributes['service.name'], COUNT(DISTINCT ResourceAttributes['service.name']) as cardinality FROM ${this.translator['logsTable']} WHERE ResourceAttributes['service.name'] != '' AND Timestamp >= {start:DateTime64} AND Timestamp <= {end:DateTime64}`;
            break;
        }

        // If query filter is provided, add it
        if (processedQuery && processedQuery !== '') {
          const logqlQuery = { query: processedQuery, start: startTimestamp, end: endTimestamp };
          const { sql: filterSql, params: filterParams } = this.translator.translateQuery(logqlQuery);
          const whereMatch = filterSql.match(/WHERE\s+(.+?)\s+ORDER/s);
          if (whereMatch) {
            sql = sql.replace('WHERE ', `WHERE (${whereMatch[1]}) AND `);
            Object.assign(params, filterParams);
          }
        }

        // Get cardinality for this label
        const result = await this.clickhouse.query<{ cardinality: number }>(sql + ' GROUP BY 1 LIMIT 1', params);
        if (result.length > 0 && result[0].cardinality > 0) {
          detectedLabels.push({
            label,
            cardinality: result[0].cardinality
          });
        }
      }

      // Sort by cardinality (descending)
      detectedLabels.sort((a, b) => b.cardinality - a.cardinality);

      return {
        status: 'success',
        detectedLabels
      };
    } catch (error) {
      console.error('ClickHouse detected labels error:', error);
      return {
        status: 'error',
        detectedLabels: [],
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

        if (targetLabels) {
          // Only include targetLabels in the metric
          targetLabels.split(',').map(label => label.trim()).forEach(label => {
            if (row[label] !== null && row[label] !== undefined) {
              if (label === 'severity' || label === 'level') {
                metric[label] = this.mapSeverityToLevel(row[label].toString());
              } else {
                metric[label] = row[label].toString();
              }
            }
          });
        } else {
          // Add all non-volume fields as metric labels
          Object.keys(row).forEach(key => {
            if (key !== 'volume' && row[key] !== null && row[key] !== undefined) {
              if (key === 'severity' || key === 'level') {
                metric[key] = this.mapSeverityToLevel(row[key].toString());
              } else {
                metric[key] = row[key].toString();
              }
            }
          });
        }

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

      // Debug log
      console.log('getIndexVolumeRange SQL:', sql);
      console.log('getIndexVolumeRange params:', params);
      const results = await this.clickhouse.query<any>(sql, params);

      // Group by metric labels for matrix format
      const metricMap = new Map<string, Array<[number, string]>>();

      for (const result of results) {
        const metric: Record<string, string> = {};

        if (targetLabels) {
          // Only include targetLabels in the metric
          targetLabels.split(',').map(label => label.trim()).forEach(label => {
            if (result[label] !== null && result[label] !== undefined) {
              if (label === 'severity' || label === 'level') {
                metric[label] = this.mapSeverityToLevel(result[label].toString());
              } else {
                metric[label] = result[label].toString();
              }
            }
          });
        } else {
          // Add all non-timestamp and non-volume fields as metric labels
          Object.keys(result).forEach(key => {
            if (key !== 'timestamp' && key !== 'volume' && result[key] !== null && result[key] !== undefined) {
              if (key === 'severity' || key === 'level') {
                metric[key] = this.mapSeverityToLevel(result[key].toString());
              } else {
                metric[key] = result[key].toString();
              }
            }
          });
        }

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