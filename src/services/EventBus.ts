import { EventEmitter } from "events";
import { logger } from "@/utils/logger";
import { AuditService } from "./AuditService";

export interface MedCoreEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: any;
  userId?: string;
  sessionId?: string;
}

export class EventBus extends EventEmitter {
  private auditService: AuditService;

  constructor() {
    super();
    this.auditService = new AuditService();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {}
}
