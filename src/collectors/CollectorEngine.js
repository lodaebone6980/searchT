import ThreadsOfficialAPI from './ThreadsOfficialAPI.js';
import ThreadsScraper from './ThreadsScraper.js';
import CategoryClassifier from '../classifiers/CategoryClassifier.js';
import AffiliateDetector from '../classifiers/AffiliateDetector.js';
import Thread from '../models/Thread.js';
import Profile from '../models/Profile.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

export class CollectorEngine {
  constructor() {
    this.api = config.threads.accessToken ? new ThreadsOfficialAPI() : null;
    this.scraper = new ThreadsScraper();
    this.classifier = new CategoryClassifier();
    this.affiliateDetector = new AffiliateDetector();
    this.stats = { totalCollected: 0, lastRun: null, errors: 0 };
  }

  async runCollectionCycle() {
    logger.info('Starting collection cycle...');
    this.stats.lastRun = new Date();
    const profiles = await Profile.find({ 'tracking.isTracking': true })
      .sort({ 'tracking.priority': -1 })
      .limit(config.collector.maxPerBatch);

    for (const profile of profiles) {
      try {
        await this.collectProfileThreads(profile);
      } catch (err) {
        this.stats.errors++;
        logger.error('Collection failed for @' + profile.username, { error: err.message });
      }
    }
    logger.info('Collection cycle complete. Total: ' + this.stats.totalCollected);
  }

  async collectProfileThreads(profile) {
    let threads = [];
    if (this.api && profile.userId) {
      const raw = await this.api.collectAllThreads(profile.userId, 2);
      threads = raw.map(t => this.api.normalize(t));
    } else {
      const scraped = await this.scraper.scrapeProfile(profile.username);
      if (scraped) threads = [scraped];
    }

    for (const thread of threads) {
      await this.processThread(thread, profile);
    }

    profile.tracking.lastCollectedAt = new Date();
    profile.tracking.totalCollected += threads.length;
    await profile.save();
  }

  async processThread(threadData, profile) {
    const existing = await Thread.findOne({ threadId: threadData.threadId });
    if (existing) return;

    const affiliate = this.affiliateDetector.analyze(threadData);
    const category = await this.classifier.classify(threadData);

    const thread = new Thread({
      ...threadData,
      author: { username: profile.username, userId: profile.userId, displayName: profile.displayName },
      category,
      affiliate,
      collectedAt: new Date(),
    });

    await thread.save();
    this.stats.totalCollected++;
    logger.debug('Saved thread: ' + threadData.threadId);
  }

  getStats() { return { ...this.stats, uptime: process.uptime() }; }
}

export default CollectorEngine;
