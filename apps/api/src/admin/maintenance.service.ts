import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService, MAINTENANCE_FLAG, REGISTRATION_FLAG } from '../common/services/feature-flags.service';

@Injectable()
export class MaintenanceService {
  constructor(
    private flags: FeatureFlagsService,
    private config: ConfigService,
  ) {}

  isMaintenanceMode(): Promise<boolean> {
    // Défaut si jamais configuré : env MAINTENANCE_MODE, sinon désactivé
    const envDefault = this.config.get<string>('MAINTENANCE_MODE') === 'true';
    return this.flags.getFlag(MAINTENANCE_FLAG, envDefault);
  }

  setMaintenanceMode(enabled: boolean): Promise<void> {
    return this.flags.setFlag(MAINTENANCE_FLAG, enabled);
  }

  isRegistrationEnabled(): Promise<boolean> {
    return this.flags.getFlag(REGISTRATION_FLAG, true);
  }

  setRegistrationEnabled(enabled: boolean): Promise<void> {
    return this.flags.setFlag(REGISTRATION_FLAG, enabled);
  }
}
