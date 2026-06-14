import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditThrottlerGuard } from './auth/audit-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SecurityAuditService } from './auth/security-audit.service';
import { MailModule } from './mail/mail.module';
import { OtpModule } from './otp/otp.module';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
      expandVariables: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 1000,
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<string>('DB_PORT', '5432')),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [User],
        synchronize:
          configService.get<string>('TYPEORM_SYNCHRONIZE', 'true') === 'true',
      }),
    }),
    UsersModule,
    OtpModule,
    MailModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SecurityAuditService,
    {
      provide: APP_GUARD,
      useClass: AuditThrottlerGuard,
    },
  ],
})
export class AppModule {}
