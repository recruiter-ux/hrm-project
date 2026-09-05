-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PROBATION', 'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "WorkLocationType" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "AssignmentChangeReason" AS ENUM ('HIRE', 'PROMOTION', 'DEMOTION', 'LATERAL_MOVE', 'DEPARTMENT_TRANSFER', 'MANAGER_CHANGE', 'EMPLOYMENT_TYPE_CHANGE', 'WORK_LOCATION_CHANGE', 'REORGANISATION', 'TERMINATION', 'DATA_CORRECTION');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'OFFER_LETTER', 'NATIONAL_ID', 'PASSPORT', 'VISA', 'WORK_PERMIT', 'EDUCATION_CERTIFICATE', 'PROFESSIONAL_CERTIFICATION', 'RESUME', 'TAX_FORM', 'BANK_DETAILS', 'MEDICAL', 'PERFORMANCE_REVIEW', 'DISCIPLINARY', 'OTHER');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT', 'GLOBAL');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "work_email" TEXT NOT NULL,
    "personal_email" TEXT,
    "phone_number" TEXT,
    "date_of_birth" DATE,
    "national_id" TEXT,
    "role_id" TEXT,
    "working_title" TEXT,
    "department_id" TEXT,
    "manager_id" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "work_location_type" "WorkLocationType" NOT NULL DEFAULT 'ONSITE',
    "status" "EmploymentStatus" NOT NULL DEFAULT 'PROBATION',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "hired_at" DATE NOT NULL,
    "probation_ends_at" DATE,
    "terminated_at" DATE,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_assignments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "manager_id" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "work_location_type" "WorkLocationType" NOT NULL DEFAULT 'ONSITE',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" "AssignmentChangeReason" NOT NULL DEFAULT 'HIRE',
    "notes" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "job_family" TEXT,
    "level" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" TEXT,
    "head_employee_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL DEFAULT 'core_hr',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_role_permissions" (
    "id" TEXT NOT NULL,
    "access_role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'SELF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_access_roles" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "access_role_id" TEXT NOT NULL,
    "granted_by_id" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "employee_access_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "is_confidential" BOOLEAN NOT NULL DEFAULT false,
    "issued_at" DATE,
    "expires_at" DATE,
    "uploaded_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_number_key" ON "employees"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_work_email_key" ON "employees"("work_email");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

-- CreateIndex
CREATE INDEX "employees_role_id_idx" ON "employees"("role_id");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_deleted_at_idx" ON "employees"("deleted_at");

-- CreateIndex
CREATE INDEX "employees_last_name_first_name_idx" ON "employees"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "employment_assignments_employee_id_effective_to_idx" ON "employment_assignments"("employee_id", "effective_to");

-- CreateIndex
CREATE INDEX "employment_assignments_department_id_effective_from_idx" ON "employment_assignments"("department_id", "effective_from");

-- CreateIndex
CREATE INDEX "employment_assignments_manager_id_idx" ON "employment_assignments"("manager_id");

-- CreateIndex
CREATE INDEX "employment_assignments_role_id_idx" ON "employment_assignments"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "employment_assignments_employee_id_effective_from_key" ON "employment_assignments"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "roles_job_family_idx" ON "roles"("job_family");

-- CreateIndex
CREATE INDEX "roles_is_active_idx" ON "roles"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");

-- CreateIndex
CREATE INDEX "departments_is_active_idx" ON "departments"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "access_roles_key_key" ON "access_roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_key" ON "permissions"("resource", "action");

-- CreateIndex
CREATE INDEX "access_role_permissions_permission_id_idx" ON "access_role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_role_permissions_access_role_id_permission_id_key" ON "access_role_permissions"("access_role_id", "permission_id");

-- CreateIndex
CREATE INDEX "employee_access_roles_access_role_id_idx" ON "employee_access_roles"("access_role_id");

-- CreateIndex
CREATE INDEX "employee_access_roles_expires_at_idx" ON "employee_access_roles"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "employee_access_roles_employee_id_access_role_id_key" ON "employee_access_roles"("employee_id", "access_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_employee_id_type_idx" ON "documents"("employee_id", "type");

-- CreateIndex
CREATE INDEX "documents_expires_at_idx" ON "documents"("expires_at");

-- CreateIndex
CREATE INDEX "documents_deleted_at_idx" ON "documents"("deleted_at");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_permissions" ADD CONSTRAINT "access_role_permissions_access_role_id_fkey" FOREIGN KEY ("access_role_id") REFERENCES "access_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_permissions" ADD CONSTRAINT "access_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_roles" ADD CONSTRAINT "employee_access_roles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_roles" ADD CONSTRAINT "employee_access_roles_access_role_id_fkey" FOREIGN KEY ("access_role_id") REFERENCES "access_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_roles" ADD CONSTRAINT "employee_access_roles_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- HAND-WRITTEN ADDITION (not generated by Prisma)
--
-- Enforces "an employee may have at most one OPEN employment assignment".
-- An open assignment is one with effective_to IS NULL, meaning "current".
--
-- Prisma has no syntax for a partial (filtered) unique index, so this must be
-- maintained by hand. If you ever regenerate this migration from scratch,
-- re-add this block. See PROJECT_NOTES.md section 4.
--
-- Without it, a bug can leave someone with two current jobs and every
-- headcount report silently double-counts them.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "employment_assignments_one_current_per_employee"
  ON "employment_assignments" ("employee_id")
  WHERE "effective_to" IS NULL;
