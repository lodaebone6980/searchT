import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const connection = config.redis.url
  ? new IORedis(config.redis.url, { maxRetriesPerRequest: null })
  : new IORedis({ host: config.redis.host, port: config.redis.port, maxRetriesPerRequest: null });

export const collectQueue = new Queue('thread-collection', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export async function addCollectionJob(profileData, options = {}) {
  const job = await collectQueue.add('collect-profile', {
    username: profileData.username,
    userId: profileData.userId,
  }, {
    priority: options.priority === 'high' ? 1 : 2,
    delay: options.delay || 0,
  });
  logger.debug('Collection job added: @' + profileData.username, { jobId: job.id });
  return job;
}

export function createCollectionWorker(collectorEngine) {
  const worker = new Worker('thread-collection', async (job) => {
    const { username } = job.data;
    logger.info('Processing: @' + username, { jobId: job.id });
    const Profile = (await import('../models/Profile.js')).default;
    const profile = await Profile.findOne({ username });
    if (!profile) throw new Error('Profile not found: ' + username);
    await collectorEngine.collectProfileThreads(profile);
    return { success: true, username };
  }, {
    connection,
    concurrency: config.collector.concurrency,
    limiter: { max: 10, duration: 60000 },
  });

  worker.on('completed', (job) => logger.debug('Job completed: ' + job.id));
  worker.on('failed', (job, err) => logger.error('Job failed: ' + job?.id, { error: err.message }));
  return worker;
}

export async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    collectQueue.getWaitingCount(), collectQueue.getActiveCount(),
    collectQueue.getCompletedCount(), collectQueue.getFailedCount(),
  ]);
  return { collection: { waiting, active, completed, failed } };
}
