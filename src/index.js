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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// API Routes
app.use('/api', routes);

// Dashboard
app.get('/', async (req, res) => {
  let stats = { threads: 0, profiles: 0, db: 'disconnected' };
  try {
    if (mongoose.connection.readyState === 1) {
      stats.db = 'connected';
      stats.threads = await mongoose.model('Thread').countDocuments();
      stats.profiles = await mongoose.model('Profile').countDocuments();
    }
  } catch(e) {}
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SearchT</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0a0a0a;color:#e0e0e0;padding:40px}' +
    '.c{max-width:900px;margin:0 auto}h1{font-size:2.5rem;background:linear-gradient(135deg,#667eea,#764ba2);' +
    '-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-align:center;margin-bottom:8px}' +
    '.sub{text-align:center;color:#888;margin-bottom:40px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px}' +
    '.card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px;text-align:center}' +
    '.n{font-size:2rem;font-weight:bold;color:#667eea}.l{color:#888;margin-top:4px}' +
    '.badge{display:inline-block;padding:4px 12px;border-radius:20px;background:#1a3a1a;color:#4ade80;border:1px solid #2d5a2d}' +
    '.ep{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:24px;margin-bottom:24px}' +
    '.ep h2{color:#667eea;margin-bottom:16px}.row{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #222}' +
    '.row:last-child{border-bottom:none}.m{background:#1a3a1a;color:#4ade80;padding:2px 8px;border-radius:4px;' +
    'font-size:.8rem;font-weight:bold;margin-right:12px;min-width:50px;text-align:center}' +
    '.m.p{background:#3a2a1a;color:#f59e0b}a{color:#667eea;text-decoration:none}a:hover{text-decoration:underline}' +
    '.d{color:#666;margin-left:12px;font-size:.9rem}.ft{text-align:center;color:#444;margin-top:32px}</style></head><body><div class="c">' +
    '<h1>SearchT</h1><p class="sub">Meta Threads Big Data Collection &amp; Analysis Platform</p>' +
    '<div class="g"><div class="card"><div class="n">' + stats.threads + '</div><div class="l">Threads</div></div>' +
    '<div class="card"><div class="n">' + stats.profiles + '</div><div class="l">Profiles</div></div>' +
    '<div class="card"><div class="l" style="margin-bottom:8px">DB</div><span class="badge">' + stats.db + '</span></div></div>' +
    '<div class="ep"><h2>API Endpoints</h2>' +
    '<div class="row"><span class="m">GET</span><a href="/api/threads">/api/threads</a><span class="d">List threads</span></div>' +
    '<div class="row"><span class="m">GET</span><a href="/api/stats/overview">/api/stats/overview</a><span class="d">Stats</span></div>' +
    '<div class="row"><span class="m">GET</span><a href="/api/stats/affiliate">/api/stats/affiliate</a><span class="d">Affiliate</span></div>' +
    '<div class="row"><span class="m">GET</span><a href="/api/stats/trending">/api/stats/trending</a><span class="d">Trending</span></div>' +
    '<div class="row"><span class="m">GET</span><a href="/api/profiles">/api/profiles</a><span class="d">Profiles</span></div>' +
    '<div class="row"><span class="m p">POST</span><span>/api/collector/run</span><span class="d">Run collector</span></div>' +
    '<div class="row"><span class="m">GET</span><a href="/api/collector/status">/api/collector/status</a><span class="d">Status</span></div>' +
    '<div class="row"><span class="m">GET</span><a href="/health">/health</a><span class="d">Health</span></div></div>' +
    '<div class="ft">SearchT v1.0 | Node.js + MongoDB + Redis</div></div></body></html>';
  res.send(html);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Start server
async function start() {
  try {
    await mongoose.connect(config.mongodb.uri);
    logger.info('MongoDB connected');

    const engine = new CollectorEngine();
    app.set('collectorEngine', engine);

    if (config.env === 'production') {
      const cron = '*/' + config.collector.intervalMinutes + ' * * * *';
      const job = new CronJob(cron, () => {
        engine.runCollectionCycle().catch(e => logger.error('Cron failed', { error: e.message }));
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
