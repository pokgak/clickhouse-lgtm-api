import { createClient, ClickHouseClient } from '@clickhouse/client';

export interface ClickHouseConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

export class ClickHouseAdapter {
  private client: ClickHouseClient;

  constructor(config: ClickHouseConfig) {
    this.client = createClient({
      host: `http://${config.host}:${config.port || 8123}`,
      username: config.username || 'default',
      password: config.password || '',
      database: config.database || 'default',
    });
  }

  async query<T = any>(sql: string, params?: Record<string, any>): Promise<T[]> {
    const result = await this.client.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });
    
    return result.json<T[]>();
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export const createClickHouseAdapter = (config: ClickHouseConfig): ClickHouseAdapter => {
  return new ClickHouseAdapter(config);
};