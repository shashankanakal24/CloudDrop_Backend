import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { FilesService } from './files/files.service';

describe('AppController', () => {
  let appController: AppController;

  const mockFilesService = {
    getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://s3.example.com/test' }),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: FilesService,
          useValue: mockFilesService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health check endpoint', () => {
    it('getHealth() should return UP status and uptime for NLB target group', () => {
      const response = appController.getHealth();
      expect(response.status).toBe('UP');
      expect(response.service).toBe('clouddrop-backend');
      expect(response.uptime).toBeGreaterThanOrEqual(0);
      expect(response.timestamp).toBeDefined();
    });
  });
});
