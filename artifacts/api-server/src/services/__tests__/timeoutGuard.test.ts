import { executionGate } from '../executionGate';
import { autonomousRepair } from '../autonomousRepair';
import { timeoutGuard } from '../timeoutGuard';

describe('timeoutGuard', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('with executionGate', () => {
    it('should timeout long-running executionGate', async () => {
      (executionGate as jest.Mock) = jest.fn(() => new Promise(resolve => setTimeout(() => resolve('ok'), 1000)));
      await expect(timeoutGuard(executionGate(), 100)).rejects.toThrow('Operation timed out');
    });

    it('should return value if executionGate completes in time', async () => {
      (executionGate as jest.Mock) = jest.fn(() => Promise.resolve('fast-result'));
      await expect(timeoutGuard(executionGate(), 100)).resolves.toBe('fast-result');
    });
  });

  describe('with autonomousRepair', () => {
    it('should timeout long-running autonomousRepair', async () => {
      (autonomousRepair as jest.Mock) = jest.fn(() => new Promise(resolve => setTimeout(() => resolve('repaired'), 1000)));
      await expect(timeoutGuard(autonomousRepair(), 100)).rejects.toThrow('Operation timed out');
    });

    it('should return value if autonomousRepair completes in time', async () => {
      (autonomousRepair as jest.Mock) = jest.fn(() => Promise.resolve('quick-fix'));
      await expect(timeoutGuard(autonomousRepair(), 100)).resolves.toBe('quick-fix');
    });
  });
});
