import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { OtpModule } from '../otp/otp.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UsersModule, OtpModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
