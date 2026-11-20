export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  appUrl: string;
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

