import { describe, it, expect } from 'vitest';
import { checkPullRequestGate } from '../localCodingPullRequestGateService';

describe('localCodingPullRequestGateService', () => {
  it('should keep active runs when approved', async () => {
    // Simulate active run scenario and verify it's not cancelled
    const result = await checkPullRequestGate({ isActive: true, prId: 123 });
    expect(result).toBe(true);
  });

  it('should clean up obsolete runs', async () => {
    // Simulate obsolete run scenario and verify cleanup
    const result = await checkPullRequestGate({ isActive: false, prId: 456 });
    expect(result).toBe(false);
  });
});
