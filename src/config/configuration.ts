import { APP_CONSTANTS } from '../constants';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  frontendUrl: string;
  allowedOrigins: string[];
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  aws: {
    region: string;
    s3BucketName: string;
    dynamoDbTableName: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

export default (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || '';

  // Parse comma-separated ALLOWED_ORIGINS (e.g. "http://localhost:5173,http://localhost:3000,http://localhost:5000")
  let originsList: string[] = [];

  if (rawAllowedOrigins.trim() === '*' || frontendUrl.trim() === '*') {
    originsList = ['*'];
  } else {
    const parsedOrigins = rawAllowedOrigins
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    // Ensure the primary FRONTEND_URL is always included in the allowed list
    if (frontendUrl && !parsedOrigins.includes(frontendUrl)) {
      parsedOrigins.push(frontendUrl);
    }

    // Default fallback if nothing was configured
    if (parsedOrigins.length === 0) {
      parsedOrigins.push('http://localhost:5173', 'http://localhost:3000');
    }

    originsList = parsedOrigins;
  }

  const corsOrigin = originsList.includes('*') ? '*' : originsList;

  return {
    port: parseInt(process.env.PORT, 10) || APP_CONSTANTS.DEFAULT_PORT,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    frontendUrl,
    allowedOrigins: originsList,
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    aws: {
      region: process.env.AWS_REGION || APP_CONSTANTS.DEFAULT_AWS_REGION,
      s3BucketName: process.env.S3_BUCKET_NAME || APP_CONSTANTS.DEFAULT_S3_BUCKET,
      dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME || APP_CONSTANTS.DEFAULT_DYNAMODB_TABLE,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
    },
  };
};
