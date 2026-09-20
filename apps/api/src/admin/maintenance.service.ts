import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MaintenanceService {
  private maintenanceMode = false;

  constructor(private config: ConfigService) {
    this.maintenanceMode = this.config.get<string>('MAINTENANCE_MODE', 'true') === 'true';
  }

  isMaintenanceMode(): boolean {
    return this.maintenanceMode;
  }

  setMaintenanceMode(enabled: boolean): void {
    this.maintenanceMode = enabled;
  }
}
