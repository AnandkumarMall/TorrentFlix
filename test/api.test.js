import request from 'supertest';
import { app } from '../server/index.js';
import { jest } from '@jest/globals';

describe('Torrent API', () => {
  it('should return 400 if magnet link is missing on /api/add', async () => {
    const res = await request(app).post('/api/add').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('magnet required');
  });

  it('should return 404 for unknown torrent status', async () => {
    const res = await request(app).get('/api/status/unknownhash123');
    expect(res.status).toBe(404);
  });

  it('should explicitly stop a torrent if requested', async () => {
    const res = await request(app).post('/api/stop/unknownhash123');
    expect(res.status).toBe(200);
  });

  it('should return 400 if torrent file is missing on /api/upload', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('torrent file required');
  });
});

import { client } from '../server/torrent.js';
afterAll((done) => {
  client.destroy(done);
});
