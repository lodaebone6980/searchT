import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { CronJob } from 'cron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from './config/index.js';
import logger from './utils/logger.js';
import routes from './api/routes.js';
import CollectorEngine from './collectors/CollectorEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Static files (Korean dashboard)
app.use(express.static(join(__dirname, '..', 'public')));

// API Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

async function start() {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('MongoDB connected');
    const engine = new CollectorEngine();
    app.set('collectorEngine', engine);
    if (config.env === 'production') {
      const cron = '*/' + config.collector.intervalMinutes + ' * * * *';
      const job = new CronJob(cron, () => {
        engine.runCollectionCycle().catch(e => logger.error('Cron error', { error: e.message }));
      });
      job.start();
      logger.info('Cron started: every ' + config.collector.intervalMinutes + ' min');
    }
    app.listen(config.port, () => {
      logger.info('Server on port ' + config.port + ' [' + config.env + ']');
    });
  } catch (error) {
    logger.error('Start failed', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await mongoose.disconnect();
  process.exit(0);
});

start();
