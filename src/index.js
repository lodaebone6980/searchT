import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { CronJob } from 'cron';
import config from './config/index.js';
import logger from './utils/logger.js';
import routes from './api/routes.js';
import CollectorEngine from './collectors/CollectorEngine.js';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// API Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Start server
async function start() {
  try {
    // MongoDB connection
    await mongoose.connect(config.mongodb.uri);
    logger.info('MongoDB connected');

    // Initialize collector engine
    const engine = new CollectorEngine();
    app.set('collectorEngine', engine);

    // Cron job for automatic collection
    if (config.env === 'production') {
      const cronExpression = '*/' + config.collector.intervalMinutes + ' * * * *';
      const job = new CronJob(cronExpression, () => {
        engine.runCollectionCycle().catch(e => logger.error('Cron collection failed', { error: e.message }));
      });
      job.start();
      logger.info('Cron scheduler started: every ' + config.collector.intervalMinutes + ' minutes');
    }

    app.listen(config.port, () => {
      logger.info('Server running on port ' + config.port + ' [' + config.env + ']');
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await mongoose.disconnect();
  process.exit(0);
});

start();
