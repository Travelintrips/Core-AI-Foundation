describe('Logger', () => {
  let originalLogLevel: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    originalLogLevel = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it('defaults to info when LOG_LEVEL is not set', () => {
    const { logger } = require('../logger');
    expect(logger.level).toBe('info');
  });

  it('uses custom LOG_LEVEL debug', () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = require('../logger');
    expect(logger.level).toBe('debug');
  });

  it('uses custom LOG_LEVEL error', () => {
    process.env.LOG_LEVEL = 'error';
    const { logger } = require('../logger');
    expect(logger.level).toBe('error');
  });
});
