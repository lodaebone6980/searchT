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
      shopping: ['ì¿ í¡ í ì¸', 'í«ë ì¶ì²', 'ìë¦¬ í ì¸', 'ìë§ì¡´ ì§êµ¬', 'ì¼í ì¶ì²', 'ë§í¬ í ì¸'],
      issue: ['ìë³´', 'ë¼ë', 'íì  ì¤ìê°', 'ì´ì ì ë¦¬', 'breaking news'],
      personal: ['í ê³µì ', 'ë¸íì°', 'í¬í¸í´ë¦¬ì¤ ê³µê°']
    };

    // Category keywords for classification
    this.categoryKeywords = {
      shopping: ['í ì¸', 'ì¿ í°', 'í«ë', 'ì¸ì¼', 'ìµì ê°', 'ì¶ì²í', 'ë¦¬ë·°', 'êµ¬ë§¤', 'ë°°ì¡', 'ì§êµ¬', 'ê°ì±ë¹', 'ì¸ë°ì±'],
      issue: ['ìë³´', 'ë¼ë', 'ê¸´ê¸', 'íì ', 'ì´ì', 'ë´ì¤', 'ê·ì ', 'ì ê±°', 'ì ì¹', 'ê²½ì ', 'ì¬ê±´'],
      personal: ['í', 'ë¸íì°', 'ë°©ë²', 'ì ëµ', 'ê²½í', 'í¬í¸í´ë¦¬ì¤', 'ê°ì', 'ê°ì´ë']
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
   * Full auto collection cycle: keyword search â profile scrape â save to DB
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
              const comments = await this.scraper.scrapeComments(url);
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
              const comments = await this.scraper.scrapeComments(url);
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
              const comments = await this.scraper.scrapeComments(url);
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

      // Prepare thread document
      const threadDoc = new Thread({
        threadId: threadData.threadId,
        author: threadData.author,
        username: username || threadData.username,
        text: cleanText,
        urls: threadData.urls || [],
        viewCount: threadData.viewCount || 0,
        replyCount: threadData.replyCount || 0,
        likeCount: threadData.likeCount || 0,
        shareCount: threadData.shareCount || 0,
        createdAt: threadData.createdAt || new Date(),
        region: region,
        category: category,
        viewTier: viewTier,
        hasAffiliate: affiliateInfo.hasAffiliate,
        affiliateLinks: affiliateInfo.links,
        collectionSource: source,
        collectionDate: new Date(),
        comments: comments
      });

      await threadDoc.save();

      // Update stats
      this.stats.totalCollected++;
      if (affiliateInfo.hasAffiliate) {
        this.stats.totalAffiliate++;
      }

      this.logEvent(`Thread saved: ${threadData.threadId} (Category: ${category}, Region: ${region})`, 'debug');

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
    if (!text) return 'other';

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

    return 'other';
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
