import express from 'express';
import Thread from '../models/Thread.js';
import ThreadsScraper from '../services/ThreadsScraper.js';
import CollectorEngine from '../services/CollectorEngine.js';

const router = express.Router();

// Initialize collector engine singleton
const collectorEngine = new CollectorEngine();

// Export engine for use in index.js scheduler
export const engine = collectorEngine;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clean text for region detection
 */
function cleanForRegionDetect(text) {
  if (!text) return '';
  // Remove URLs, special UI elements
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s\uAC00-\uD7AF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect region based on Korean character ratio
 */
function detectRegion(text) {
  if (!text) return 'unknown';
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const totalChars = text.length;
  const koreanRatio = totalChars > 0 ? (koreanChars / totalChars) * 100 : 0;
  return koreanRatio > 10 ? 'korean' : 'overseas';
}

/**
 * Classify category by keywords
 */
function classifyCategory(text) {
  if (!text) return 'other';

  const categoryKeywords = {
    shopping: ['할인', '쿠폰', '핫딜', '세일', '최저가', '추천템', '리뷰', '구매', '배송', '직구', '가성비', '언박싱'],
    issue: ['속보', '논란', '긴급', '화제', '이슈', '뉴스', '규제', '선거', '정치', '경제', '사건'],
    personal: ['팁', '노하우', '방법', '전략', '경험', '포트폴리오', '강의', '가이드']
  };

  const lowerText = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
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
 * Detect affiliate links in content
 */
function detectAffiliateLinks(text, urls = []) {
  const affiliatePatterns = {
    coupang: [/link\.coupang\.com/i, /coupa\.ng/i],
    aliexpress: [/ali\.ski/i, /s\.click\.aliexpress\.com/i, /aliexpress\.com/i],
    amazon: [/amzn\.to/i, /amazon\.com\/dp/i, /tag=/i],
    rakuten: [/a\.r10\.to/i, /rakuten/i]
  };

  const links = [];
  let hasAffiliate = false;

  // Check text
  for (const [platform, patterns] of Object.entries(affiliatePatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        links.push({ url: 'inline', platform, detectedIn: 'text' });
        hasAffiliate = true;
      }
    }
  }

  // Check URLs
  for (const url of urls) {
    for (const [platform, patterns] of Object.entries(affiliatePatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(url)) {
          links.push({ url, platform, detectedIn: 'url' });
          hasAffiliate = true;
        }
      }
    }
  }

  return {
    hasAffiliate,
    links: [...new Set(links.map(l => JSON.stringify(l)))].map(l => JSON.parse(l))
  };
}

// ============================================================================
// STATS ENDPOINTS
// ============================================================================

/**
 * GET /stats - Dashboard overview
 */
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get total count
    const total = await Thread.countDocuments();

    // Get today's count
    const todayCount = await Thread.countDocuments({
      collectionDate: { $gte: today }
    });

    // Get domestic vs overseas
    const domestic = await Thread.countDocuments({ region: 'korean' });
    const overseas = await Thread.countDocuments({ region: 'overseas' });

    // Get view tier distribution
    const viewTierDist = await Thread.aggregate([
      {
        $group: {
          _id: '$viewTier',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Format view tier distribution
    const viewTierMap = {};
    viewTierDist.forEach(tier => {
      viewTierMap[tier._id || 'unknown'] = tier.count;
    });

    // Get by category
    const byCategory = await Thread.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    const categoryMap = {};
    byCategory.forEach(cat => {
      categoryMap[cat._id || 'other'] = cat.count;
    });

    // Get affiliate count
    const affiliateCount = await Thread.countDocuments({ hasAffiliate: true });

    res.json({
      total,
      today: todayCount,
      domestic,
      overseas,
      affiliate: affiliateCount,
      viewTierDist: viewTierMap,
      byCat: categoryMap,
      autoCollectStatus: collectorEngine.getStatus()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// THREADS ENDPOINTS
// ============================================================================

/**
 * GET /threads - List threads with filters
 */
router.get('/threads', async (req, res) => {
  try {
    const {
      category = 'all',
      region = 'all',
      viewTier = 'all',
      search = '',
      sort = 'latest',
      page = 1,
      limit = 20
    } = req.query;

    // Build filter
    const filter = {};

    if (category !== 'all') {
      filter.category = category;
    }

    if (region !== 'all') {
      filter.region = region;
    }

    if (viewTier !== 'all') {
      filter.viewTier = viewTier;
    }

    if (search) {
      filter.$or = [
        { text: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort
    let sortObj = { createdAt: -1 };
    if (sort === 'popular') {
      sortObj = { likeCount: -1, createdAt: -1 };
    } else if (sort === 'engagement') {
      sortObj = {
        $expr: {
          $add: ['$replyCount', '$likeCount', '$shareCount']
        }
      };
    } else if (sort === 'views') {
      sortObj = { viewCount: -1, createdAt: -1 };
    } else if (sort === 'replies') {
      sortObj = { replyCount: -1, createdAt: -1 };
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const threads = await Thread.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await Thread.countDocuments(filter);

    res.json({
      data: threads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching threads:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// COLLECTOR ENDPOINTS
// ============================================================================

/**
 * POST /collector/scrape - Manual scrape by usernames
 */
router.post('/collector/scrape', async (req, res) => {
  try {
    const { usernames } = req.body;

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: 'usernames array required' });
    }

    const scraper = new ThreadsScraper();
    const results = { success: 0, failed: 0, threads: [] };

    for (const username of usernames) {
      try {
        const threadUrls = await scraper.scrapeProfileThreads(username);

        for (const url of threadUrls) {
          try {
            const threadData = await scraper.scrapeThreadDetail(url);
            const comments = await scraper.scrapeComments(url);

            // Clean and process
            const cleanText = cleanForRegionDetect(threadData.text);
            const region = detectRegion(cleanText);
            const category = classifyCategory(cleanText);
            const viewTier = Thread.calcViewTier(threadData.viewCount || 0);
            const affiliateInfo = detectAffiliateLinks(cleanText, threadData.urls || []);

            // Check for duplicate
            const existing = await Thread.findOne({ threadId: threadData.threadId });
            if (existing) {
              continue;
            }

            // Save thread
            const threadDoc = new Thread({
              threadId: threadData.threadId,
              author: threadData.author,
              username: username,
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
              collectionSource: 'manual',
              collectionDate: new Date(),
              comments: comments
            });

            await threadDoc.save();
            results.success++;
            results.threads.push({
              threadId: threadDoc.threadId,
              author: threadDoc.author,
              category: threadDoc.category
            });
          } catch (error) {
            console.error(`Error processing thread ${url}:`, error);
            results.failed++;
          }
        }
      } catch (error) {
        console.error(`Error scraping profile ${username}:`, error);
        results.failed++;
      }
    }

    res.json({
      success: results.success > 0,
      data: results
    });
  } catch (error) {
    console.error('Error in manual scrape:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /collector/auto-run - Trigger auto collection manually
 */
router.post('/collector/auto-run', async (req, res) => {
  try {
    const result = await collectorEngine.runAutoCollection();
    res.json(result);
  } catch (error) {
    console.error('Error in auto-run:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /collector/status - Auto collection engine status
 */
router.get('/collector/status', (req, res) => {
  try {
    const status = collectorEngine.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /collector/profiles - Add profile to auto-track list
 */
router.post('/collector/profiles', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'username required' });
    }

    const result = await collectorEngine.addTrackedProfile(username);
    res.json(result);
  } catch (error) {
    console.error('Error adding profile:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /collector/profiles - List tracked profiles
 */
router.get('/collector/profiles', async (req, res) => {
  try {
    const profiles = await collectorEngine.getTrackedProfiles();
    res.json({ data: profiles });
  } catch (error) {
    console.error('Error fetching profiles:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /collector/profiles/:username - Remove profile from tracking
 */
router.delete('/collector/profiles/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await collectorEngine.removeTrackedProfile(username);
    res.json(result);
  } catch (error) {
    console.error('Error removing profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SEED ENDPOINTS
// ============================================================================

/**
 * POST /seed-demo - Seed demo data
 */
router.post('/seed-demo', async (req, res) => {
  try {
    const demoThreads = [
      {
        threadId: 'demo-001',
        author: 'Demo User 1',
        username: 'demouser1',
        text: '쿠팡 핫딜 세일 지금 바로 최저가로 구매하세요. 배송 빠릅니다!',
        urls: ['https://link.coupang.com/demo'],
        viewCount: 2500,
        replyCount: 45,
        likeCount: 120,
        shareCount: 30,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        region: 'korean',
        category: 'shopping',
        viewTier: '1k',
        hasAffiliate: true,
        affiliateLinks: [{ url: 'https://link.coupang.com/demo', platform: 'coupang', detectedIn: 'url' }],
        collectionSource: 'demo',
        collectionDate: new Date(),
        comments: []
      },
      {
        threadId: 'demo-002',
        author: 'Demo User 2',
        username: 'demouser2',
        text: '아마존 직구 후기 공유합니다. 가성비 정말 좋네요!',
        urls: ['https://amzn.to/demo'],
        viewCount: 8750,
        replyCount: 156,
        likeCount: 450,
        shareCount: 85,
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        region: 'korean',
        category: 'shopping',
        viewTier: '5k',
        hasAffiliate: true,
        affiliateLinks: [{ url: 'https://amzn.to/demo', platform: 'amazon', detectedIn: 'url' }],
        collectionSource: 'demo',
        collectionDate: new Date(),
        comments: []
      },
      {
        threadId: 'demo-003',
        author: 'Demo User 3',
        username: 'demouser3',
        text: '속보) 새로운 정책 발표 관련 이슈 정리했습니다.',
        urls: [],
        viewCount: 45000,
        replyCount: 520,
        likeCount: 1200,
        shareCount: 340,
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        region: 'korean',
        category: 'issue',
        viewTier: '10k',
        hasAffiliate: false,
        affiliateLinks: [],
        collectionSource: 'demo',
        collectionDate: new Date(),
        comments: []
      },
      {
        threadId: 'demo-004',
        author: 'Demo User 4',
        username: 'demouser4',
        text: '개인적인 팁: 생산성 높이는 방법들을 공유합니다.',
        urls: [],
        viewCount: 15600,
        replyCount: 234,
        likeCount: 680,
        shareCount: 120,
        createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        region: 'korean',
        category: 'personal',
        viewTier: '10k',
        hasAffiliate: false,
        affiliateLinks: [],
        collectionSource: 'demo',
        collectionDate: new Date(),
        comments: []
      },
      {
        threadId: 'demo-005',
        author: 'Demo User 5',
        username: 'demouser5',
        text: 'Check out this amazing tech review from overseas.',
        urls: [],
        viewCount: 5200,
        replyCount: 89,
        likeCount: 210,
        shareCount: 45,
        createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        region: 'overseas',
        category: 'other',
        viewTier: '5k',
        hasAffiliate: false,
        affiliateLinks: [],
        collectionSource: 'demo',
        collectionDate: new Date(),
        comments: []
      }
    ];

    // Clear existing demo data
    await Thread.deleteMany({ collectionSource: 'demo' });

    // Insert demo threads
    const inserted = await Thread.insertMany(demoThreads);

    res.json({
      success: true,
      message: `Seeded ${inserted.length} demo threads`,
      data: inserted
    });
  } catch (error) {
    console.error('Error seeding demo data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /threads/all - Clear all threads
 */

  // ============================================================
  // POST /threads/batch-collect - Chrome 확장프로그램 배치 수집
  // ============================================================
  router.post('/threads/batch-collect', async (req, res) => {
    try {
      const { threads } = req.body;

      if (!Array.isArray(threads) || threads.length === 0) {
        return res.status(400).json({ error: 'threads 배열이 필요합니다' });
      }

      const results = { collectedCount: 0, duplicateCount: 0, errorCount: 0, errors: [] };

      for (const threadData of threads) {
        try {
          if (!threadData.threadId) {
            results.errorCount++;
            results.errors.push({ error: 'threadId 누락' });
            continue;
          }

          // 중복 체크
          const existing = await Thread.findOne({ threadId: threadData.threadId });
          if (existing) {
            results.duplicateCount++;
            continue;
          }

          // Thread 문서 생성 (확장프로그램에서 이미 분류된 데이터)
          const validCategories = ['shopping', 'issue', 'personal', 'uncategorized'];
          const validRegions = ['domestic', 'overseas'];
          const validViewTiers = ['under1k', '1k', '5k', '10k', '50k', '100k'];

          const threadDoc = new Thread({
            threadId: threadData.threadId,
            platform: threadData.platform || 'threads',
            originalUrl: threadData.originalUrl || '',
            author: {
              username: threadData.author?.username || 'unknown',
              displayName: threadData.author?.displayName || threadData.author?.username || '',
              profilePicUrl: threadData.author?.profilePicUrl || '',
              isVerified: threadData.author?.isVerified || false,
              followerCount: threadData.author?.followerCount || 0,
            },
            content: {
              text: threadData.content?.text || '',
              mediaType: threadData.content?.mediaType || 'text',
              mediaUrls: threadData.content?.mediaUrls || [],
              thumbnailUrl: threadData.content?.thumbnailUrl || '',
              urls: threadData.content?.urls || [],
              hashtags: threadData.content?.hashtags || [],
              mentions: threadData.content?.mentions || [],
            },
            category: {
              primary: validCategories.includes(threadData.category?.primary) ? threadData.category.primary : 'uncategorized',
              confidence: threadData.category?.confidence || 0,
              classifiedBy: threadData.category?.classifiedBy || 'rule',
              classifiedAt: threadData.category?.classifiedAt || new Date(),
            },
            region: validRegions.includes(threadData.region) ? threadData.region : 'domestic',
            viewTier: validViewTiers.includes(threadData.viewTier) ? threadData.viewTier : 'under1k',
            collectionSource: 'api',
            affiliate: {
              hasAffiliate: threadData.affiliate?.hasAffiliate || false,
              links: (threadData.affiliate?.links || []).map(l => ({
                url: l.url || '',
                platform: l.platform || 'other',
              })),
            },
            metrics: {
              likes: threadData.metrics?.likes || 0,
              replies: threadData.metrics?.replies || 0,
              reposts: threadData.metrics?.reposts || 0,
              views: threadData.metrics?.views || 0,
            },
            source: 'extension',
            collectedAt: threadData.collectedAt || new Date(),
          });

          await threadDoc.save();
          results.collectedCount++;

        } catch (error) {
          results.errorCount++;
          results.errors.push({ threadId: threadData.threadId, error: error.message });
        }
      }

      res.json({ success: true, ...results });

    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

router.delete('/threads/all', async (req, res) => {
  try {
    const result = await Thread.deleteMany({});

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} threads`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting threads:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
