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

// Dashboard - Root page
app.get('/', async (req, res) => {
  let dbStatus = 'disconnected';
  let threadCount = 0;
  let profileCount = 0;
  try {
    if (mongoose.connection.readyState === 1) {
      dbStatus = 'connected';
      const Thread = mongoose.model('Thread');
      const Profile = mongoose.model('Profile');
      threadCount = await Thread.countDocuments();
      profileCount = await Profile.countDocuments();
    }
  } catch(e) { dbStatus = 'error'; }

  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SearchT - Threads Data Platform</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh}
.container{max-width:1200px;margin:0 auto;padding:40px 20px}
.header{text-align:center;margin-bottom:50px}
.header h1{font-size:3rem;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:10px}
.header p{color:#888;font-size:1.1rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:40px}
.stat-card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:24px;text-align:center}
.stat-card .number{font-size:2.5rem;font-weight:bold;color:#667eea}
.stat-card .label{color:#888;margin-top:5px}
.status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:0.85rem;font-weight:600}
.status-online{background:#1a3a1a;color:#4ade80;border:1px solid #2d5a2d}
.categories{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-bottom:40px}
.cat-card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:24px}
.cat-card h3{font-size:1.3rem;margin-bottom:8px}
.cat-card p{color:#888;font-size:0.95rem;line-height:1.5}
.cat-shopping h3{color:#f59e0b}
.cat-issues h3{color:#ef4444}
.cat-personal h3{color:#3b82f6}
.endpoints{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:30px;margin-bottom:40px}
.endpoints h2{margin-bottom:20px;color:#667eea}
.endpoint{display:flex;align-items:center;padding:10px 0;border-bottom:1px solid #222}
.endpoint:last-child{border-bottom:none}
.method{background:#1a3a1a;color:#4ade80;padding:3px 10px;border-radius:4px;font-size:0.8rem;font-weight:bold;margin-right:15px;min-width:55px;text-align:center}
.method.post{background:#3a2a1a;color:#f59e0b}
.endpoint a{color:#667eea;text-decoration:none}
.endpoint a:hover{text-decoration:underline}
.endpoint .desc{color:#666;margin-left:15px;font-size:0.9rem}
.footer{text-align:center;color:#444;margin-top:40px}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>SearchT</h1>
<p>Meta Threads Big Data Collection & Analysis Platform</p>
</div>
<div class="stats">
<div class="stat-card"><div class="number">${threadCount}</div><div class="label">Collected Threads</div></div>
<div class="stat-card"><div class="number">${profileCount}</div><div class="label">Tracked Profiles</div></div>
<div class="stat-card"><div class="number">3</div><div class="label">Categories</div></div>
<div class="stat-card"><div class="label" style="margin-bottom:8px">Database</div><span class="status-badge status-online">${dbStatus}</span></div>
</div>
<div class="categories">
<div class="cat-card cat-shopping"><h3>Shopping</h3><p>Affiliate link posts from AliExpress, Coupang, Rakuten, Amazon. Tracks shopping trends.</p></div>
<div class="cat-card cat-issues"><h3>Issues</h3><p>Trending news: entertainment, politics, economy, IT/tech, sports.</p></div>
<div class="cat-card cat-personal"><h3>Personal</h3><p>Professional profiles doing marketing and branding through Threads.</p></div>
</div>
<div class="endpoints">
<h2>API Endpoints</h2>
<div class="endpoint"><span class="method">GET</span><a href="/api/threads">/api/threads</a><span class="desc">List collected threads</span></div>
<div class="endpoint"><span class="method">GET</span><a href="/api/stats/overview">/api/stats/overview</a><span class="desc">Statistics overview</span></div>
<div class="endpoint"><span class="method">GET</span><a href="/api/stats/affiliate">/api/stats/affiliate</a><span class="desc">Affiliate stats</span></div>
<div class="endpoint"><span class="method">GET</span><a href="/api/stats/trending">/api/stats/trending</a><span class="desc">Trending topics</span></div>
<div class="endpoint"><span class="method">GET</span><a href="/api/profiles">/api/profiles</a><span class="desc">Tracked profiles</span></div>
<div class="endpoint"><span class="method post">POST</span><span>/api/collector/run</span><span class="desc">Trigger collection</span></div>
<div class="endpoint"><span class="method">GET</span><a href="/api/collector/status">/api/collector/status</a><span class="desc">Collector status</span></div>
<div class="endpoint"><span class="method">GET</span><a href="/health">/health</a><span class="desc">Health check</span></div>
</div>
<div class="footer"><p>SearchT v1.0 | Node.js + MongoDB + Redis</p></div>
</div>
</body>
</html>`);
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

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await mongoose.disconnect();
  process.exit(0);
});

start();import express from 'express';
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
