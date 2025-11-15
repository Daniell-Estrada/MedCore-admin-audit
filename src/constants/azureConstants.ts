// These constants represent the names of various Azure Event Hubs used in the application.
export const AZURE_EVENT_HUB_CONSTANTS = {
  AUDIT: "medcore-audit-events",
  SECURITY: "medcore-security-events",
  PATIENT: "medcore-patient-ehr-events",
  CLINICAL: "medcore-clinical-events",
  SYSTEM: "medcore-system-events",
  DLQ: "medcore-dead-letter-queue-events",
} as const;
