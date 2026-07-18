import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'fallback_secret'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '15m') as any },
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthController, TwoFactorController],
  providers: [AuthService, TwoFactorService, JwtStrategy],
  exports: [JwtModule, AuthService, TwoFactorService],
})
export class AuthModule {}
