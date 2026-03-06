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
      // Use official API if available
      const raw = await this.api.collectAllThreads(profile.userId, 2);
      threads = raw.map(t => this.api.normalize(t));
    } else {
      // Use scraper - now returns { profile: {...}, threads: [...] }
      const result = await this.scraper.scrapeProfileThreads(profile.username);

      // Update profile info from scraper
      if (result.profile) {
        if (result.profile.displayName) profile.displayName = result.profile.displayName;
        if (result.profile.bio) profile.bio = result.profile.bio;
        if (result.profile.followerCount) profile.followerCount = result.profile.followerCount;
        if (result.profile.isVerified) profile.isVerified = result.profile.isVerified;
      }

      threads = result.threads || [];
    }

    let newCount = 0;
    for (const thread of threads) {
      const saved = await this.processThread(thread, profile);
      if (saved) newCount++;
    }

    profile.tracking.lastCollectedAt = new Date();
    profile.tracking.totalCollected += newCount;
    await profile.save();
    logger.info('Collected ' + newCount + ' new threads for @' + profile.username);
  }

  async processThread(threadData, profile) {
    if (!threadData || !threadData.threadId) return false;

    const existing = await Thread.findOne({ threadId: threadData.threadId });
    if (existing) return false;

    const affiliate = this.affiliateDetector.analyze(threadData);
    const category = await this.classifier.classify(threadData);

    const thread = new Thread({
      threadId: threadData.threadId,
      content: threadData.content || { text: '', mediaUrls: [], urls: [] },
      metrics: threadData.metrics || { likes: 0, replies: 0, reposts: 0 },
      author: {
        username: profile.username,
        userId: profile.userId || '',
        displayName: profile.displayName || profile.username,
      },
      category,
      affiliate,
      source: threadData.source || 'scraper',
      postedAt: threadData.postedAt || new Date(),
      collectedAt: new Date(),
    });

    await thread.save();
    this.stats.totalCollected++;
    logger.debug('Saved thread: ' + threadData.threadId);
    return true;
  }

  getStats() { return { ...this.stats, uptime: process.uptime() }; }
}

export default CollectorEngine;
