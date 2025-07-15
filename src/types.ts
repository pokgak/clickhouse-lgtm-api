export interface LokiQueryResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'streams';
    result: LokiStream[];
  };
  error?: string;
}

export interface LokiQueryRangeResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'streams';
    result: LokiStream[];
  };
  error?: string;
}

export interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

export interface LokiLabelsResponse {
  status: 'success' | 'error';
  data: string[];
  error?: string;
}

export interface LokiLabelValuesResponse {
  status: 'success' | 'error';
  data: string[];
  error?: string;
}

export interface LokiSeriesResponse {
  status: 'success' | 'error';
  data: Record<string, string>[];
  error?: string;
}

export interface LokiIndexStatsResponse {
  status: 'success' | 'error';
  data: {
    streams: number;
    chunks: number;
    entries: number;
    bytes: number;
  };
  error?: string;
}

export interface LokiIndexVolumeResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'vector';
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
  error?: string;
}

export interface LokiIndexVolumeRangeResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'matrix';
    result: Array<{
      metric: Record<string, string>;
      values: [number, string][];
    }>;
  };
  error?: string;
}

export interface LokiPatternsResponse {
  status: 'success' | 'error';
  data: Array<{
    pattern: string;
    samples: Array<[number, number]>; // [timestamp, count]
  }>;
  error?: string;
}

export interface LogEntry {
  Timestamp: string;
  TimestampTime: string;
  TraceId: string;
  SpanId: string;
  TraceFlags: number;
  SeverityText: string;
  SeverityNumber: number;
  ServiceName: string;
  Body: string;
  ResourceSchemaUrl: string;
  ResourceAttributes: Record<string, string>; // Map type
  ScopeSchemaUrl: string;
  ScopeName: string;
  ScopeVersion: string;
  ScopeAttributes: Record<string, string>; // Map type
  LogAttributes: Record<string, string>; // Map type
}

export interface DetectedField {
  label: string;
  type: 'string' | 'int' | 'float' | 'boolean' | 'duration' | 'bytes';
  cardinality: number;
  parsers: string[];
  jsonPath?: string[];
}

export interface DetectedFieldsResponse {
  status: 'success' | 'error';
  fields?: Array<{
    cardinality: number;
    jsonPath: string[];
    label: string;
    parsers: string[] | null;
    type: string;
  }>;
  values?: string[];
  error?: string;
}

export interface DetectedLabelsResponse {
  status: 'success' | 'error';
  detectedLabels: Array<{
    cardinality: number;
    label: string;
  }>;
  error?: string;
}

export interface QueryLimits {
  maxQueryLength?: number; // in milliseconds
  maxQueryRange?: number; // in milliseconds
  maxQueryLookback?: number; // in milliseconds
  maxEntriesLimitPerQuery?: number;
  queryTimeout?: number; // in milliseconds
  requiredLabels?: string[];
  requiredNumberLabels?: number;
  maxQueryBytesRead?: number; // in bytes
  maxQuerierBytesRead?: number; // in bytes
  maxQuerySeries?: number;
  maxQueryParallelism?: number;
}

export interface Limits {
  // Query limits
  MaxQuerySeries(ctx: any, userID: string): number;
  MaxEntriesLimitPerQuery(ctx: any, userID: string): number;
  MaxQueryLookback(ctx: any, userID: string): number;
  MaxQueryLength(ctx: any, userID: string): number;
  MaxQueryParallelism(ctx: any, userID: string): number;
  MaxQueryBytesRead(ctx: any, userID: string): number;
  MaxQuerierBytesRead(ctx: any, userID: string): number;

  // Required labels
  RequiredLabels(ctx: any, userID: string): string[];
  RequiredNumberLabels(ctx: any, userID: string): number;
}

export interface LimitsConfig {
  maxQuerySeries?: number;
  maxEntriesLimitPerQuery?: number;
  maxQueryLookback?: number; // in milliseconds
  maxQueryLength?: number; // in milliseconds
  maxQueryParallelism?: number;
  maxQueryBytesRead?: number; // in bytes
  maxQuerierBytesRead?: number; // in bytes
  requiredLabels?: string[];
  requiredNumberLabels?: number;
}

export interface QueryLimiter {
  AddSeries(series: any): boolean; // returns true if limit exceeded
  AddChunkBytes(bytes: number): boolean; // returns true if limit exceeded
  AddChunk(): boolean; // returns true if limit exceeded
  GetStats(): {
    seriesCount: number;
    chunkBytesCount: number;
    chunkCount: number;
  };
}