import { touch, lastActivity, client } from '../server/torrent.js';
import { IDLE_TIMEOUT } from '../server/config.js';

describe('Torrent Activity Tracking', () => {
  afterAll((done) => {
    client.destroy(done);
  });

  it('should update lastActivity when touch is called', () => {
    const hash = 'test-info-hash-123';
    touch(hash);
    const time = lastActivity.get(hash);
    expect(time).toBeDefined();
    expect(time).toBeGreaterThan(0);
    
    // Test that the idle sweeper would correctly identify an active torrent
    const now = Date.now();
    expect(now - time).toBeLessThan(IDLE_TIMEOUT);
  });
});
