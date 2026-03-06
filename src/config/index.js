import 'dotenv/config';

export default {
  port: process.env.PORT || 3001,
  env: process.env.NODE_ENV || 'development',
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/threads-collector',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    url: process.env.REDIS_URL || null,
  },
  threads: {
    appId: process.env.THREADS_APP_ID,
    appSecret: process.env.THREADS_APP_SECRET,
    accessToken: process.env.THREADS_ACCESS_TOKEN,
    baseUrl: 'https://graph.threads.net/v1.0',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  collector: {
    intervalMinutes: parseInt(process.env.COLLECT_INTERVAL_MINUTES) || 5,
    maxPerBatch: parseInt(process.env.MAX_THREADS_PER_BATCH) || 100,
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY) || 3,
  },
  affiliate: {
    enabled: process.env.AFFILIATE_TRACKING === 'true',
  },
};
