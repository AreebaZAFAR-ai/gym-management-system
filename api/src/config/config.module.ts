import { Global, Module } from '@nestjs/common';
import { parseEnv } from './env';

/** Injection token for the validated environment (type: Env). */
export const ENV = 'ENV';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
