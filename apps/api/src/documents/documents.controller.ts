import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import type { AuthenticatedUser, ResolvedPermission } from '../auth/auth.types';
import { CurrentUser, Scope } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

/**
 * Documents live under the employee they belong to:
 *   GET    /api/employees/:employeeId/documents
 *   POST   /api/employees/:employeeId/documents
 *   GET    /api/documents/:id/download
 *   DELETE /api/documents/:id
 */
@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly config: ConfigService,
  ) {}

  @Get('employees/:employeeId/documents')
  @RequirePermission('document:read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('employeeId') employeeId: string,
  ) {
    return this.documents.listForEmployee(user.employeeId, permission.scope, employeeId);
  }

  /**
   * Files are buffered in memory rather than streamed to disk so the checksum
   * can be computed before anything is written. Fine at a 10MB cap; revisit if
   * the limit ever rises substantially.
   */
  @Post('employees/:employeeId/documents')
  @RequirePermission('document:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        // Falls back to 10MB if MAX_UPLOAD_BYTES is unset. Interceptor options
        // are evaluated at class-definition time, so ConfigService is not
        // available here — hence reading the env var directly, one of the very
        // few places that is justified.
        fileSize: parseInt(process.env.MAX_UPLOAD_BYTES ?? '10485760', 10),
        files: 1,
      },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(user.employeeId, permission.scope, employeeId, file, dto);
  }

  @Get('documents/:id/download')
  @RequirePermission('document:read')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { document, stream } = await this.documents.getForDownload(
      user.employeeId,
      permission.scope,
      id,
    );

    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', document.sizeBytes);
    // `attachment` forces a download rather than rendering in the tab, which
    // stops an uploaded HTML or SVG file executing scripts on our origin.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.originalFilename)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.pipe(res);
  }

  @Delete('documents/:id')
  @RequirePermission('document:upload')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() permission: ResolvedPermission,
    @Param('id') id: string,
  ) {
    return this.documents.archive(user.employeeId, permission.scope, id);
  }
}
