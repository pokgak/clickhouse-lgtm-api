-- Enable JSON type support
SET allow_experimental_object_type = 1;

-- Create the otel_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS default.otel_logs
(
    `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `TraceId` String CODEC(ZSTD(1)),
    `SpanId` String CODEC(ZSTD(1)),
    `TraceFlags` UInt8,
    `SeverityText` LowCardinality(String) CODEC(ZSTD(1)),
    `SeverityNumber` UInt8,
    `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
    `Body` String CODEC(ZSTD(1)),
    `ResourceSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
    `ResourceAttributes` JSON CODEC(ZSTD(1)),
    `ScopeSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
    `ScopeName` String CODEC(ZSTD(1)),
    `ScopeVersion` LowCardinality(String) CODEC(ZSTD(1)),
    `ScopeAttributes` JSON CODEC(ZSTD(1)),
    `LogAttributes` JSON CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key JSONExtractKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key JSONExtractKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_log_attr_key JSONExtractKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SeverityText, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + toIntervalDay(3)
SETTINGS ttl_only_drop_parts = 1;

-- Insert some sample data for testing
INSERT INTO default.otel_logs VALUES
(
    now64(9),
    'trace123',
    'span456',
    1,
    'INFO',
    9,
    'sample-service',
    'Application started successfully',
    '',
    '{"service.name":"sample-service","deployment.environment":"development"}',
    '',
    'sample-logger',
    '1.0.0',
    '{}',
    '{"component":"startup","module":"main"}'
),
(
    now64(9) - 60,
    'trace124',
    'span457',
    1,
    'ERROR',
    17,
    'sample-service',
    'Database connection failed',
    '',
    '{"service.name":"sample-service","deployment.environment":"development"}',
    '',
    'sample-logger',
    '1.0.0',
    '{}',
    '{"component":"database","error.type":"connection_timeout"}'
),
(
    now64(9) - 120,
    'trace125',
    'span458',
    1,
    'WARN',
    13,
    'api-gateway',
    'Rate limit exceeded for user',
    '',
    '{"service.name":"api-gateway","deployment.environment":"production"}',
    '',
    'rate-limiter',
    '2.1.0',
    '{}',
    '{"user.id":"user123","endpoint":"/api/v1/data"}'
);