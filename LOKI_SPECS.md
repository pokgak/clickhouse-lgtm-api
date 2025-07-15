# Loki HTTP API

Loki exposes an HTTP API for pushing, querying, and tailing log data, as well as for viewing and managing cluster information.

> Note
>
> Note that authorization is not part of the Loki API. Authorization needs to be done separately, for example, using an open-source load-balancer such as NGINX.

## Endpoints

### Ingest endpoints

These endpoints are exposed by the `distributor`, `write`, and `all` components:

*   `POST /loki/api/v1/push`
*   `POST /otlp/v1/logs`

### Query endpoints

These HTTP endpoints are exposed by the `querier`, `query-frontend`, `read`, and `all` components:

*   `GET /loki/api/v1/query`
*   `GET /loki/api/v1/query_range`
*   `GET /loki/api/v1/labels`
*   `GET /loki/api/v1/label/<name>/values`
*   `GET /loki/api/v1/series`
*   `GET /loki/api/v1/index/stats`
*   `GET /loki/api/v1/index/volume`
*   `GET /loki/api/v1/index/volume_range`
*   `GET /loki/api/v1/patterns`
*   `GET /loki/api/v1/tail`

### Status endpoints

These HTTP endpoints are exposed by all components and return the status of the component:

- `GET /ready` — Returns HTTP 200 when the Loki instance is ready to accept traffic. If running Loki on Kubernetes, `/ready` can be used as a readiness probe.
- `GET /log_level` — Returns the current log level.
- `POST /log_level` — Lets you change the log level of a Loki process at runtime. Accepts the `log_level` query parameter or form value. Valid levels: [debug, info, warn, error].
- `GET /metrics` — Returns exposed Prometheus metrics.
- `GET /config` — Exposes the current configuration. The optional `mode` query parameter can be used to modify the output. If it has the value `diffs` only the differences between the default configuration and the current are returned. A value of `defaults` returns the default configuration.
- `GET /services` — Returns a list of all running services and their current states. Services can have the following states: New, Starting, Running, Stopping, Terminated, Failed.
- `GET /loki/api/v1/status/buildinfo` — Exposes the build information in a JSON object. The fields are `version`, `revision`, `branch`, `buildDate`, `buildUser`, and `goVersion`.

---

## Ring endpoints

These HTTP endpoints are exposed by their respective component that is part of the ring URL prefix:

- `GET /distributor/ring` — Displays a web page with the distributor hash ring status, including the state, health, and last heartbeat time of each distributor.
- `GET /indexgateway/ring` — Displays a web page with the index gateway hash ring status, including the state, health, and last heartbeat time of each index gateway.
- `GET /ruler/ring` — Displays a web page with the ruler hash ring status, including the state, health, and last heartbeat time of each ruler.
- `GET /compactor/ring` — Displays a web page with the compactor hash ring status, including the state, health, and last heartbeat time of each compactor.

---

## Flush/shutdown endpoints

These HTTP endpoints are exposed by the `ingester`, `write`, and `all` components for flushing chunks and/or shutting down.

- `POST /flush` — Triggers a flush of all in-memory chunks held by the ingesters to the backing store. Mainly used for local testing.
- `GET, POST, DELETE /ingester/prepare_shutdown` — Used to tell the ingester to release all resources on receiving the next `SIGTERM` or `SIGINT` signal. `POST` configures the ingester for a full shutdown and returns immediately. `GET` returns the status of this configuration, either `set` or `unset`. `DELETE` reverts the configuration of the ingester to its previous state.
- `GET, POST /ingester/shutdown` — Triggers a shutdown of the ingester and will always flush any in memory chunks it holds. Accepts three URL query parameters: `flush` (default: true), `delete_ring_tokens` (default: false), and `terminate` (default: true).

---

## Rule endpoints

These HTTP endpoints are exposed by the `ruler` component:

- `GET /loki/api/v1/rules` — List all rules configured for the authenticated tenant. Returns a YAML dictionary with all the rule groups for each namespace.
- `GET /loki/api/v1/rules/{namespace}` — Returns the rule groups defined for a given namespace.
- `GET /loki/api/v1/rules/{namespace}/{groupName}` — Returns the rule group matching the request namespace and group name.
- `POST /loki/api/v1/rules/{namespace}` — Creates or updates a rule group. Expects a request with `Content-Type: application/yaml` header and the rules YAML definition in the request body.
- `DELETE /loki/api/v1/rules/{namespace}/{groupName}` — Deletes a rule group by namespace and group name.
- `DELETE /loki/api/v1/rules/{namespace}` — Deletes all the rule groups in a namespace (including the namespace itself).
- `GET /api/prom/rules` — Prometheus-compatible endpoint to list rule groups.
- `GET /api/prom/rules/{namespace}`
- `GET /api/prom/rules/{namespace}/{groupName}`
- `POST /api/prom/rules/{namespace}`
- `DELETE /api/prom/rules/{namespace}/{groupName}`
- `DELETE /api/prom/rules/{namespace}`
- `GET /prometheus/api/v1/rules` — Prometheus-compatible rules endpoint to list alerting and recording rules that are currently loaded. The `type` parameter is optional. If set, only the specified type of rule is returned. The `file`, `rule_group` and `rule_name` parameters are optional, and can accept multiple values. If set, the response content is filtered accordingly.
- `GET /prometheus/api/v1/alerts` — Prometheus-compatible rules endpoint to list all active alerts.

**Example response for `GET /loki/api/v1/rules`:**

```yaml
---
<namespace1>:
- name: <string>
  interval: <duration;optional>
  rules:
  - alert: <string>
      expr: <string>
      for: <duration>
      annotations:
      <annotation_name>: <string>
      labels:
      <label_name>: <string>
- name: <string>
  interval: <duration;optional>
  rules:
  - alert: <string>
      expr: <string>
      for: <duration>
      annotations:
      <annotation_name>: <string>
      labels:
      <label_name>: <string>
<namespace2>:
- name: <string>
  interval: <duration;optional>
  rules:
  - alert: <string>
      expr: <string>
      for: <duration>
      annotations:
      <annotation_name>: <string>
      labels:
      <label_name>: <string>
```

### Log deletion endpoints

These endpoints are exposed by the `compactor`, `backend`, and `all` components:

*   `POST /loki/api/v1/delete` — Create a new delete request for the authenticated tenant. The query parameter can include filter operations. For example `query={foo="bar"} |= "other"` will filter out lines that contain the string “other” for the streams matching the stream selector `{foo="bar"}`.
*   `GET /loki/api/v1/delete` — List the existing delete requests for the authenticated tenant. Returns both processed and unprocessed deletion requests. Does not list canceled requests.
*   `DELETE /loki/api/v1/delete` — Remove a delete request for the authenticated tenant. Allows cancellation of delete requests until the requests are picked up for processing. Controlled by the `delete_request_cancel_period` YAML configuration or the equivalent command line option when invoking Loki. To cancel a delete request that has been picked up for processing or is partially complete, pass the `force=true` query parameter to the API.

**Example cURL command for creating a delete request:**

```bash
curl -g -X POST \
  'http://127.0.0.1:3100/loki/api/v1/delete?query={foo="bar"}&start=1591616227&end=1591619692' \
  -H 'X-Scope-OrgID: 1'
```

**Example cURL command for listing delete requests:**

```bash
curl -X GET \
  <compactor_addr>/loki/api/v1/delete \
  -H 'X-Scope-OrgID: <orgid>'
```

**Example cURL command for canceling a delete request:**

```bash
curl -X DELETE \
  '<compactor_addr>/loki/api/v1/delete?request_id=<request_id>' \
  -H 'X-Scope-OrgID: <tenant-id>'
```

---

## Other endpoints

- `GET /loki/api/v1/format_query` — Lets you format LogQL queries. It returns an error if the passed LogQL is invalid. It is exposed by all Loki components and helps to improve readability and the debugging experience of LogQL queries.

**Example:**

```bash
curl -G 'http://localhost:3100/loki/api/v1/format_query' --data-urlencode 'query={foo="bar"}'
```

**Example response:**

```json
{
   "status" : "success",
   "data" : "{foo=\"bar\"}"
}
```

---

## Deprecated endpoints

> Note
>
> The following endpoints are deprecated. While they still exist and work, they should not be used for new deployments. Existing deployments should upgrade to use the supported endpoints.

| Deprecated                | Replacement                        |
|---------------------------|-------------------------------------|
| `POST /api/prom/push`     | `POST /loki/api/v1/push`            |
| `GET /api/prom/tail`      | `GET /loki/api/v1/tail`             |
| `GET /api/prom/query`     | `GET /loki/api/v1/query`            |
| `GET /api/prom/label`     | `GET /loki/api/v1/labels`           |
| `GET /api/prom/label/<name>/values` | `GET /loki/api/v1/label/<name>/values` |
| `GET /api/prom/series`    | `GET /loki/api/v1/series`           |

## Format

### Matrix, vector, and stream

Some Loki API endpoints return a result of a matrix, a vector, or a stream:

* **Matrix**: a table of values where each row represents a different label set and the columns are each sample values for that row over the queried time. Matrix types are only returned when running a query that computes some value.
* **Instant Vector**: denoted in the type as just `vector`, an Instant Vector represents the latest value of a calculation for a given labelset. Instant Vectors are only returned when doing a query against a single point in time.
* **Stream**: a Stream is a set of all values (logs) for a given label set over the queried time range. Streams are the only type that will result in log lines being returned.

### Timestamps

The API accepts several formats for timestamps:

* All epoch values will be interpreted as a Unix timestamp in nanoseconds.
* A floating point number is a Unix timestamp with fractions of a second.
* A string in `RFC3339` and `RFC3339Nano` format, as supported by Go's time package.

> Note
>
> When using `/api/v1/push`, you must send the timestamp as a string and not a number, otherwise the endpoint will return a 400 error.

### Statistics

Query endpoints such as `/loki/api/v1/query` and `/loki/api/v1/query_range` return a set of statistics about the query execution. Those statistics allow users to understand the amount of data processed and at which speed.

The example below shows all possible statistics returned with their respective description.

```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [],
    "stats": {
      "ingester": {
        "compressedBytes": 0, // Total bytes of compressed chunks (blocks) processed by ingesters
        "decompressedBytes": 0, // Total bytes decompressed and processed by ingesters
        "decompressedLines": 0, // Total lines decompressed and processed by ingesters
        "headChunkBytes": 0, // Total bytes read from ingesters head chunks
        "headChunkLines": 0, // Total lines read from ingesters head chunks
        "totalBatches": 0, // Total batches sent by ingesters
        "totalChunksMatched": 0, // Total chunks matched by ingesters
        "totalDuplicates": 0, // Total of duplicates found by ingesters
        "totalLinesSent": 0, // Total lines sent by ingesters
        "totalReached": 0 // Amount of ingesters reached.
      },
      "store": {
        "compressedBytes": 0, // Total bytes of compressed chunks (blocks) processed by the store
        "decompressedBytes": 0, // Total bytes decompressed and processed by the store
        "decompressedLines": 0, // Total lines decompressed and processed by the store
        "chunksDownloadTime": 0, // Total time spent downloading chunks in seconds (float)
        "totalChunksRef": 0, // Total chunks found in the index for the current query
        "totalChunksDownloaded": 0, // Total of chunks downloaded
        "totalDuplicates": 0 // Total of duplicates removed from replication
      },
      "summary": {
        "bytesProcessedPerSecond": 0, // Total of bytes processed per second
        "execTime": 0, // Total execution time in seconds (float)
        "linesProcessedPerSecond": 0, // Total lines processed per second
        "queueTime": 0, // Total queue time in seconds (float)
        "totalBytesProcessed": 0, // Total amount of bytes processed overall for this request
        "totalLinesProcessed": 0 // Total amount of lines processed overall for this request
      }
    }
  }
}
```

## Ingest logs

```http
POST /loki/api/v1/push
```

`/loki/api/v1/push` is the endpoint used to send log entries to Loki. The default behavior is for the POST body to be a [Snappy](https://github.com/google/snappy)-compressed [Protocol Buffer](https://github.com/protocolbuffers/protobuf) message:

- [Protocol Buffer definition](https://github.com/grafana/loki/blob/main/pkg/logproto/logproto.proto)
- [Go client library](https://github.com/grafana/loki/blob/main/clients/pkg/promtail/client/client.go)

These POST requests require the `Content-Type` HTTP header to be `application/x-protobuf`.

Alternatively, if the `Content-Type` header is set to `application/json`, a JSON post body can be sent in the following format:

```json
{
  "streams": [
    {
      "stream": {
        "label": "value"
      },
      "values": [
        [ "<unix epoch in nanoseconds>", "<log line>" ],
        [ "<unix epoch in nanoseconds>", "<log line>" ]
      ]
    }
  ]
}
```

You can set `Content-Encoding: gzip` request header and post gzipped JSON.

You can optionally attach structured metadata to each log line by adding a JSON object to the end of the log line array. The JSON object must be a valid JSON object with string keys and string values. The JSON object should not contain any nested object. The JSON object must be set immediately after the log line. Here is an example of a log entry with some structured metadata attached:

```json
"values": [
    [ "<unix epoch in nanoseconds>", "<log line>", {"trace_id": "0242ac120002", "user_id": "superUser123"}]
]
```

In microservices mode, `/loki/api/v1/push` is exposed by the distributor.

If `block_ingestion_until` is configured and push requests are blocked, the endpoint will return the status code configured in `block_ingestion_status_code` (`260` by default) along with an error message. If the configured status code is `200`, no error message will be returned.

### Examples

The following cURL command pushes a stream with the label `foo=bar2` and a single log line `fizzbuzz` using JSON encoding:

```bash
curl -H "Content-Type: application/json" \
  -s -X POST "http://localhost:3100/loki/api/v1/push" \
  --data-raw '{"streams": [{ "stream": { "foo": "bar2" }, "values": [ [ "1570818238000000000", "fizzbuzz" ] ] }]}'
```

---

## Ingest logs using OTLP

```http
POST /otlp/v1/logs
```

`/otlp/v1/logs` lets the OpenTelemetry Collector send logs to Loki using `otlphttp` protocol.

For information on how to configure Loki, refer to the OTel Collector topic in the Loki documentation.

> Note
>
> When configuring the OpenTelemetry Collector, you must use `endpoint: http://<loki-addr>:3100/otlp`, as the collector automatically completes the endpoint. Entering the full endpoint will generate an error.

## Query logs at a single point in time

```http
GET /loki/api/v1/query
```

`/loki/api/v1/query` allows for doing queries against a single point in time. This type of query is often referred to as an instant query. Instant queries are only used for metric type LogQL queries and will return a 400 (Bad Request) in case a log type query is provided. The endpoint accepts the following query parameters in the URL:

- `query`: The LogQL query to perform. Requests that do not use valid LogQL syntax will return errors.
- `limit`: The max number of entries to return. It defaults to `100`. Only applies to query types which produce a stream (log lines) response.
- `time`: The evaluation time for the query as a nanosecond Unix epoch or another supported format. Defaults to now.
- `direction`: Determines the sort order of logs. Supported values are `forward` or `backward`. Defaults to `backward`.

In microservices mode, `/loki/api/v1/query` is exposed by the querier and the query frontend.

**Response format:**

```json
{
  "status": "success",
  "data": {
    "resultType": "vector" | "streams",
    "result": [<vector value>] | [<stream value>],
    "stats" : [<statistics>]
  }
}
```

where `<vector value>` is:

```json
{
  "metric": {
    <label key-value pairs>
  },
  "value": [
    <number: second unix epoch>,
    <string: value>
  ]
}
```

and `<stream value>` is:

```json
{
  "stream": {
    <label key-value pairs>
  },
  "values": [
    [<string: nanosecond unix epoch>, <string: log line>],
    ...
  ]
}
```

The items in the `values` array are sorted by timestamp. The most recent item is first when using `direction=backward`. The oldest item is first when using `direction=forward`.

Parquet can be requested as a response format by setting the `Accept` header to `application/vnd.apache.parquet`.

The schema is the following for streams:

| column_name | column_type           |
|-------------|----------------------|
| timestamp   | TIMESTAMP WITH TIME ZONE |
| labels      | MAP(VARCHAR, VARCHAR) |
| line        | VARCHAR               |

and for metrics:

| column_name | column_type           |
|-------------|----------------------|
| timestamp   | TIMESTAMP WITH TIME ZONE |
| labels      | MAP(VARCHAR, VARCHAR) |
| value       | DOUBLE                |

See the Statistics section for information about the statistics returned by Loki.

### Examples

This example cURL command:

```bash
curl -G -s  "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query=sum(rate({job="varlogs"}[10m])) by (level)' | jq
```

gave this response:

```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {},
        "value": [
          1588889221,
          "1267.1266666666666"
        ]
      },
      {
        "metric": {
          "level": "warn"
        },
        "value": [
          1588889221,
          "37.77166666666667"
        ]
      },
      {
        "metric": {
          "level": "info"
        },
        "value": [
          1588889221,
          "37.69"
        ]
      }
    ],
    "stats": {
      ...
    }
  }
}
```

If your cluster has Grafana Loki Multi-Tenancy enabled, set the `X-Scope-OrgID` header to identify the tenant you want to query. Here is the same example query for the single tenant called `Tenant1`:

```bash
curl -H 'X-Scope-OrgID:Tenant1' \
  -G -s "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query=sum(rate({job="varlogs"}[10m])) by (level)' | jq
```

To query against the three tenants `Tenant1`, `Tenant2`, and `Tenant3`, specify the tenant names separated by the pipe (`|`) character:

```bash
curl -H 'X-Scope-OrgID:Tenant1|Tenant2|Tenant3' \
  -G -s "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query=sum(rate({job="varlogs"}[10m])) by (level)' | jq
```

The same example query for Grafana Enterprise Logs uses Basic Authentication and specifies the tenant names as a `user`. The tenant names are separated by the pipe (`|`) character. The password in this example is an access policy token that has been defined in the `API_TOKEN` environment variable:

```bash
curl -u "Tenant1|Tenant2|Tenant3:$API_TOKEN" \
  -G -s "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query=sum(rate({job="varlogs"}[10m])) by (level)' | jq
```

To query against your hosted log tenant in Grafana Cloud, use the **User** and **URL** values provided in the Loki logging service details of your Grafana Cloud stack. Use an access policy token in your queries for authentication. The password in this example is an access policy token that has been defined in the `API_TOKEN` environment variable:

```bash
curl -u "User:$API_TOKEN" \
  -G -s "<URL-PROVIDED-IN-LOKI-DATA-SOURCE-SETTINGS>/loki/api/v1/query" \
  --data-urlencode 'query=sum(rate({job="varlogs"}[10m])) by (level)' | jq
```

---

## Query logs within a range of time

```http
GET /loki/api/v1/query_range
```

`/loki/api/v1/query_range` is used to do a query over a range of time. This type of query is often referred to as a range query. Range queries are used for both log and metric type LogQL queries. It accepts the following query parameters in the URL:

- `query`: The LogQL query to perform.
- `limit`: The max number of entries to return. It defaults to `100`. Only applies to query types which produce a stream (log lines) response.
- `start`: The start time for the query as a nanosecond Unix epoch or another supported format. Defaults to one hour ago. Loki returns results with timestamp greater or equal to this value.
- `end`: The end time for the query as a nanosecond Unix epoch or another supported format. Defaults to now. Loki returns results with timestamp lower than this value.
- `since`: A `duration` used to calculate `start` relative to `end`. If `end` is in the future, `start` is calculated as this duration before now. Any value specified for `start` supersedes this parameter.
- `step`: Query resolution step width in `duration` format or float number of seconds. `duration` refers to Prometheus duration strings of the form `[0-9]+[smhdwy]`. For example, 5m refers to a duration of 5 minutes. Defaults to a dynamic value based on `start` and `end`. Only applies to query types which produce a matrix response.
- `interval`: Only return entries at (or greater than) the specified interval, can be a `duration` format or float number of seconds. Only applies to queries which produce a stream response. Not to be confused with `step`, see the explanation under Step versus interval.
- `direction`: Determines the sort order of logs. Supported values are `forward` or `backward`. Defaults to `backward.`

In microservices mode, `/loki/api/v1/query_range` is exposed by the querier and the query frontend.

### Step versus interval

Use the `step` parameter when making metric queries to Loki, or queries which return a matrix response. It is evaluated in exactly the same way Prometheus evaluates `step`. First the query will be evaluated at `start` and then evaluated again at `start + step` and again at `start + step + step` until `end` is reached. The result will be a matrix of the query result evaluated at each step.

Use the `interval` parameter when making log queries to Loki, or queries which return a stream response. It is evaluated by returning a log entry at `start`, then the next entry will be returned an entry with timestamp >= `start + interval`, and again at `start + interval + interval` and so on until `end` is reached. It does not fill missing entries.

**Response format:**

```json
{
  "status": "success",
  "data": {
    "resultType": "matrix" | "streams",
    "result": [<matrix value>] | [<stream value>],
    "stats" : [<statistics>]
  }
}
```

where `<matrix value>` is:

```json
{
  "metric": {
    <label key-value pairs>
  },
  "values": [
    [<number: second unix epoch>, <string: value>],
    ...
  ]
}
```

The items in the `values` array are sorted by timestamp, and the oldest item is first.

And `<stream value>` is:

```json
{
  "stream": {
    <label key-value pairs>
  },
  "values": [
    [<string: nanosecond unix epoch>, <string: log line>],
    ...
  ]
}
```

The items in the `values` array are sorted by timestamp. The most recent item is first when using `direction=backward`. The oldest item is first when using `direction=forward`.

Parquet can be requested as a response format by setting the `Accept` header to `application/vnd.apache.parquet`.

The schema is the following for streams:

| column_name | column_type           |
|-------------|----------------------|
| timestamp   | TIMESTAMP WITH TIME ZONE |
| labels      | MAP(VARCHAR, VARCHAR) |
| line        | VARCHAR               |

and for metrics:

| column_name | column_type           |
|-------------|----------------------|
| timestamp   | TIMESTAMP WITH TIME ZONE |
| labels      | MAP(VARCHAR, VARCHAR) |
| value       | DOUBLE                |

See the Statistics section for information about the statistics returned by Loki.

### Examples

This example cURL command:

```bash
curl -G -s  "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query=sum(rate({job="varlogs"}[10m])) by (level)' \
  --data-urlencode 'step=300' | jq
```

gave this response:

```json
{
  "status": "success",
  "data": {
    "resultType": "matrix",
    "result": [
      {
        "metric": {
          "level": "info"
        },
        "values": [
          [1588889221, "137.95"],
          [1588889221, "467.115"],
          [1588889221, "658.8516666666667"]
        ]
      },
      {
        "metric": {
          "level": "warn"
        },
        "values": [
          [1588889221, "137.27833333333334"],
          [1588889221, "467.69"],
          [1588889221, "660.6933333333334"]
        ]
      }
    ],
    "stats": {
      ...
    }
  }
}
```

This example cURL command:

```bash
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={job="varlogs"}' | jq
```

gave this response:

```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [
      {
        "stream": {
          "filename": "/var/log/myproject.log",
          "job": "varlogs",
          "level": "info"
        },
        "values": [
          ["1569266497240578000", "foo"],
          ["1569266492548155000", "bar"]
        ]
      }
    ],
    "stats": {
      ...
    }
  }
}
```

---

## Query labels

```http
GET /loki/api/v1/labels
```

`/loki/api/v1/labels` retrieves the list of known labels within a given time span. Loki may use a larger time span than the one specified. It accepts the following query parameters in the URL:

- `start`: The start time for the query as a nanosecond Unix epoch. Defaults to 6 hours ago.
- `end`: The end time for the query as a nanosecond Unix epoch. Defaults to now.
- `since`: A `duration` used to calculate `start` relative to `end`. If `end` is in the future, `start` is calculated as this duration before now. Any value specified for `start` supersedes this parameter.
- `query`: Log stream selector that selects the streams to match and return label names. Example: `{app="myapp", environment="dev"}`

In microservices mode, `/loki/api/v1/labels` is exposed by the querier.

**Response format:**

```json
{
  "status": "success",
  "data": [
    <label string>,
    ...
  ]
}
```

### Examples

This example cURL command:

```bash
curl -G -s  "http://localhost:3100/loki/api/v1/labels" | jq
```

gave this response:

```json
{
  "status": "success",
  "data": [
    "foo",
    "bar",
    "baz"
  ]
}
```

---

## Query label values

```http
GET /loki/api/v1/label/<name>/values
```

`/loki/api/v1/label/<name>/values` retrieves the list of known values for a given label within a given time span. Loki may use a larger time span than the one specified. It accepts the following query parameters in the URL:

- `start`: The start time for the query as a nanosecond Unix epoch. Defaults to 6 hours ago.
- `end`: The end time for the query as a nanosecond Unix epoch. Defaults to now.
- `since`: A `duration` used to calculate `start` relative to `end`. If `end` is in the future, `start` is calculated as this duration before now. Any value specified for `start` supersedes this parameter.
- `query`: Log stream selector that selects the streams to match and return label values for `<name>`. Example: `{app="myapp", environment="dev"}`

In microservices mode, `/loki/api/v1/label/<name>/values` is exposed by the querier.

**Response format:**

```json
{
  "status": "success",
  "data": [
    <label value>,
    ...
  ]
}
```

### Examples

This example cURL command:

```bash
curl -G -s  "http://localhost:3100/loki/api/v1/label/foo/values" | jq
```

gave this response:

```json
{
  "status": "success",
  "data": [
    "cat",
    "dog",
    "axolotl"
  ]
}
```

---

## Query streams

```http
GET /loki/api/v1/series
POST /loki/api/v1/series
```

This endpoint returns the list of streams (unique set of labels) that match a certain given selector.

**URL query parameters:**

- `match[]=<selector>`: Repeated log stream selector argument that selects the streams to return. At least one `match[]` argument must be provided.
- `start=<nanosecond Unix epoch>`: Start timestamp.
- `end=<nanosecond Unix epoch>`: End timestamp.
- `since`: A `duration` used to calculate `start` relative to `end`. If `end` is in the future, `start` is calculated as this duration before now. Any value specified for `start` supersedes this parameter.

You can URL-encode these parameters directly in the request body by using the POST method and `Content-Type: application/x-www-form-urlencoded` header. This is useful when specifying a large or dynamic number of stream selectors that may breach server-side URL character limits.

In microservices mode, these endpoints are exposed by the querier.

### Examples

This example cURL command:

```bash
curl -s "http://localhost:3100/loki/api/v1/series" \
  --data-urlencode 'match[]={container_name=~"prometheus.*", component="server"}' \
  --data-urlencode 'match[]={app="loki"}' | jq '.'
```

gave this response:

```json
{
  "status": "success",
  "data": [
    {
      "container_name": "loki",
      "app": "loki",
      "stream": "stderr",
      "filename": "/var/log/pods/default_loki-stack-0_50835643-1df0-11ea-ba79-025000000001/loki/0.log",
      "name": "loki",
      "job": "default/loki",
      "controller_revision_hash": "loki-stack-757479754d",
      "statefulset_kubernetes_io_pod_name": "loki-stack-0",
      "release": "loki-stack",
      "namespace": "default",
      "instance": "loki-stack-0"
    },
    {
      "chart": "prometheus-9.3.3",
      "container_name": "prometheus-server-configmap-reload",
      "filename": "/var/log/pods/default_loki-stack-prometheus-server-696cc9ddff-87lmq_507b1db4-1df0-11ea-ba79-025000000001/prometheus-server-configmap-reload/0.log",
      "instance": "loki-stack-prometheus-server-696cc9ddff-87lmq",
      "pod_template_hash": "696cc9ddff",
      "app": "prometheus",
      "component": "server",
      "heritage": "Tiller",
      "job": "default/prometheus",
      "namespace": "default",
      "release": "loki-stack",
      "stream": "stderr"
    },
    {
      "app": "prometheus",
      "component": "server",
      "filename": "/var/log/pods/default_loki-stack-prometheus-server-696cc9ddff-87lmq_507b1db4-1df0-11ea-ba79-025000000001/prometheus-server/0.log",
      "release": "loki-stack",
      "namespace": "default",
      "pod_template_hash": "696cc9ddff",
      "stream": "stderr",
      "chart": "prometheus-9.3.3",
      "container_name": "prometheus-server",
      "heritage": "Tiller",
      "instance": "loki-stack-prometheus-server-696cc9ddff-87lmq",
      "job": "default/prometheus"
    }
  ]
}
```

## Query log statistics

```http
GET /loki/api/v1/index/stats
```

The `/loki/api/v1/index/stats` endpoint can be used to query the index for the number of `streams`, `chunks`, `entries`, and `bytes` that a query resolves to.

**URL query parameters:**

- `query`: The LogQL matchers to check (that is, `{job="foo", env!="dev"}`)
- `start=<nanosecond Unix epoch>`: Start timestamp.
- `end=<nanosecond Unix epoch>`: End timestamp.

You can URL-encode these parameters directly in the request body by using the POST method and `Content-Type: application/x-www-form-urlencoded` header. This is useful when specifying a large or dynamic number of stream selectors that may breach server-side URL character limits.

**Response:**

```json
{
  "streams": 100,
  "chunks": 1000,
  "entries": 5000,
  "bytes": 100000
}
```

It is an approximation with the following caveats:

- It does not include data from the ingesters.
- It is a probabilistic technique.
- Streams/chunks which span multiple period configurations may be counted twice.

These make it generally more helpful for larger queries. It can be used for better understanding the throughput requirements and data topology for a list of matchers over a period of time.

---

## Query log volume

```http
GET /loki/api/v1/index/volume
GET /loki/api/v1/index/volume_range
```

> Note
>
> You must configure `volume_enabled: true` to enable this feature.

The `/loki/api/v1/index/volume` and `/loki/api/v1/index/volume_range` endpoints can be used to query the index for volume information about label and label-value combinations. This is helpful in exploring the logs Loki has ingested to find high or low volume streams. The `volume` endpoint returns results for a single point in time, the time the query was processed. Each datapoint represents an aggregation of the matching label or series over the requested time period, returned in a Prometheus style vector response. The `volume_range` endpoint returns a series of datapoints over a range of time, in Prometheus style matrix response, for each matching set of labels or series. The number of timestamps returned when querying `volume_range` will be determined by the provided `step` parameter and the requested time range.

The `query` should be a valid LogQL stream selector, for example `{job="foo", env=~".+"}`. By default, these endpoints will aggregate into series consisting of all matches for labels included in the query. For example, assuming you have the streams `{job="foo", env="prod", team="alpha"}`, `{job="bar", env="prod", team="beta"}`, `{job="foo", env="dev", team="alpha"}`, and `{job="bar", env="dev", team="beta"}` in your system. The query `{job="foo", env=~".+"}` would return the two metric series `{job="foo", env="dev"}` and `{job="foo", env="prod"}`, each with datapoints representing the accumulate values of chunks for the streams matching that selector, which in this case would be the streams `{job="foo", env="dev", team="alpha"}` and `{job="foo", env="prod", team="alpha"}`, respectively.

There are two parameters which can affect the aggregation strategy. First, a comma-separated list of `targetLabels` can be provided, allowing volumes to be aggregated by the specified `targetLabels` only. This is useful for negations. For example, if you said `{team="alpha", env!="dev"}`, the default behavior would include `env` in the aggregation set. However, maybe you’re looking for all non-dev jobs for team alpha, and you don’t care which env those are in (other than caring that they’re not dev jobs). To achieve this, you could specify `targetLabels=team,job`, resulting in a single metric series (in this case) of `{team="alpha", job="foo"}`.

The other way to change aggregations is with the `aggregateBy` parameter. The default value for this is `series`, which aggregates into combinations of matching key-value pairs. Alternately this can be specified as `labels`, which will aggregate into labels only. In this case, the response will have a metric series with a label name matching each label, and a label value of `""`. This is useful for exploring logs at a high level. For example, if you wanted to know what percentage of your logs had a `team` label, you could query your logs with `aggregateBy=labels` and a query with either an exact or regex match on `team`, or by including `team` in the list of `targetLabels`.

**URL query parameters:**

- `query`: The LogQL matchers to check (that is, `{job="foo", env=~".+"}`). This parameter is required.
- `start=<nanosecond Unix epoch>`: Start timestamp. This parameter is required.
- `end=<nanosecond Unix epoch>`: End timestamp. This parameter is required.
- `limit`: How many metric series to return. The parameter is optional, the default is `100`.
- `step`: Query resolution step width in `duration` format or float number of seconds. `duration` refers to Prometheus duration strings of the form `[0-9]+[smhdwy]`. For example, 5m refers to a duration of 5 minutes. Defaults to a dynamic value based on `start` and `end`. Only applies when querying the `volume_range` endpoint, which will always return a Prometheus style matrix response. This parameter is optional, and only applicable for `query_range`. The default step configured for range queries will be used when not provided.
- `targetLabels`: A comma separated list of labels to aggregate into. This parameter is optional. When not provided, volumes will be aggregated into the matching labels or label-value pairs.
- `aggregateBy`: Whether to aggregate into labels or label-value pairs. This parameter is optional, the default is label-value pairs.

You can URL-encode these parameters directly in the request body by using the POST method and `Content-Type: application/x-www-form-urlencoded` header. This is useful when specifying a large or dynamic number of stream selectors that may breach server-side URL character limits.

## Patterns detection

```http
GET /loki/api/v1/patterns
```

> Note
>
> You must configure
>
> ```yaml
> pattern_ingester:
>   enabled: true
> ```
>
> to enable this feature.

The `/loki/api/v1/patterns` endpoint can be used to query Loki for patterns detected in the logs. This helps understand the structure of the logs Loki has ingested.

The `query` should be a valid LogQL stream selector, for example `{job="foo", env=~".+"}`. The result is aggregated by the `pattern` from all matching streams.

For each pattern detected, the response includes the pattern itself and the number of samples for each pattern at each timestamp.

For example, if you have the following logs:

```
ts=2024-03-30T23:03:40 caller=grpc_logging.go:66 level=info method=/cortex.Ingester/Push duration=200ms msg=gRPC
ts=2024-03-30T23:03:41 caller=grpc_logging.go:66 level=info method=/cortex.Ingester/Push duration=500ms msg=gRPC
```

The pattern detected might be:

```
ts=<_> caller=grpc_logging.go:66 level=info method=/cortex.Ingester/Push duration=<_> msg=gRPC
```

**URL query parameters:**

- `query`: The LogQL matchers to check (that is, `{job="foo", env=~".+"}`). This parameter is required.
- `start=<nanosecond Unix epoch>`: Start timestamp. This parameter is required.
- `end=<nanosecond Unix epoch>`: End timestamp. This parameter is required.
- `step=<duration string or float number of seconds>`: Step between samples for occurrences of this pattern. This parameter is optional.

### Examples

This example cURL command:

```bash
curl -s "http://localhost:3100/loki/api/v1/patterns" \
  --data-urlencode 'query={app="loki"}' | jq
```

gave this response:

```json
{
  "status": "success",
  "data": [
    {
      "pattern": "<_> caller=grpc_logging.go:66 <_> level=error method=/cortex.Ingester/Push <_> msg=gRPC err=\"connection refused to object store\"",
      "samples": [
        [1711839260, 1],
        [1711839270, 2],
        [1711839280, 1]
      ]
    },
    {
      "pattern": "<_> caller=grpc_logging.go:66 <_> level=info method=/cortex.Ingester/Push <_> msg=gRPC",
      "samples": [
        [1711839260, 105],
        [1711839270, 222],
        [1711839280, 196]
      ]
    }
  ]
}
```

The result is a list of patterns detected in the logs, with the number of samples for each pattern at each timestamp. The pattern format is the same as the LogQL pattern filter and parser and can be used in queries for filtering matching logs. Each sample is a tuple of timestamp (second) and count.

---

## Stream logs

```http
GET /loki/api/v1/tail
```

`/loki/api/v1/tail` is a WebSocket endpoint that streams log messages based on a query to the client. It accepts the following query parameters in the URL:

- `query`: The LogQL query to perform.
- `delay_for`: The number of seconds to delay retrieving logs to let slow loggers catch up. Defaults to 0 and cannot be larger than 5.
- `limit`: The max number of entries to return. It defaults to `100`.
- `start`: The start time for the query as a nanosecond Unix epoch. Defaults to one hour ago.

In microservices mode, `/loki/api/v1/tail` is exposed by the querier.

**Response format (streamed):**

```json
{
  "streams": [
    {
      "stream": {
        <label key-value pairs>
      },
      "values": [
        [<string: nanosecond unix epoch>, <string: log line>]
      ]
    }
  ],
  "dropped_entries": [
    {
      "labels": {
        <label key-value pairs>
      },
      "timestamp": "<nanosecond unix epoch>"
    }
  ]
}
```