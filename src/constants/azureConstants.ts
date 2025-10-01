// These constants represent the names of various Azure Event Hubs used in the application.
export const AZURE_EVENT_HUB_CONSTANTS = {
  AUDIT: "medcore-audit-events",
  SECURITY: "medcore-security-events",
  PATIENT: "medcore-patient-events",
  CLINICAL: "medcore-clinical-events",
  INVENTORY: "medcore-inventory-events",
  SYSTEM: "medcore-system-events",
  COMPLIANCE: "medcore-compliance-events",
  DLQ: "medcore-dead-letter-queue",
} as const;
