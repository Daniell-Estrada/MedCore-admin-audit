import { z } from "zod";
import { AUDIT_CONSTANTS } from "@/constants/auditConstants";

/**
 * Zod schema for validating audit log entries
 * this schema ensures that all required fields are present and correctly formatted
 * before being processed or stored in the database.
 */
export const AuditLogSchema = z.object({
  id: z.uuid().optional(),
  accessReason: z.string().max(500).nullish(),
  action: z
    .enum(Object.values(AUDIT_CONSTANTS.ACTION_TYPES) as [string, ...string[]])
    .optional(),
  checksum: z.string().max(64).nullish(),
  data: z.record(z.any(), z.json()).optional(),
  description: z.string().max(1000).optional(),
  errorMessage: z.string().max(1000).nullish(),
  eventType: z
    .enum(Object.values(AUDIT_CONSTANTS.EVENT_TYPES) as [string, ...string[]])
    .optional(),
  hipaaCompliant: z.boolean().optional(),
  ipAddress: z.ipv4().or(z.ipv6()).optional(),
  metadata: z.record(z.any(), z.json()).optional(),
  patientId: z.uuid().optional(),
  resourceId: z.string().max(100).nullish(),
  resourceType: z.string().max(100).nullish(),
  sessionId: z.string().max(100).nullish(),
  severityLevel: z
    .enum(
      Object.values(AUDIT_CONSTANTS.SEVERITY_LEVELS) as [string, ...string[]],
    )
    .default("LOW"),
  source: z.string().max(100).optional(),
  statusCode: z.number().min(100).max(599).optional(),
  success: z.boolean().default(true).optional(),
  targetUserId: z.string().max(100).nullish(),
  userAgent: z.string().max(500).optional(),
  userId: z.string().optional(),
  userRole: z
    .enum(Object.values(AUDIT_CONSTANTS.USER_ROLES) as [string, ...string[]])
    .optional(),
});

export type AuditLogInput = z.infer<typeof AuditLogSchema>;
export type AuditEventType =
  (typeof AUDIT_CONSTANTS.EVENT_TYPES)[keyof typeof AUDIT_CONSTANTS.EVENT_TYPES];
export type AuditSeverity =
  (typeof AUDIT_CONSTANTS.SEVERITY_LEVELS)[keyof typeof AUDIT_CONSTANTS.SEVERITY_LEVELS];

export interface AuditLogEntity extends AuditLogInput {
  id: string;
  createdAt: Date | undefined;
}

/**
 * AuditLog class representing an audit log entry
 * This class encapsulates the properties and behaviors of an audit log entry,
 * providing methods to evaluate its sensitivity, security relevance, and urgency.
 */
export class AuditLog {
  constructor(
    public readonly id: string,
    public readonly accessReason?: string,
    public readonly action?: string,
    public readonly checksum?: string,
    public readonly createdAt?: Date,
    public readonly data?: Record<string, any>,
    public readonly description?: string,
    public readonly errorMessage?: string,
    public readonly eventType?: string,
    public readonly hipaaCompliant?: boolean,
    public readonly ipAddress?: string,
    public readonly metadata?: Record<string, any>,
    public readonly resourceId?: string,
    public readonly resourceType?: string,
    public readonly sessionId?: string,
    public readonly severityLevel: string = "LOW",
    public readonly source?: string,
    public readonly statusCode?: number,
    public readonly success?: boolean,
    public readonly targetUserId?: string,
    public readonly userAgent?: string,
    public readonly userId?: string,
    public readonly userRole?: string,
  ) {}

  /**
   * Check if the event involves access to HIPAA-sensitive data
   * Events like accessing patient records, EHRs, prescriptions, etc.
   * are considered HIPAA-sensitive and require special handling.
   */
  public isHIPAASensitive(): boolean {
    const sensitiveEvents = [
      AUDIT_CONSTANTS.EVENT_TYPES.PATIENT_ACCESSED,
      AUDIT_CONSTANTS.EVENT_TYPES.EHR_ACCESSED,
      AUDIT_CONSTANTS.EVENT_TYPES.DOCUMENT_ACCESSED,
      AUDIT_CONSTANTS.EVENT_TYPES.PRESCRIPTION_CREATED,
      AUDIT_CONSTANTS.EVENT_TYPES.EHR_CREATED,
      AUDIT_CONSTANTS.EVENT_TYPES.EHR_UPDATED,
    ];
    return sensitiveEvents.includes(this.eventType as any);
  }

  /**
   * Check if the event is related to security (e.g., login, logout, failed access)
   * Security events are critical for monitoring potential breaches or unauthorized access.
   */
  public isSecurityEvent(): boolean {
    const securityEvents = [
      AUDIT_CONSTANTS.EVENT_TYPES.USER_LOGIN,
      AUDIT_CONSTANTS.EVENT_TYPES.USER_LOGOUT,
      AUDIT_CONSTANTS.EVENT_TYPES.SECURITY_VIOLATION,
      AUDIT_CONSTANTS.EVENT_TYPES.USER_DEACTIVATED,
    ];
    return securityEvents.includes(this.eventType as any);
  }

  /**
   * Determine if the event requires immediate attention
   * Critical risk level events, security violations, and failed HIPAA-sensitive accesses
   * should be flagged for prompt review by the security team.
   */
  public requiresImmediateAttention(): boolean {
    return (
      this.severityLevel === AUDIT_CONSTANTS.SEVERITY_LEVELS.CRITICAL ||
      this.eventType === AUDIT_CONSTANTS.EVENT_TYPES.SECURITY_VIOLATION ||
      (!this.success && this.isHIPAASensitive())
    );
  }

  /**
   * Convert the AuditLog instance to a plain object for easier serialization or logging
   * This is useful for sending the log entry to external systems or storing it in a database.
   */
  public toPlainObject(): AuditLogEntity {
    return {
      id: this.id,
      accessReason: this.accessReason,
      action: this.action,
      checksum: this.checksum,
      createdAt: this.createdAt,
      data: this.data,
      description: this.description,
      errorMessage: this.errorMessage,
      eventType: this.eventType,
      hipaaCompliant: this.isHIPAASensitive(),
      ipAddress: this.ipAddress,
      metadata: this.metadata,
      resourceId: this.resourceId,
      resourceType: this.resourceType,
      sessionId: this.sessionId,
      severityLevel: this.severityLevel,
      source: this.source,
      statusCode: this.statusCode,
      success: this.success,
      targetUserId: this.targetUserId,
      userAgent: this.userAgent,
      userId: this.userId,
      userRole: this.userRole,
    };
  }
}
