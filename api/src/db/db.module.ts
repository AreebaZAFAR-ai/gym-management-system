import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import * as schema from './schema';

/** Drizzle database. Typed on the shared Postgres base so tests can swap in PGlite. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const PG_POOL = 'PG_POOL';
export const DB = 'DB';

/** Anything with end(); the real pg Pool, or a stub in tests. */
type Closable = { end(): Promise<void> };

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      // Neon pooled connection (PgBouncer, transaction mode). Drizzle does not
      // use named prepared statements, so it is safe behind the pooler.
      useFactory: (env: Env) =>
        new Pool({
          connectionString: env.DATABASE_URL,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Closable) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
