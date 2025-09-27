-- CreateEnum
CREATE TYPE "public"."EventType" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'PATIENT_CREATED', 'PATIENT_UPDATED', 'PATIENT_ACCESSED', 'EHR_CREATED', 'EHR_UPDATED', 'EHR_ACCESSED', 'DOCUMENT_UPLOADED', 'DOCUMENT_ACCESSED', 'APPOINTMENT_CREATED', 'APPOINTMENT_UPDATED', 'APPOINTMENT_CANCELLED', 'PRESCRIPTION_CREATED', 'PRESCRIPTION_UPDATED', 'ORDER_PLACED', 'WORKFLOW_STEP_COMPLETED', 'INVENTORY_UPDATED', 'INVOICE_CREATED', 'BACKUP_CREATED', 'BACKUP_RESTORED', 'POLICY_UPDATED', 'MAINTENANCE_SCHEDULED', 'SYSTEM_ERROR', 'SECURITY_VIOLATION');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'PATIENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."SeverityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."ActionType" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS');

-- CreateEnum
CREATE TYPE "public"."ResourceType" AS ENUM ('PATIENT_RECORD', 'APPOINTMENT', 'PRESCRIPTION', 'BILLING_INFO', 'USER_ACCOUNT', 'SYSTEM_CONFIG');

-- CreateEnum
CREATE TYPE "public"."PolicyCategory" AS ENUM ('SECURITY', 'RETENTION', 'BACKUP', 'SESSION');

-- CreateEnum
CREATE TYPE "public"."BackupType" AS ENUM ('FULL', 'INCREMENTAL', 'DIFFERENTIAL');

-- CreateEnum
CREATE TYPE "public"."OperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "public"."DataType" AS ENUM ('AUDIT_LOGS', 'PATIENT_DATA', 'SYSTEM_LOGS', 'BACKUPS');

-- CreateEnum
CREATE TYPE "public"."AlertType" AS ENUM ('SECURITY', 'PERFORMANCE', 'MAINTENANCE', 'ERROR');

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "eventType" "public"."EventType" NOT NULL,
    "userId" TEXT,
    "userRole" "public"."UserRole",
    "targetUserId" TEXT,
    "patientId" TEXT,
    "resourceType" "public"."ResourceType",
    "resourceId" TEXT,
    "action" "public"."ActionType" NOT NULL,
    "description" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    "riskLevel" "public"."SeverityLevel" NOT NULL DEFAULT 'LOW',
    "metadata" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "public"."PolicyCategory" NOT NULL,
    "description" TEXT,
    "value" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."backup_operations" (
    "id" TEXT NOT NULL,
    "type" "public"."BackupType" NOT NULL,
    "status" "public"."OperationStatus" NOT NULL,
    "filePath" TEXT,
    "fileSize" BIGINT,
    "checksum" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "backup_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."maintenance_windows" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "public"."OperationStatus" NOT NULL,
    "affectedServices" TEXT[],
    "createdBy" TEXT NOT NULL,
    "notificationSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_retention" (
    "id" TEXT NOT NULL,
    "dataType" "public"."DataType" NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "lastCleanup" TIMESTAMP(3),
    "recordsDeleted" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_retention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_alerts" (
    "id" TEXT NOT NULL,
    "type" "public"."AlertType" NOT NULL,
    "severity" "public"."SeverityLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_eventType_idx" ON "public"."audit_logs"("eventType");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "public"."audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_patientId_idx" ON "public"."audit_logs"("patientId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "public"."audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_riskLevel_idx" ON "public"."audit_logs"("riskLevel");

-- CreateIndex
CREATE UNIQUE INDEX "system_policies_name_key" ON "public"."system_policies"("name");

-- CreateIndex
CREATE INDEX "system_policies_category_idx" ON "public"."system_policies"("category");

-- CreateIndex
CREATE INDEX "system_policies_isActive_idx" ON "public"."system_policies"("isActive");

-- CreateIndex
CREATE INDEX "backup_operations_status_idx" ON "public"."backup_operations"("status");

-- CreateIndex
CREATE INDEX "backup_operations_startedAt_idx" ON "public"."backup_operations"("startedAt");

-- CreateIndex
CREATE INDEX "backup_operations_type_idx" ON "public"."backup_operations"("type");

-- CreateIndex
CREATE INDEX "maintenance_windows_status_idx" ON "public"."maintenance_windows"("status");

-- CreateIndex
CREATE INDEX "maintenance_windows_startTime_idx" ON "public"."maintenance_windows"("startTime");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_sessionToken_key" ON "public"."user_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "public"."user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_sessionToken_idx" ON "public"."user_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "user_sessions_isActive_idx" ON "public"."user_sessions"("isActive");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "public"."user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "data_retention_dataType_idx" ON "public"."data_retention"("dataType");

-- CreateIndex
CREATE INDEX "data_retention_isActive_idx" ON "public"."data_retention"("isActive");

-- CreateIndex
CREATE INDEX "system_alerts_type_idx" ON "public"."system_alerts"("type");

-- CreateIndex
CREATE INDEX "system_alerts_severity_idx" ON "public"."system_alerts"("severity");

-- CreateIndex
CREATE INDEX "system_alerts_isResolved_idx" ON "public"."system_alerts"("isResolved");

-- CreateIndex
CREATE INDEX "system_alerts_createdAt_idx" ON "public"."system_alerts"("createdAt");
