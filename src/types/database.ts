export interface DatabaseConfig {
  url: string;
  maxConnections: number;
  connectionTimeout: number;
  queryTimeout: number;
  ssl: boolean;
}

export interface AuditLogData {
  id: string;
  eventType: string;
  userId?: string;
  userRole?: string;
  targetUserId?: string;
  patientId?: string;
  resourceType?: string;
  resourceId?: string;
  action: string;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  severityLevel: string;
  metadata?: Record<string, any>;
  success: boolean;
  errorMessage?: string;
  hipaaCompliant: boolean;
  accessReason?: string;
  checksum?: string;
  createdAt: Date;
}

export interface SystemPolicyData {
  id: string;
  name: string;
  category: string;
  description?: string;
  value: Record<string, any>;
  isActive: boolean;
  version: number;
  createdBy: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackupOperationData {
  id: string;
  type: string;
  status: string;
  filePath?: string;
  fileName?: string;
  fileSize?: bigint;
  checksum?: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  errorMessage?: string;
  retryCount: number;
  createdBy: string;
  metadata?: Record<string, any>;
  expiresAt?: Date;
}

export interface UserSessionData {
  id: string;
  userId: string;
  userRole: string;
  sessionToken: string;
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  isActive: boolean;
  lastActivity: Date;
  expiresAt: Date;
  is2FAVerified: boolean;
  riskScore?: number;
  createdAt: Date;
  terminatedAt?: Date;
  terminationReason?: string;
}

export interface SystemAlertData {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  source: string;
  isResolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolution?: string;
  escalated: boolean;
  escalatedAt?: Date;
  escalatedTo?: string;
  metadata?: Record<string, any>;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ComplianceEventData {
  id: string;
  auditLogId: string;
  standard: string;
  requirement: string;
  status: string;
  riskLevel: string;
  riskDescription?: string;
  remediationRequired: boolean;
  remediationPlan?: string;
  remediationDueDate?: Date;
  remediationStatus?: string;
  reportedToAuthority: boolean;
  reportedAt?: Date;
  reportReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogFilters {
  eventType?: string;
  userId?: string;
  patientId?: string;
  resourceType?: string;
  severityLevel?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  hipaaCompliant?: boolean;
  page?: number;
  limit?: number;
}

export interface SystemAlertFilters {
  type?: string;
  severity?: string;
  isResolved?: boolean;
  source?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ComplianceReport {
  reportDate: Date;
  eventType: string;
  userRole: string;
  eventCount: number;
  hipaaCompliantCount: number;
  highSeverityCount: number;
  failedEventsCount: number;
}

export interface SystemHealthMetrics {
  id: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  activeUsers?: number;
  requestCount?: number;
  errorCount?: number;
  responseTime?: number;
  dbConnections?: number;
  dbQueryTime?: number;
  customMetrics?: Record<string, any>;
  recordedAt: Date;
}

export interface EventProcessingStatusData {
  id: string;
  eventId: string;
  eventType: string;
  source: string;
  status: string;
  processedAt?: Date;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  lastError?: Date;
  sentToDLQ: boolean;
  dlqReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
