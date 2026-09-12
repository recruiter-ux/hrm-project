import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType, PermissionScope } from '@prisma/client';

import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { UploadDocumentDto } from './dto/upload-document.dto';

/**
 * File types we accept. An allowlist, not a blocklist — anything not named
 * here is refused, so a new dangerous type cannot slip through by default.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

const DOCUMENT_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  checksum: true,
  isConfidential: true,
  issuedAt: true,
  expiresAt: true,
  createdAt: true,
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Two permission checks happen for every document operation:
   *   1. may the caller see this EMPLOYEE at all? (scope)
   *   2. if the document is confidential, do they hold document:read_confidential?
   *
   * The first stops a manager reading another team's files. The second stops
   * an ordinary manager reading medical or disciplinary records about their
   * own team.
   */
  private async assertEmployeeVisible(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    employeeId: string,
  ): Promise<void> {
    const allowed = await this.permissions.canAccessEmployee(callerEmployeeId, scope, employeeId);
    if (!allowed) throw new NotFoundException('Employee not found.');
  }

  async listForEmployee(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    employeeId: string,
  ) {
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    const canSeeConfidential = await this.permissions.resolveScope(
      callerEmployeeId,
      'document:read_confidential',
    );

    return this.prisma.document.findMany({
      where: {
        employeeId,
        deletedAt: null,
        // Confidential files are filtered out entirely rather than shown as
        // locked rows — their existence alone can be sensitive.
        ...(canSeeConfidential ? {} : { isConfidential: false }),
      },
      select: DOCUMENT_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async upload(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    employeeId: string,
    file: Express.Multer.File,
    dto: UploadDocumentDto,
  ) {
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    if (!file) throw new BadRequestException('No file was uploaded.');

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Files of type "${file.mimetype}" are not accepted. Allowed: PDF, images, Word, Excel, CSV, and plain text.`,
      );
    }

    const stored = await this.storage.save(file.buffer, file.originalname);

    return this.prisma.document.create({
      data: {
        employeeId,
        type: dto.type ?? DocumentType.OTHER,
        title: dto.title?.trim() || file.originalname,
        description: dto.description ?? null,
        storageKey: stored.storageKey,
        originalFilename: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        isConfidential: dto.isConfidential ?? false,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        uploadedById: callerEmployeeId,
      },
      select: DOCUMENT_SELECT,
    });
  }

  /**
   * Resolves a document for download, after checking both the employee scope
   * and the confidential flag. Returns the metadata plus a read stream.
   */
  async getForDownload(callerEmployeeId: string | null, scope: PermissionScope, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: {
        id: true,
        employeeId: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        isConfidential: true,
      },
    });

    if (!document) throw new NotFoundException('Document not found.');

    await this.assertEmployeeVisible(callerEmployeeId, scope, document.employeeId);

    if (document.isConfidential) {
      const canSeeConfidential = await this.permissions.resolveScope(
        callerEmployeeId,
        'document:read_confidential',
      );
      if (!canSeeConfidential) {
        throw new ForbiddenException('This document is marked confidential.');
      }
    }

    return { document, stream: this.storage.createReadStream(document.storageKey) };
  }

  /** Soft delete, matching how employee records are handled. */
  async archive(callerEmployeeId: string | null, scope: PermissionScope, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true, employeeId: true },
    });
    if (!document) throw new NotFoundException('Document not found.');

    await this.assertEmployeeVisible(callerEmployeeId, scope, document.employeeId);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    return { archived: true };
  }
}
