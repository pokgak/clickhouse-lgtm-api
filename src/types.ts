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

export interface LogEntry {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  TraceFlags: number;
  SeverityText: string;
  SeverityNumber: number;
  ServiceName: string;
  Body: string;
  ResourceSchemaUrl: string;
  ResourceAttributes: any; // JSON type
  ScopeSchemaUrl: string;
  ScopeName: string;
  ScopeVersion: string;
  ScopeAttributes: any; // JSON type
  LogAttributes: any; // JSON type
}