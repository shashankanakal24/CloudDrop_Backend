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

  describe('health check endpoints', () => {
    it('getHealth() should return UP status for NLB target group', () => {
      const response = appController.getHealth();
      expect(response.status).toBe('UP');
      expect(response.service).toBe('clouddrop-backend');
      expect(response.timestamp).toBeDefined();
    });

    it('getApiHealth() should return API health with uptime', () => {
      const response = appController.getApiHealth();
      expect(response.status).toBe('UP');
      expect(response.service).toBe('clouddrop-backend');
      expect(response.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});

