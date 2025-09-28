import { z } from "zod";
import { AUDIT_CONSTANTS } from "../config/constants";

/**
 * Zod schema for validating audit log entries
 * this schema ensures that all required fields are present and correctly formatted
 * before being processed or stored in the database.
 */
export const AuditLogSchema = z.object({
  eventType: z.enum(
    Object.values(AUDIT_CONSTANTS.EVENT_TYPES) as [string, ...string[]],
  ),
  userId: z.uuid().optional(),
  userRole: z
    .enum(Object.values(AUDIT_CONSTANTS.USER_ROLES) as [string, ...string[]])
    .optional(),
  targetUserId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  resourceType: z.string().max(100).optional(),
  resourceId: z.string().max(100).optional(),
  action: z.enum(
    Object.values(AUDIT_CONSTANTS.ActionTypes) as [string, ...string[]],
  ),
  description: z.string().max(1000).optional(),
  ipAddress: z.ipv4().or(z.ipv6()).optional(),
  userAgent: z.string().max(500).optional(),
  sessionId: z.uuid().optional(),
  riskLevel: z
    .enum(Object.values(AUDIT_CONSTANTS.RISK_LEVELS) as [string, ...string[]])
    .default("LOW"),
  metadata: z.record(z.any(), z.json()).optional(),
  success: z.boolean().default(true),
  errorMessage: z.string().max(1000).optional(),
});

export type AuditLogInput = z.infer<typeof AuditLogSchema>;

export interface AuditLogEntity extends AuditLogInput {
  id: string;
  createdAt: Date;
}

/**
 * AuditLog class representing an audit log entry
 * This class encapsulates the properties and behaviors of an audit log entry,
 * providing methods to evaluate its sensitivity, security relevance, and urgency.
 */
export class AuditLog {
  constructor(
    public readonly id: string,
    public readonly eventType: string,
    public readonly action: string,
    public readonly createdAt: Date,
    public readonly userId?: string,
    public readonly userRole?: string,
    public readonly targetUserId?: string,
    public readonly patientId?: string,
    public readonly resourceType?: string,
    public readonly resourceId?: string,
    public readonly description?: string,
    public readonly ipAddress?: string,
    public readonly userAgent?: string,
    public readonly sessionId?: string,
    public readonly riskLevel: string = "LOW",
    public readonly metadata?: Record<string, any>,
    public readonly success: boolean = true,
    public readonly errorMessage?: string,
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
    return sensitiveEvents.includes(this.eventType);
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
    return securityEvents.includes(this.eventType);
  }

  /**
   * Determine if the event requires immediate attention
   * Critical risk level events, security violations, and failed HIPAA-sensitive accesses
   * should be flagged for prompt review by the security team.
   */
  public requiresImmediateAttention(): boolean {
    return (
      this.riskLevel === AUDIT_CONSTANTS.RISK_LEVELS.CRITICAL ||
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
      eventType: this.eventType,
      userId: this.userId,
      userRole: this.userRole,
      targetUserId: this.targetUserId,
      patientId: this.patientId,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      action: this.action,
      description: this.description,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      sessionId: this.sessionId,
      riskLevel: this.riskLevel,
      metadata: this.metadata,
      success: this.success,
      errorMessage: this.errorMessage,
      createdAt: this.createdAt,
    };
  }
}
