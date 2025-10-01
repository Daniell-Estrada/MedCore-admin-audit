import { z } from "zod";
import { AUDIT_CONSTANTS } from "@/constants/auditConstants";

/**
 * Base schema for MedCore events
 * This schema defines the common structure for all event types,
 * ensuring consistency and facilitating validation across different event categories.
 */
export const MedCoreEventSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.coerce.date(),
  userId: z.string().optional(),
  sessionId: z.uuid().optional(),
  severityLevel: z.enum(
    Object.values(AUDIT_CONSTANTS.SEVERITY_LEVELS) as [string, ...string[]],
  ),
  data: z.record(z.string(), z.unknown()),
  hipaaCompliance: z
    .object({
      patientId: z.uuid().optional(),
      accessReason: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SecurityEventSchema = MedCoreEventSchema.extend({
  data: z.object({
    role: z.string().optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    success: z.boolean().optional(),
    department: z.string().optional(),
    loginMethod: z.string().optional(),
  }),
});

export const PatientEventSchema = MedCoreEventSchema.extend({
  data: z.object({
    userRole: z.string().optional(),
    resourceId: z.string().optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    success: z.boolean().optional(),
  }),
  hipaaCompliance: z.object({
    patientId: z.uuid(),
    accessReason: z.string().min(1),
  }),
});

export const ClinicalEventSchema = MedCoreEventSchema.extend({
  data: z.object({
    userRole: z.string().optional(),
    patientId: z.uuid().optional(),
    resourceId: z.string().optional(),
    success: z.boolean().optional(),
  }),
});

export const InventoryEventSchema = MedCoreEventSchema.extend({
  data: z.object({
    userRole: z.string().optional(),
    resourceId: z.string().optional(),
    success: z.boolean().optional(),
  }),
});

export const SystemEventSchema = MedCoreEventSchema.extend({
  data: z.object({
    resourceId: z.string().optional(),
    success: z.boolean().optional(),
    component: z.string().optional(),
    errorCode: z.string().optional(),
    message: z.string().optional(),
  }),
});

/**
 * Validate event based on its source
 */
export function validateEvent(event: any, source: string): boolean {
  try {
    switch (source) {
      case "ms-security":
        SecurityEventSchema.parse(event);
        break;
      case "ms-patientEHR":
        PatientEventSchema.parse(event);
        break;
      case "ms-clinical":
        ClinicalEventSchema.parse(event);
        break;
      case "ms-inventory-billing":
        InventoryEventSchema.parse(event);
        break;
      case "ms-admin-audit":
      case "system":
        SystemEventSchema.parse(event);
        break;
      default:
        MedCoreEventSchema.parse(event);
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get validation errors for an event
 */
export function getEventValidationErrors(event: any, source: string): string[] {
  const errors: string[] = [];

  try {
    switch (source) {
      case "ms-security":
        SecurityEventSchema.parse(event);
        break;
      case "ms-patientEHR":
        PatientEventSchema.parse(event);
        break;
      case "ms-clinical":
        ClinicalEventSchema.parse(event);
        break;
      case "ms-inventory-billing":
        InventoryEventSchema.parse(event);
        break;
      case "ms-admin-audit":
      case "system":
        SystemEventSchema.parse(event);
        break;
      default:
        MedCoreEventSchema.parse(event);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      errors.push(...error.issues.map((e) => e.message));
    } else {
      errors.push("Unknown validation error");
    }
  }

  return errors;
}
