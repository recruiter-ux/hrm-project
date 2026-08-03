import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

// PrismaModule and RedisModule are @Global, so no imports are needed here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
