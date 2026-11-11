import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { redisProvider, refreshTokenStoreProvider } from '../../db/redis';
import { AdminModule } from '../admin/admin.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [UsersModule, AdminModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, redisProvider, refreshTokenStoreProvider],
  exports: [AuthService],
})
export class AuthModule {}
