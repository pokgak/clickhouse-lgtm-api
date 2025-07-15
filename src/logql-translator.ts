export interface LogQLQuery {
  query: string;
  start?: string;
  end?: string;
  limit?: number;
  direction?: 'forward' | 'backward';
}

export interface ClickHouseQuery {
  sql: string;
  params: Record<string, any>;
}

export class LogQLTranslator {
  private logsTable: string;

  constructor(logsTable: string = 'otel_logs') {
    this.logsTable = logsTable;
  }

  translateQuery(logql: LogQLQuery): ClickHouseQuery {
    const { query, start, end, limit = 100, direction = 'backward' } = logql;
    
    let sql = `
      SELECT 
        Timestamp,
        TraceId,
        SpanId,
        TraceFlags,
        SeverityText,
        SeverityNumber,
        ServiceName,
        Body,
        ResourceSchemaUrl,
        ResourceAttributes,
        ScopeSchemaUrl,
        ScopeName,
        ScopeVersion,
        ScopeAttributes,
        LogAttributes
      FROM ${this.logsTable}
    `;
    const params: Record<string, any> = {};
    const conditions: string[] = [];

    if (start) {
      conditions.push('Timestamp >= {start:DateTime64}');
      params.start = new Date(start).toISOString();
    }

    if (end) {
      conditions.push('Timestamp <= {end:DateTime64}');
      params.end = new Date(end).toISOString();
    }

    const labelFilters = this.parseLogQLLabels(query);
    if (labelFilters.length > 0) {
      labelFilters.forEach((filter, index) => {
        const paramKey = `label_${index}`;
        
        if (filter.key === 'service_name' || filter.key === 'service') {
          if (filter.operator === '=') {
            conditions.push(`ServiceName = {${paramKey}:String}`);
            params[paramKey] = filter.value;
          } else if (filter.operator === '!=') {
            conditions.push(`ServiceName != {${paramKey}:String}`);
            params[paramKey] = filter.value;
          } else if (filter.operator === '=~') {
            conditions.push(`match(ServiceName, {${paramKey}:String})`);
            params[paramKey] = filter.value;
          }
        } else if (filter.key === 'severity' || filter.key === 'level') {
          if (filter.operator === '=') {
            conditions.push(`SeverityText = {${paramKey}:String}`);
            params[paramKey] = filter.value;
          } else if (filter.operator === '!=') {
            conditions.push(`SeverityText != {${paramKey}:String}`);
            params[paramKey] = filter.value;
          }
        } else if (filter.key === 'trace_id') {
          if (filter.operator === '=') {
            conditions.push(`TraceId = {${paramKey}:String}`);
            params[paramKey] = filter.value;
          }
        } else {
          // Check in ResourceAttributes and LogAttributes (JSON type)
          if (filter.operator === '=') {
            conditions.push(`(JSONExtractString(ResourceAttributes, {labelKey_${index}:String}) = {${paramKey}:String} OR JSONExtractString(LogAttributes, {labelKey_${index}:String}) = {${paramKey}:String})`);
            params[`labelKey_${index}`] = filter.key;
            params[paramKey] = filter.value;
          } else if (filter.operator === '!=') {
            conditions.push(`(JSONExtractString(ResourceAttributes, {labelKey_${index}:String}) != {${paramKey}:String} AND JSONExtractString(LogAttributes, {labelKey_${index}:String}) != {${paramKey}:String})`);
            params[`labelKey_${index}`] = filter.key;
            params[paramKey] = filter.value;
          } else if (filter.operator === '=~') {
            conditions.push(`(match(JSONExtractString(ResourceAttributes, {labelKey_${index}:String}), {${paramKey}:String}) OR match(JSONExtractString(LogAttributes, {labelKey_${index}:String}), {${paramKey}:String}))`);
            params[`labelKey_${index}`] = filter.key;
            params[paramKey] = filter.value;
          }
        }
      });
    }

    const textFilter = this.parseLogQLText(query);
    if (textFilter) {
      conditions.push(`positionCaseInsensitive(Body, {textFilter:String}) > 0`);
      params.textFilter = textFilter;
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY Timestamp ${direction === 'forward' ? 'ASC' : 'DESC'}`;
    sql += ` LIMIT {limit:UInt32}`;
    params.limit = limit;

    return { sql, params };
  }

  private parseLogQLLabels(query: string): Array<{key: string, operator: string, value: string}> {
    const labelRegex = /(\w+)(=|!=|=~|!~)"([^"]+)"/g;
    const filters: Array<{key: string, operator: string, value: string}> = [];
    let match;

    while ((match = labelRegex.exec(query)) !== null) {
      filters.push({
        key: match[1],
        operator: match[2],
        value: match[3]
      });
    }

    return filters;
  }

  private parseLogQLText(query: string): string | null {
    const textMatch = query.match(/\|=\s*"([^"]+)"/);
    if (textMatch) {
      return textMatch[1];
    }

    const containsMatch = query.match(/\|~\s*"([^"]+)"/);
    if (containsMatch) {
      return containsMatch[1];
    }

    return null;
  }

  translateLabelsQuery(): ClickHouseQuery {
    const sql = `
      SELECT DISTINCT label FROM (
        SELECT 'service_name' as label
        UNION ALL SELECT 'severity'
        UNION ALL SELECT 'trace_id'
        UNION ALL SELECT 'span_id'
        UNION ALL SELECT arrayJoin(JSONExtractKeys(ResourceAttributes))
        UNION ALL SELECT arrayJoin(JSONExtractKeys(LogAttributes))
      )
      WHERE label != ''
      ORDER BY label
    `;
    return { sql, params: {} };
  }

  translateLabelValuesQuery(labelName: string): ClickHouseQuery {
    let sql: string;
    const params: Record<string, any> = { labelName };

    if (labelName === 'service_name' || labelName === 'service') {
      sql = `
        SELECT DISTINCT ServiceName as value
        FROM ${this.logsTable}
        WHERE ServiceName != ''
        ORDER BY value
      `;
    } else if (labelName === 'severity' || labelName === 'level') {
      sql = `
        SELECT DISTINCT SeverityText as value
        FROM ${this.logsTable}
        WHERE SeverityText != ''
        ORDER BY value
      `;
    } else if (labelName === 'trace_id') {
      sql = `
        SELECT DISTINCT TraceId as value
        FROM ${this.logsTable}
        WHERE TraceId != ''
        ORDER BY value
        LIMIT 1000
      `;
    } else if (labelName === 'span_id') {
      sql = `
        SELECT DISTINCT SpanId as value
        FROM ${this.logsTable}
        WHERE SpanId != ''
        ORDER BY value
        LIMIT 1000
      `;
    } else {
      sql = `
        SELECT DISTINCT value FROM (
          SELECT JSONExtractString(ResourceAttributes, {labelName:String}) as value
          FROM ${this.logsTable}
          WHERE JSONExtractString(ResourceAttributes, {labelName:String}) != ''
          UNION ALL
          SELECT JSONExtractString(LogAttributes, {labelName:String}) as value
          FROM ${this.logsTable}
          WHERE JSONExtractString(LogAttributes, {labelName:String}) != ''
        )
        WHERE value != ''
        ORDER BY value
      `;
    }

    return { sql, params };
  }

  translateSeriesQuery(match?: string[], start?: string, end?: string): ClickHouseQuery {
    let sql = `
      SELECT DISTINCT
        ServiceName,
        SeverityText,
        ResourceAttributes,
        LogAttributes
      FROM ${this.logsTable}
    `;
    
    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (start) {
      conditions.push('Timestamp >= {start:DateTime64}');
      params.start = new Date(start).toISOString();
    }

    if (end) {
      conditions.push('Timestamp <= {end:DateTime64}');
      params.end = new Date(end).toISOString();
    }

    if (match && match.length > 0) {
      match.forEach((matcher, index) => {
        const labelFilters = this.parseLogQLLabels(matcher);
        labelFilters.forEach((filter, filterIndex) => {
          const paramKey = `match_${index}_${filterIndex}`;
          
          if (filter.key === 'service_name' || filter.key === 'service') {
            if (filter.operator === '=') {
              conditions.push(`ServiceName = {${paramKey}:String}`);
              params[paramKey] = filter.value;
            }
          } else if (filter.key === 'severity' || filter.key === 'level') {
            if (filter.operator === '=') {
              conditions.push(`SeverityText = {${paramKey}:String}`);
              params[paramKey] = filter.value;
            }
          } else {
            if (filter.operator === '=') {
              conditions.push(`(JSONExtractString(ResourceAttributes, {labelKey_${paramKey}:String}) = {${paramKey}:String} OR JSONExtractString(LogAttributes, {labelKey_${paramKey}:String}) = {${paramKey}:String})`);
              params[`labelKey_${paramKey}`] = filter.key;
              params[paramKey] = filter.value;
            }
          }
        });
      });
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY ServiceName, SeverityText';

    return { sql, params };
  }
}