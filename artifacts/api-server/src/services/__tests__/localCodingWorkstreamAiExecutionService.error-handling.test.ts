import { LocalCodingWorkstreamAiExecutionService } from '../../localCodingWorkstreamAiExecutionService';
import { PrimaryModelService } from '../../primaryModelService';
import { PreferredModelService } from '../../preferredModelService';
import logger from '../../../logger';
import { ErrorCode } from '../../errors';

jest.mock('../../primaryModelService');
jest.mock('../../preferredModelService');
jest.mock('../../../logger');

describe('LocalCodingWorkstreamAiExecutionService error handling', () => {
  let service: LocalCodingWorkstreamAiExecutionService;
  const primaryMock = PrimaryModelService as jest.Mocked<typeof PrimaryModelService>;
  const preferredMock = PreferredModelService as jest.Mocked<typeof PreferredModelService>;

  beforeEach(() => {
    primaryMock.invoke_model.mockReset();
    preferredMock.invoke_model.mockReset();
    (logger.error as jest.Mock).mockReset();
    service = new LocalCodingWorkstreamAiExecutionService(primaryMock, preferredMock);
  });

  it('should handle PROVIDER_BAD_REQUEST and fallback to preferred model', async () => {
    primaryMock.invoke_model.mockRejectedValueOnce({ code: ErrorCode.PROVIDER_BAD_REQUEST });
    preferredMock.invoke_model.mockResolvedValueOnce({ data: 'fallback result' });

    const result = await service.execute({ prompt: 'test' });

    expect(primaryMock.invoke_model).toHaveBeenCalledWith(expect.any(Object));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('WS-001'));
    expect(preferredMock.invoke_model).toHaveBeenCalledWith(expect.any(Object));
    expect(result.data).toBe('fallback result');
  });
});
