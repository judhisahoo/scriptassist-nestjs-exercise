import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'your-secret-key',
  accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRATION || '7d',
}));