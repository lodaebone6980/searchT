import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import router, { engine } from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/threads-collector';
const COLLECT_INTERVAL_HOURS = parseInt(process.env.COLLECT_INTERVAL_HOURS || '3', 10);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// Store engine in app for route access
app.set('collectorEngine', engine);

// API routes
app.use('/api', router);

// Health check endpoint
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('[MongoDB] Connected successfully'))
  .catch(err => console.error('[MongoDB] Connection error:', err.message));

// Auto-collection scheduler
let autoCollectTimer = null;

function startAutoCollector() {
  console.log(`[AutoCollect] Initialized with interval: ${COLLECT_INTERVAL_HOURS} hours`);

  // Initial collection after 5 minutes of startup
  const initialDelay = setTimeout(() => {
    console.log('[AutoCollect] Running initial collection...');
    engine.runAutoCollection().catch(err => console.error('[AutoCollect] Initial collection error:', err));
  }, 5 * 60 * 1000);

  // Recurring collection every COLLECT_INTERVAL_HOURS
  autoCollectTimer = setInterval(() => {
    console.log('[AutoCollect] Running scheduled collection...');
    engine.runAutoCollection().catch(err => console.error('[AutoCollect] Scheduled collection error:', err));
  }, COLLECT_INTERVAL_HOURS * 60 * 60 * 1000);

  // Cleanup initial timer on shutdown
  process.on('exit', () => clearTimeout(initialDelay));
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start auto-collector (runs in all environments for flexibility)
  startAutoCollector();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');

  if (autoCollectTimer) {
    clearInterval(autoCollectTimer);
    console.log('[Server] Auto-collection interval cleared');
  }

  server.close(async () => {
    try {
      await mongoose.disconnect();
      console.log('[MongoDB] Disconnected');
    } catch (err) {
      console.error('[MongoDB] Disconnect error:', err.message);
    }
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  process.exit(1);
});

export { app, engine };
