import Thread from '../models/Thread.js';
import ThreadsScraper from './ThreadsScraper.js';

class CollectorEngine {
  constructor() {
    this.scraper = new ThreadsScraper();
    this.isRunning = false;
    this.lastRunAt = null;
    this.nextRunAt = null;
    this.stats = {
      totalCollected: 0,
      totalKeyword: 0,
      totalProfile: 0,
      totalAffiliate: 0,
      errors: 0
    };
    this.logs = [];
    this.intervalHours = 3;
    this.maxLogs = 50;

    // Discovery keywords grouped by category
    this.discoveryKeywords = {
      shopping: ['ÃÂÃÂ¬ÃÂÃÂ¿ÃÂÃÂ ÃÂÃÂ­ÃÂÃÂÃÂÃÂ¡ ÃÂÃÂ­ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¸', 'ÃÂÃÂ­ÃÂÃÂÃÂÃÂ«ÃÂÃÂ«ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂ¶ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ²ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂÃÂÃÂ«ÃÂÃÂ¦ÃÂÃÂ¬ ÃÂÃÂ­ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¸', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂÃÂÃÂ«ÃÂÃÂ§ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ¡ÃÂÃÂ´ ÃÂÃÂ¬ÃÂÃÂ§ÃÂÃÂÃÂÃÂªÃÂÃÂµÃÂÃÂ¬', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¼ÃÂÃÂ­ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂ¶ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ²ÃÂÃÂ', 'ÃÂÃÂ«ÃÂÃÂ§ÃÂÃÂÃÂÃÂ­ÃÂÃÂÃÂÃÂ¬ ÃÂÃÂ­ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¸'],
      issue: ['ÃÂÃÂ¬ÃÂÃÂÃÂÃÂÃÂÃÂ«ÃÂÃÂ³ÃÂÃÂ´', 'ÃÂÃÂ«ÃÂÃÂÃÂÃÂ¼ÃÂÃÂ«ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂ­ÃÂÃÂÃÂÃÂÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¤ÃÂÃÂ¬ÃÂÃÂÃÂÃÂÃÂÃÂªÃÂÃÂ°ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ´ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂÃÂÃÂ«ÃÂÃÂ¦ÃÂÃÂ¬', 'breaking news'],
      personal: ['ÃÂÃÂ­ÃÂÃÂÃÂÃÂ ÃÂÃÂªÃÂÃÂ³ÃÂÃÂµÃÂÃÂ¬ÃÂÃÂÃÂÃÂ ', 'ÃÂÃÂ«ÃÂÃÂÃÂÃÂ¸ÃÂÃÂ­ÃÂÃÂÃÂÃÂÃÂÃÂ¬ÃÂÃÂÃÂÃÂ°', 'ÃÂÃÂ­ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ­ÃÂÃÂÃÂÃÂ¸ÃÂÃÂ­ÃÂÃÂÃÂÃÂ´ÃÂÃÂ«ÃÂÃÂ¦ÃÂÃÂ¬ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¤ ÃÂÃÂªÃÂÃÂ³ÃÂÃÂµÃÂÃÂªÃÂÃÂ°ÃÂÃÂ']
    };

    // Category keywords for classification
    this.categoryKeywords = {
      shopping: ['ÃÂÃÂ­ÃÂÃÂÃÂÃÂ ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¸', 'ÃÂÃÂ¬ÃÂÃÂ¿ÃÂÃÂ ÃÂÃÂ­ÃÂÃÂÃÂÃÂ°', 'ÃÂÃÂ­ÃÂÃÂÃÂÃÂ«ÃÂÃÂ«ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¸ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¼', 'ÃÂÃÂ¬ÃÂÃÂµÃÂÃÂÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂÃÂÃÂªÃÂÃÂ°ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂ¶ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ²ÃÂÃÂÃÂÃÂ­ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂ«ÃÂÃÂ¦ÃÂÃÂ¬ÃÂÃÂ«ÃÂÃÂ·ÃÂÃÂ°', 'ÃÂÃÂªÃÂÃÂµÃÂÃÂ¬ÃÂÃÂ«ÃÂÃÂ§ÃÂÃÂ¤', 'ÃÂÃÂ«ÃÂÃÂ°ÃÂÃÂ°ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¡', 'ÃÂÃÂ¬ÃÂÃÂ§ÃÂÃÂÃÂÃÂªÃÂÃÂµÃÂÃÂ¬', 'ÃÂÃÂªÃÂÃÂ°ÃÂÃÂÃÂÃÂ¬ÃÂÃÂÃÂÃÂ±ÃÂÃÂ«ÃÂÃÂ¹ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¸ÃÂÃÂ«ÃÂÃÂ°ÃÂÃÂÃÂÃÂ¬ÃÂÃÂÃÂÃÂ±'],
      issue: ['ÃÂÃÂ¬ÃÂÃÂÃÂÃÂÃÂÃÂ«ÃÂÃÂ³ÃÂÃÂ´', 'ÃÂÃÂ«ÃÂÃÂÃÂÃÂ¼ÃÂÃÂ«ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂªÃÂÃÂ¸ÃÂÃÂ´ÃÂÃÂªÃÂÃÂ¸ÃÂÃÂ', 'ÃÂÃÂ­ÃÂÃÂÃÂÃÂÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ´ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂ«ÃÂÃÂÃÂÃÂ´ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¤', 'ÃÂÃÂªÃÂÃÂ·ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ ÃÂÃÂªÃÂÃÂ±ÃÂÃÂ°', 'ÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ¹ÃÂÃÂ', 'ÃÂÃÂªÃÂÃÂ²ÃÂÃÂ½ÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¬ÃÂÃÂªÃÂÃÂ±ÃÂÃÂ´'],
      personal: ['ÃÂÃÂ­ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂ«ÃÂÃÂÃÂÃÂ¸ÃÂÃÂ­ÃÂÃÂÃÂÃÂÃÂÃÂ¬ÃÂÃÂÃÂÃÂ°', 'ÃÂÃÂ«ÃÂÃÂ°ÃÂÃÂ©ÃÂÃÂ«ÃÂÃÂ²ÃÂÃÂ', 'ÃÂÃÂ¬ÃÂÃÂ ÃÂÃÂÃÂÃÂ«ÃÂÃÂÃÂÃÂµ', 'ÃÂÃÂªÃÂÃÂ²ÃÂÃÂ½ÃÂÃÂ­ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂ­ÃÂÃÂÃÂÃÂ¬ÃÂÃÂ­ÃÂÃÂÃÂÃÂ¸ÃÂÃÂ­ÃÂÃÂÃÂÃÂ´ÃÂÃÂ«ÃÂÃÂ¦ÃÂÃÂ¬ÃÂÃÂ¬ÃÂÃÂÃÂÃÂ¤', 'ÃÂÃÂªÃÂÃÂ°ÃÂÃÂÃÂÃÂ¬ÃÂÃÂÃÂÃÂ', 'ÃÂÃÂªÃÂÃÂ°ÃÂÃÂÃÂÃÂ¬ÃÂÃÂÃÂÃÂ´ÃÂÃÂ«ÃÂÃÂÃÂÃÂ']
    };

    // Affiliate patterns
    this.affiliatePatterns = {
      coupang: [/link\.coupang\.com/i, /coupa\.ng/i],
      aliexpress: [/ali\.ski/i, /s\.click\.aliexpress\.com/i, /aliexpress\.com/i],
      amazon: [/amzn\.to/i, /amazon\.com\/dp/i, /tag=/i],
      rakuten: [/a\.r10\.to/i, /rakuten/i]
    };
  }

  /**
   * Full auto collection cycle: keyword search ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ profile scrape ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ save to DB
   */
  async runAutoCollection() {
    if (this.isRunning) {
      this.logEvent('Auto collection already running', 'warning');
      return { success: false, message: 'Collection already in progress' };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logEvent('Auto collection started', 'info');

      // Phase 1: Keyword-based discovery (batch per category)
      for (const [category, keywords] of Object.entries(this.discoveryKeywords)) {
        try {
          this.logEvent(`Searching category: ${category} (${keywords.length} keywords)`, 'info');
          const _kwResult = await this.scraper.scrapeKeywords(keywords);
          const threadUrls = (_kwResult && _kwResult.threads) ? _kwResult.threads.map(t => t.url || t) : [];
          this.logEvent(`Found ${threadUrls.length} threads for category: ${category}`, 'info');

          for (const url of threadUrls) {
            try {
              const threadData = await this.scraper.scrapeThreadDetail(url);
              const _cmtResult = await this.scraper.scrapeComments(url);
            const comments = Array.isArray(_cmtResult) ? _cmtResult : (_cmtResult && _cmtResult.comments ? _cmtResult.comments : []);
              await this.processAndSaveThread(threadData, 'auto_keyword', null, comments);
              this.stats.totalKeyword++;
            } catch (error) {
              this.logEvent(`Error scraping URL ${url}: ${error.message}`, 'error');
              this.stats.errors++;
            }
          }
        } catch (error) {
          this.logEvent(`Error in category ${category}: ${error.message}`, 'error');
          this.stats.errors++;
          // Browser may have crashed - force restart
          try { await this.scraper.close(); } catch(e) {}
        }
        // Delay between categories
        await new Promise(r => setTimeout(r, 3000));
      }

      // Phase 2: Profile-based collection (if profiles registered)
      const profiles = await this.getTrackedProfiles();
      for (const profile of profiles) {
        try {
          await this.runProfileCollection([profile.username]);
        } catch (error) {
          this.logEvent(`Error collecting profile ${profile.username}: ${error.message}`, 'error');
          this.stats.errors++;
        }
      }

      this.lastRunAt = new Date();
      this.nextRunAt = new Date(Date.now() + this.intervalHours * 60 * 60 * 1000);
      this.logEvent(
        `Auto collection completed. Collected: ${this.stats.totalKeyword + this.stats.totalProfile}, Affiliate found: ${this.stats.totalAffiliate}`,
        'success'
      );

      return {
        success: true,
        duration: Date.now() - startTime,
        stats: this.stats
      };
    } catch (error) {
      this.logEvent(`Auto collection failed: ${error.message}`, 'error');
      this.stats.errors++;
      return { success: false, error: error.message };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Scrape registered profiles
   */
  async runProfileCollection(usernames) {
    if (!usernames || usernames.length === 0) {
      return { success: false, message: 'No usernames provided' };
    }

    const collectedCount = { success: 0, failed: 0 };

    try {
      for (const username of usernames) {
        try {
          this.logEvent(`Scraping profile: ${username}`, 'info');
          const _profResult = await this.scraper.scrapeProfile(username);
          const threadUrls = (_profResult && _profResult.threads) ? _profResult.threads.map(t => t.url || t) : [];

          for (const url of threadUrls) {
            try {
              const threadData = await this.scraper.scrapeThreadDetail(url);
              const _cmtResult2 = await this.scraper.scrapeComments(url);
            const comments = Array.isArray(_cmtResult2) ? _cmtResult2 : (_cmtResult2 && _cmtResult2.comments ? _cmtResult2.comments : []);
              await this.processAndSaveThread(threadData, 'auto_profile', username, comments);
              collectedCount.success++;
              this.stats.totalProfile++;
            } catch (error) {
              this.logEvent(`Error scraping URL ${url}: ${error.message}`, 'error');
              collectedCount.failed++;
              this.stats.errors++;
            }
          }
        } catch (error) {
          this.logEvent(`Error scraping profile ${username}: ${error.message}`, 'error');
          collectedCount.failed++;
          this.stats.errors++;
        }
      }

      return { success: true, collected: collectedCount };
    } catch (error) {
      this.logEvent(`Profile collection failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Manual collection: collects all since last run
   */
  async runManualCollection(usernames) {
    if (!usernames || usernames.length === 0) {
      return { success: false, message: 'No usernames provided' };
    }

    const collectedCount = { success: 0, failed: 0 };

    try {
      for (const username of usernames) {
        try {
          this.logEvent(`Manual collection from: ${username}`, 'info');
          const _profResult = await this.scraper.scrapeProfile(username);
          const threadUrls = (_profResult && _profResult.threads) ? _profResult.threads.map(t => t.url || t) : [];

          for (const url of threadUrls) {
            try {
              const threadData = await this.scraper.scrapeThreadDetail(url);
              const _cmtResult3 = await this.scraper.scrapeComments(url);
            const comments = Array.isArray(_cmtResult3) ? _cmtResult3 : (_cmtResult3 && _cmtResult3.comments ? _cmtResult3.comments : []);
              await this.processAndSaveThread(threadData, 'manual', username, comments);
              collectedCount.success++;
              this.stats.totalCollected++;
            } catch (error) {
              this.logEvent(`Error scraping URL ${url}: ${error.message}`, 'error');
              collectedCount.failed++;
              this.stats.errors++;
            }
          }
        } catch (error) {
          this.logEvent(`Error in manual collection for ${username}: ${error.message}`, 'error');
          collectedCount.failed++;
          this.stats.errors++;
        }
      }

      return { success: true, collected: collectedCount };
    } catch (error) {
      this.logEvent(`Manual collection failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Process and save a single thread
   */
  async processAndSaveThread(threadData, source, username = null, comments = []) {
    try {
      // Generate threadId from URL if missing
      if (!threadData.threadId && threadData.url) {
        const postMatch = threadData.url.match(/\/post\/([A-Za-z0-9_-]+)/);
        threadData.threadId = postMatch ? postMatch[1] : ('thread_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      }
      if (!threadData.threadId) {
        threadData.threadId = 'thread_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      }

      // Clean text for processing
      const cleanText = this.cleanText(threadData.text);

      // Detect region
      const region = this.detectRegion(cleanText);

      // Detect affiliate links
      const affiliateInfo = this.detectAffiliateLinks(cleanText, threadData.urls || [], comments || []);

      // Classify category
      const category = this.classifyCategory(cleanText);

      // Calculate view tier
      const viewTier = Thread.calcViewTier(threadData.viewCount || 0);

      // Check for duplicates
      const existingThread = await Thread.findOne({ threadId: threadData.threadId });
      if (existingThread) {
        this.logEvent(`Duplicate thread found: ${threadData.threadId}`, 'debug');
        return null;
      }

      // Extract author from threadData or URL
      const authorName = threadData.author || username || '';
      const authorFromUrl = threadData.url ? (threadData.url.match(/@([\w.]+)/) || [])[1] || '' : '';
      const finalAuthor = authorName || authorFromUrl || 'unknown';

      // Prepare thread document matching Thread model schema
      const threadDoc = new Thread({
        threadId: threadData.threadId,
        platform: 'threads',
        originalUrl: threadData.url || '',
        author: {
          username: finalAuthor,
          displayName: threadData.displayName || finalAuthor,
          profilePicUrl: threadData.profilePicUrl || '',
        },
        content: {
          text: cleanText,
          mediaType: threadData.mediaType || 'text',
          mediaUrls: threadData.mediaUrls || [],
          thumbnailUrl: threadData.imageUrl || '',
          urls: threadData.externalLinks || threadData.urls || [],
          hashtags: (cleanText.match(/#[\w\uAC00-\uD7AF]+/g) || []),
          mentions: (cleanText.match(/@[\w.]+/g) || []),
        },
        category: {
          primary: ['shopping', 'issue', 'personal', 'uncategorized'].includes(category) ? category : 'uncategorized',
          classifiedBy: 'rule',
          classifiedAt: new Date(),
        },
        region: region,
        viewTier: viewTier,
        collectionSource: source,
        affiliate: {
          hasAffiliate: affiliateInfo.hasAffiliate,
          links: affiliateInfo.links.map(l => ({
            url: l.url || l,
            platform: l.platform || 'other',
          })),
        },
        metrics: {
          likes: threadData.likes || threadData.likeCount || 0,
          replies: threadData.replies || threadData.replyCount || 0,
          reposts: threadData.reposts || threadData.shareCount || 0,
          views: threadData.viewCount || 0,
        },
        source: 'scraper',
        createdAt: threadData.timestamp || threadData.createdAt || new Date(),
        collectedAt: new Date(),
      });

      await threadDoc.save();

      // Update stats
      this.stats.totalCollected++;
      if (affiliateInfo.hasAffiliate) {
        this.stats.totalAffiliate++;
      }

      this.logEvent(`Thread saved: ${threadData.threadId} by @${finalAuthor} (Category: ${category}, Region: ${region})`, 'debug');

      return threadDoc;
    } catch (error) {
      this.logEvent(`Error processing thread: ${error.message}`, 'error');
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Detect region based on Korean character ratio
   */
  detectRegion(text) {
    if (!text) return 'unknown';

    // Count Korean characters (Hangul range: U+AC00 to U+D7AF)
    const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
    const totalChars = text.length;
    const koreanRatio = totalChars > 0 ? (koreanChars / totalChars) * 100 : 0;

    return koreanRatio > 10 ? 'korean' : 'overseas';
  }

  /**
   * Clean text for region detection and processing
   */
  cleanText(text) {
    if (!text) return '';
    // Remove URLs, special UI elements, emojis
    return text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^\w\s\uAC00-\uD7AF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Classify thread category by keywords
   */
  classifyCategory(text) {
    if (!text) return 'uncategorized';

    const lowerText = text.toLowerCase();

    // Check each category
    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      const matches = keywords.filter(keyword =>
        lowerText.includes(keyword.toLowerCase())
      );
      if (matches.length > 0) {
        return category;
      }
    }

    return 'uncategorized';
  }

  /**
   * Detect affiliate links in text, URLs, and comments
   */
  detectAffiliateLinks(text, urls = [], comments = []) {
    const links = [];
    let hasAffiliate = false;

    // Check content text
    for (const [platform, patterns] of Object.entries(this.affiliatePatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          links.push({
            url: 'inline',
            platform: platform,
            detectedIn: 'text'
          });
          hasAffiliate = true;
        }
      }
    }

    // Check URLs
    for (const url of urls) {
      for (const [platform, patterns] of Object.entries(this.affiliatePatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(url)) {
            links.push({
              url: url,
              platform: platform,
              detectedIn: 'url'
            });
            hasAffiliate = true;
          }
        }
      }
    }

    // Check comment links
    for (const comment of comments) {
      const commentUrls = (comment.text || '').match(/https?:\/\/\S+/g) || [];
      const commentText = comment.text || '';

      for (const url of commentUrls) {
        for (const [platform, patterns] of Object.entries(this.affiliatePatterns)) {
          for (const pattern of patterns) {
            if (pattern.test(url)) {
              links.push({
                url: url,
                platform: platform,
                detectedIn: 'comment'
              });
              hasAffiliate = true;
            }
          }
        }
      }

      // Also check comment text
      for (const [platform, patterns] of Object.entries(this.affiliatePatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(commentText)) {
            links.push({
              url: 'inline',
              platform: platform,
              detectedIn: 'comment'
            });
            hasAffiliate = true;
          }
        }
      }
    }

    return {
      hasAffiliate: hasAffiliate,
      links: [...new Set(links.map(l => JSON.stringify(l)))].map(l => JSON.parse(l))
    };
  }

  /**
   * Get collection status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      intervalHours: this.intervalHours,
      totalCollected: this.stats.totalCollected,
      totalKeyword: this.stats.totalKeyword,
      totalProfile: this.stats.totalProfile,
      totalAffiliate: this.stats.totalAffiliate,
      totalErrors: this.stats.errors,
      recentLogs: this.logs.slice(-20)
    };
  }

  /**
   * Add profile to tracking list
   */
  async addTrackedProfile(username) {
    try {
      // In production, this would save to a database collection
      // For now, returning success
      this.logEvent(`Profile added to tracking: ${username}`, 'info');
      return { success: true, username };
    } catch (error) {
      this.logEvent(`Error adding profile: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Get tracked profiles
   */
  async getTrackedProfiles() {
    try {
      // In production, this would fetch from a database collection
      // For now, returning empty array
      return [];
    } catch (error) {
      this.logEvent(`Error fetching profiles: ${error.message}`, 'error');
      return [];
    }
  }

  /**
   * Remove profile from tracking
   */
  async removeTrackedProfile(username) {
    try {
      // In production, this would delete from database
      this.logEvent(`Profile removed from tracking: ${username}`, 'info');
      return { success: true, username };
    } catch (error) {
      this.logEvent(`Error removing profile: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Log collection event
   */
  logEvent(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message
    };

    this.logs.push(logEntry);

    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Console output for debugging
    if (level === 'error' || level === 'success') {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * Reset stats
   */
  resetStats() {
    this.stats = {
      totalCollected: 0,
      totalKeyword: 0,
      totalProfile: 0,
      totalAffiliate: 0,
      errors: 0
    };
  }
}

export default CollectorEngine;
