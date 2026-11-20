import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3Service } from './s3.service';
import { DynamoDbService } from './dynamodb.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [S3Service, DynamoDbService],
  exports: [S3Service, DynamoDbService],
})
export class AwsModule {}
