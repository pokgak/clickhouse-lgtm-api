import { Limits, LimitsConfig, QueryLimiter } from './types';

export class DefaultLimits implements Limits {
  private config: LimitsConfig;

  constructor(config: LimitsConfig = {}) {
    this.config = {
      maxQuerySeries: 500,
      maxEntriesLimitPerQuery: 1000,
      maxQueryLookback: 0, // 0 = unlimited
      maxQueryLength: 0, // 0 = unlimited
      maxQueryParallelism: 32,
      maxQueryBytesRead: 0, // 0 = unlimited
      maxQuerierBytesRead: 150 * 1024 * 1024 * 1024, // 150GB default
      requiredLabels: [],
      requiredNumberLabels: 0,
      ...config
    };
  }

  MaxQuerySeries(ctx: any, userID: string): number {
    return this.config.maxQuerySeries || 0;
  }

  MaxEntriesLimitPerQuery(ctx: any, userID: string): number {
    return this.config.maxEntriesLimitPerQuery || 0;
  }

  MaxQueryLookback(ctx: any, userID: string): number {
    return this.config.maxQueryLookback || 0;
  }

  MaxQueryLength(ctx: any, userID: string): number {
    return this.config.maxQueryLength || 0;
  }

  MaxQueryParallelism(ctx: any, userID: string): number {
    return this.config.maxQueryParallelism || 0;
  }

  MaxQueryBytesRead(ctx: any, userID: string): number {
    return this.config.maxQueryBytesRead || 0;
  }

  MaxQuerierBytesRead(ctx: any, userID: string): number {
    return this.config.maxQuerierBytesRead || 0;
  }

  RequiredLabels(ctx: any, userID: string): string[] {
    return this.config.requiredLabels || [];
  }

  RequiredNumberLabels(ctx: any, userID: string): number {
    return this.config.requiredNumberLabels || 0;
  }
}

export class QueryLimiterImpl implements QueryLimiter {
  private uniqueSeries: Set<string> = new Set();
  private chunkBytesCount: number = 0;
  private chunkCount: number = 0;
  private maxSeriesPerQuery: number;
  private maxChunkBytesPerQuery: number;
  private maxChunksPerQuery: number;

  constructor(
    maxSeriesPerQuery: number = 0,
    maxChunkBytesPerQuery: number = 0,
    maxChunksPerQuery: number = 0
  ) {
    this.maxSeriesPerQuery = maxSeriesPerQuery;
    this.maxChunkBytesPerQuery = maxChunkBytesPerQuery;
    this.maxChunksPerQuery = maxChunksPerQuery;
  }

  AddSeries(series: any): boolean {
    const seriesKey = this.getSeriesKey(series);
    if (this.uniqueSeries.has(seriesKey)) {
      return false; // Already exists, no limit exceeded
    }

    if (this.maxSeriesPerQuery > 0 && this.uniqueSeries.size >= this.maxSeriesPerQuery) {
      return true; // Limit exceeded
    }

    this.uniqueSeries.add(seriesKey);
    return false;
  }

  AddChunkBytes(bytes: number): boolean {
    this.chunkBytesCount += bytes;

    if (this.maxChunkBytesPerQuery > 0 && this.chunkBytesCount > this.maxChunkBytesPerQuery) {
      return true; // Limit exceeded
    }

    return false;
  }

  AddChunk(): boolean {
    this.chunkCount++;

    if (this.maxChunksPerQuery > 0 && this.chunkCount > this.maxChunksPerQuery) {
      return true; // Limit exceeded
    }

    return false;
  }

  GetStats(): { seriesCount: number; chunkBytesCount: number; chunkCount: number } {
    return {
      seriesCount: this.uniqueSeries.size,
      chunkBytesCount: this.chunkBytesCount,
      chunkCount: this.chunkCount
    };
  }

  private getSeriesKey(series: any): string {
    // Create a unique key for the series based on its labels
    if (series.labels) {
      return Object.entries(series.labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
    }
    return JSON.stringify(series);
  }
}

export class LimitsMiddleware {
  private limits: Limits;

  constructor(limits: Limits) {
    this.limits = limits;
  }

  validateQuery(ctx: any, userID: string, query: string, start: number, end: number): string | null {
    // Check required labels
    const requiredLabels = this.limits.RequiredLabels(ctx, userID);
    if (requiredLabels.length > 0) {
      const missingLabels = this.checkRequiredLabels(query, requiredLabels);
      if (missingLabels.length > 0) {
        return `stream selector is missing required matchers [${missingLabels.join(', ')}]`;
      }
    }

    // Check required number of labels
    const requiredNumberLabels = this.limits.RequiredNumberLabels(ctx, userID);
    if (requiredNumberLabels > 0) {
      const labelCount = this.countLabelsInQuery(query);
      if (labelCount < requiredNumberLabels) {
        return `stream selector has less label matchers than required: (present: ${labelCount}, required_number_label_matchers: ${requiredNumberLabels})`;
      }
    }

    // Check query length
    const maxQueryLength = this.limits.MaxQueryLength(ctx, userID);
    if (maxQueryLength > 0) {
      const queryLength = end - start;
      if (queryLength > maxQueryLength) {
        return `query length (${queryLength}ms) exceeds limit (${maxQueryLength}ms)`;
      }
    }

    // Check query lookback
    const maxQueryLookback = this.limits.MaxQueryLookback(ctx, userID);
    if (maxQueryLookback > 0) {
      const now = Date.now();
      const minStartTime = now - maxQueryLookback;
      if (start < minStartTime) {
        return `query start time (${start}) is before allowed lookback period (${minStartTime})`;
      }
    }

    return null;
  }

  private checkRequiredLabels(query: string, requiredLabels: string[]): string[] {
    const missingLabels: string[] = [];
    for (const label of requiredLabels) {
      if (!query.includes(`${label}=`)) {
        missingLabels.push(label);
      }
    }
    return missingLabels;
  }

  private countLabelsInQuery(query: string): number {
    // Simple regex to count label matchers in the query
    const labelMatches = query.match(/[a-zA-Z_][a-zA-Z0-9_]*\s*=/g);
    return labelMatches ? labelMatches.length : 0;
  }

  createQueryLimiter(ctx: any, userID: string): QueryLimiter {
    const maxSeries = this.limits.MaxQuerySeries(ctx, userID);
    const maxEntries = this.limits.MaxEntriesLimitPerQuery(ctx, userID);

    return new QueryLimiterImpl(
      maxSeries,
      0, // maxChunkBytesPerQuery - not implemented yet
      maxEntries
    );
  }
}

// Utility function to format bytes in human readable format
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
}