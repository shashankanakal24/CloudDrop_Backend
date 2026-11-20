import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfigService, getCorsConfig } from './config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const appConfig = app.get(AppConfigService);

  // Apply clean, centralized CORS configuration from src/config/cors.config.ts
  app.enableCors(getCorsConfig(appConfig));

  // Global Exception Filter: masks 500 errors from frontend & logs full error + stack to logs/error.log
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Swagger OpenAPI Setup
  const config = new DocumentBuilder()
    .setTitle('CloudDrop API')
    .setDescription(
      'CloudDrop: A easy and Encrypted way of data sharing.',
    )
    .setVersion('1.0')
    .addTag('Files', 'Operations related to file upload, download, and metadata management')
    .addTag('Health', 'Health check endpoints for NLB and Auto Scaling')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'CloudDrop API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = appConfig.port;
  await app.listen(port);
  console.log(`CloudDrop Backend running in [${appConfig.nodeEnv}] mode on port ${port}`);
  console.log(`Allowed CORS origins: ${JSON.stringify(appConfig.corsOrigins)}`);
  console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();
