import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Marked @Global so feature modules can inject PrismaService without each one
 * having to import PrismaModule. Database access is needed nearly everywhere,
 * so this saves a line of boilerplate in every future module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
