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
    volumes: Array<{
      name: string;
      volume: number;
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