import express from 'express';
import Thread from '../models/Thread.js';
import Profile from '../models/Profile.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ── Stats Overview ──
router.get('/stats/overview', async (req, res) => {
  try {
    const total = await Thread.countDocuments();
    const today = await Thread.countDocuments({ collectedAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } });
    const profiles = await Profile.countDocuments();
    const affiliateCount = await Thread.countDocuments({ 'affiliate.hasAffiliate': true });
    const deleted = await Thread.countDocuments({ 'deletion.isDeleted': true });
    const byCat = await Thread.aggregate([
      { $group: { _id: '$category.primary', count: { $sum: 1 } } }
    ]);
    const bySentiment = await Thread.aggregate([
      { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
    ]);
    const byPlatform = await Thread.aggregate([
      { $match: { 'affiliate.hasAffiliate': true } },
      { $unwind: '$affiliate.links' },
      { $group: { _id: '$affiliate.links.platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json({ success: true, stats: { total, today, profiles, affiliateCount, deleted, byCat, bySentiment, byPlatform } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Get Threads (with filters) ──
router.get('/threads', async (req, res) => {
  try {
    const { category, search, sort, limit = 50, page = 1, includeDeleted } = req.query;
    const filter = {};
    if (category && category !== 'all') filter['category.primary'] = category;
    if (search) filter['content.text'] = { $regex: search, $options: 'i' };
    if (includeDeleted !== 'true') filter['deletion.isDeleted'] = { $ne: true };
    const sortMap = { latest: { collectedAt: -1 }, popular: { 'metrics.likes': -1 }, engagement: { 'metrics.engagementRate': -1 }, replies: { 'metrics.replies': -1 } };
    const sortOpt = sortMap[sort] || sortMap.latest;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const threads = await Thread.find(filter).sort(sortOpt).skip(skip).limit(parseInt(limit));
    const total = await Thread.countDocuments(filter);
    res.json({ success: true, threads, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Trending Keywords ──
router.get('/stats/trending', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24*60*60*1000);
    const result = await Thread.aggregate([
      { $match: { collectedAt: { $gte: since } } },
      { $unwind: '$analysis.keywords' },
      { $group: { _id: '$analysis.keywords', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);
    res.json({ success: true, keywords: result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Manual Collect Trigger ──
router.post('/collector/run', async (req, res) => {
  try {
    const engine = req.app.get('collectorEngine');
    if (engine) {
      engine.runOnce().catch(e => logger.error('Manual collect error', e));
      res.json({ success: true, message: 'Collection started' });
    } else {
      res.json({ success: true, message: 'No collector engine configured' });
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Collector Status ──
router.get('/collector/status', async (req, res) => {
  try {
    const engine = req.app.get('collectorEngine');
    const status = engine ? { running: engine.isRunning, totalCollected: engine.totalCollected || 0, errors: engine.errorCount || 0 } : { running: false, totalCollected: 0, errors: 0 };
    res.json({ success: true, ...status });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Profiles ──
router.get('/profiles', async (req, res) => {
  try {
    const profiles = await Profile.find().sort({ 'tracking.lastCollectedAt': -1 });
    res.json({ success: true, profiles });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/profiles', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'username required' });
    const existing = await Profile.findOne({ username: username.replace('@','') });
    if (existing) return res.json({ success: true, profile: existing, message: 'Already tracking' });
    const profile = await Profile.create({ username: username.replace('@',''), tracking: { isActive: true } });
    res.json({ success: true, profile });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Seed Demo Data (rich, realistic) ──
router.post('/seed-demo', async (req, res) => {
  try {
    await Thread.deleteMany({});
    const now = new Date();
    const h = (n) => new Date(now.getTime() - n*60*60*1000);
    const threads = [
      { threadId: 'thread_ali_001', originalUrl: 'https://www.threads.net/@deal_hunter_kr/post/abc1',
        author: { username: 'deal_hunter_kr', displayName: '\ud574\uc678\uc9c1\uad6c \ub9c8\uc2a4\ud130', profilePicUrl: 'https://picsum.photos/seed/ali1/100', followerCount: 45200, isVerified: false },
        content: { text: '\ud83d\udd25 \uc54c\ub9ac \uc5ed\ub300\uae09 \ud560\uc778! \uc5d0\uc5b4\ud31f \ub9e5\uc2a4 \ud638\ud658 \ucf00\uc774\uc2a4 $2.99 \ub9c1\ud06c\ub294 \ud504\ub85c\ud544\uc5d0! #\uc54c\ub9ac\uc775\uc2a4\ud504\ub808\uc2a4 #\ud560\uc778 #\uc5d0\uc5b4\ud31f\ub9e5\uc2a4',
          mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/airpod1/600/400','https://picsum.photos/seed/airpod2/600/400'], thumbnailUrl: 'https://picsum.photos/seed/airpod1/300/200',
          hashtags: ['\uc54c\ub9ac\uc775\uc2a4\ud504\ub808\uc2a4','\ud560\uc778','\uc5d0\uc5b4\ud31f\ub9e5\uc2a4'], urls: ['https://ali.ski/abc123'] },
        category: { primary: 'shopping', sub: 'AliExpress', confidence: 0.95, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: true, links: [{ url: 'https://ali.ski/abc123', platform: 'aliexpress', shortUrl: 'ali.ski/abc123', detectedIn: 'content' }] },
        metrics: { likes: 2340, replies: 189, reposts: 567, engagementRate: 94 },
        analysis: { sentiment: 'positive', keywords: ['\uc54c\ub9ac','\ud560\uc778','\uc5d0\uc5b4\ud31f','\ub9e5\uc2a4','\ucf00\uc774\uc2a4'], viralScore: 82 },
        publishedAt: h(2), collectedAt: h(1), source: 'scraper' },

      { threadId: 'thread_cpg_001', originalUrl: 'https://www.threads.net/@coupang_picks/post/abc2',
        author: { username: 'coupang_picks', displayName: '\ucfe0\ud321 \ud575\ub51c \uc815\ubcf4', profilePicUrl: 'https://picsum.photos/seed/cpg1/100', followerCount: 89300, isVerified: true },
        content: { text: '\ud83d\udce6 \ucfe0\ud321 \ub85c\ucf13\ubc30\uc1a1 \uc624\ub298\uc758 \ud575\ub51c TOP5 \uc815\ub9ac\ud588\uc2b5\ub2c8\ub2e4! \ub313\uae00\uc5d0 \ub9c1\ud06c \uc788\uc5b4\uc694 #\ucfe0\ud321 #\ud575\ub51c #\ub85c\ucf13\ubc30\uc1a1',
          mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/cpg2/600/400','https://picsum.photos/seed/cpg3/600/400','https://picsum.photos/seed/cpg4/600/400'], thumbnailUrl: 'https://picsum.photos/seed/cpg2/300/200',
          hashtags: ['\ucfe0\ud321','\ud575\ub51c','\ub85c\ucf13\ubc30\uc1a1'], urls: ['https://link.coupang.com/xyz789'] },
        category: { primary: 'shopping', sub: '\ucfe0\ud321\ud30c\ud2b8\ub108\uc2a4', confidence: 0.98, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/xyz789', platform: 'coupang', shortUrl: 'link.coupang.com/xyz789', detectedIn: 'content' }] },
        metrics: { likes: 1890, replies: 312, reposts: 445, engagementRate: 88 },
        analysis: { sentiment: 'positive', keywords: ['\ucfe0\ud321','\ud575\ub51c','\ub85c\ucf13\ubc30\uc1a1','TOP5'], viralScore: 76 },
        publishedAt: h(3), collectedAt: h(2), source: 'scraper' },

      { threadId: 'thread_amz_001', originalUrl: 'https://www.threads.net/@us_deal_master/post/abc3',
        author: { username: 'us_deal_master', displayName: '\ubbf8\uad6d\uc9c1\uad6c \ub2ec\uc778', profilePicUrl: 'https://picsum.photos/seed/amz1/100', followerCount: 67800, isVerified: false },
        content: { text: '\ud83c\uddfa\ud83c\uddf8 \uc544\ub9c8\uc874 \ud504\ub77c\uc784\ub370\uc774 \uc0ac\uc804 \ud560\uc778 \uc2dc\uc791! \uac24\ub7ed\uc2dc \ubc84\uc9883 \ud504\ub85c \uc5ed\ub300 \ucd5c\uc800\uac00 #\uc544\ub9c8\uc874 #\ud504\ub77c\uc784\ub370\uc774 #\uac24\ub7ed\uc2dc\ubc84\uc988',
          mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/amzv/600/400'], thumbnailUrl: 'https://picsum.photos/seed/amzv/300/200', videoUrl: 'https://example.com/video1.mp4',
          hashtags: ['\uc544\ub9c8\uc874','\ud504\ub77c\uc784\ub370\uc774','\uac24\ub7ed\uc2dc\ubc84\uc988'], urls: ['https://amzn.to/def456'] },
        category: { primary: 'shopping', sub: 'Amazon', confidence: 0.96, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: true, links: [{ url: 'https://amzn.to/def456', platform: 'amazon', shortUrl: 'amzn.to/def456', detectedIn: 'content' }] },
        metrics: { likes: 3210, replies: 456, reposts: 789, engagementRate: 97 },
        analysis: { sentiment: 'positive', keywords: ['\uc544\ub9c8\uc874','\ud504\ub77c\uc784\ub370\uc774','\uac24\ub7ed\uc2dc','\ubc84\uc988','\ucd5c\uc800\uac00'], viralScore: 91 },
        publishedAt: h(4), collectedAt: h(3), source: 'scraper' },

      { threadId: 'thread_rktn_001', originalUrl: 'https://www.threads.net/@japan_deal_info/post/abc4',
        author: { username: 'japan_deal_info', displayName: '\uc77c\ubcf8\uc9c1\uad6c \uc815\ubcf4', profilePicUrl: 'https://picsum.photos/seed/jpn1/100', followerCount: 23400, isVerified: false },
        content: { text: '\ud83c\uddef\ud83c\uddf5 \ub77c\ucfe0\ud150 \uc288\ud37c\uc138\uc77c \uc2dc\uc791! \uc77c\ubcf8 \uc9c1\uad6c \ud544\uc218\ud15c \ub9ac\uc2a4\ud2b8 \uc5c5\ub370\uc774\ud2b8 #\ub77c\ucfe0\ud150 #\uc77c\ubcf8\uc9c1\uad6c',
          mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/rktn1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/rktn1/300/200',
          hashtags: ['\ub77c\ucfe0\ud150','\uc77c\ubcf8\uc9c1\uad6c'], urls: ['https://a.r10.to/ghi789'] },
        category: { primary: 'shopping', sub: 'Rakuten', confidence: 0.92, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: true, links: [{ url: 'https://a.r10.to/ghi789', platform: 'rakuten', shortUrl: 'a.r10.to/ghi789', detectedIn: 'content' }] },
        metrics: { likes: 1560, replies: 234, reposts: 445, engagementRate: 76 },
        analysis: { sentiment: 'positive', keywords: ['\ub77c\ucfe0\ud150','\uc77c\ubcf8','\uc9c1\uad6c','\uc138\uc77c'], viralScore: 65 },
        publishedAt: h(5), collectedAt: h(4), source: 'scraper' },

      { threadId: 'thread_ent_001', originalUrl: 'https://www.threads.net/@ent_news_live/post/abc5',
        author: { username: 'ent_news_live', displayName: '\uc5f0\uc608\ub274\uc2a4 \uc18d\ubcf4', profilePicUrl: 'https://picsum.photos/seed/ent1/100', followerCount: 234000, isVerified: true },
        content: { text: '\ud83c\udfa4 \uc18d\ubcf4: BTS \uc9c0\ubbfc \uc194\ub85c \uc6d4\ub4dc\ud22c\uc5b4 \uc77c\uc815 \uacf5\uac1c! \uc11c\uc6b8 \ucf58\uc11c\ud2b8 3\ud68c \ud655\uc815 #BTS #\uc9c0\ubbfc #\uc6d4\ub4dc\ud22c\uc5b4',
          mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/bts1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/bts1/300/200',
          hashtags: ['BTS','\uc9c0\ubbfc','\uc6d4\ub4dc\ud22c\uc5b4'] },
        category: { primary: 'issue', sub: '\uc5f0\uc608', confidence: 0.99, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 45200, replies: 8900, reposts: 12300, engagementRate: 99 },
        analysis: { sentiment: 'positive', keywords: ['BTS','\uc9c0\ubbfc','\uc6d4\ub4dc\ud22c\uc5b4','\uc11c\uc6b8','\ucf58\uc11c\ud2b8'], viralScore: 99 },
        publishedAt: h(1), collectedAt: h(0.5), source: 'scraper' },

      { threadId: 'thread_pol_001', originalUrl: 'https://www.threads.net/@politics_watch/post/abc6',
        author: { username: 'politics_watch', displayName: '\uc2dc\uc0ac\uc6cc\uce58', profilePicUrl: 'https://picsum.photos/seed/pol1/100', followerCount: 56700, isVerified: true },
        content: { text: '\ud83c\udfdb\ufe0f \uad6d\ud68c AI \uaddc\uc81c\ubc95\uc548 \ubcf8\ud68c\uc758 \ud1b5\uacfc... \uc5c5\uacc4 \ubc18\uc751 \uc5c7\uac08\ub824 #AI\uaddc\uc81c #\uad6d\ud68c #\ubc95\uc548\ud1b5\uacfc',
          mediaType: 'text', hashtags: ['AI\uaddc\uc81c','\uad6d\ud68c','\ubc95\uc548\ud1b5\uacfc'] },
        category: { primary: 'issue', sub: '\uc2dc\uc0ac', confidence: 0.91, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 8900, replies: 2340, reposts: 3400, engagementRate: 85 },
        analysis: { sentiment: 'neutral', keywords: ['AI','\uaddc\uc81c','\uad6d\ud68c','\ubc95\uc548','\ud1b5\uacfc'], viralScore: 78 },
        publishedAt: h(2), collectedAt: h(1), source: 'scraper' },

      { threadId: 'thread_eco_001', originalUrl: 'https://www.threads.net/@money_signal/post/abc7',
        author: { username: 'money_signal', displayName: '\ub9e4\ub2c8\uc2dc\uadf8\ub110', profilePicUrl: 'https://picsum.photos/seed/eco1/100', followerCount: 78900, isVerified: false },
        content: { text: '\ud83d\udcb0 \ubbf8 \uc5f0\uc900 \uae08\ub9ac \ub3d9\uacb0 \uc804\ub9dd \uc6b0\uc138... \ucf54\uc2a4\ud53c 3,200 \ub3cc\ud30c \uac00\ub2a5\uc131\uc740? #\uae08\ub9ac #\ucf54\uc2a4\ud53c #\uc5f0\uc900',
          mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/stock1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/stock1/300/200',
          hashtags: ['\uae08\ub9ac','\ucf54\uc2a4\ud53c','\uc5f0\uc900'] },
        category: { primary: 'issue', sub: '\uacbd\uc81c', confidence: 0.93, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 5600, replies: 890, reposts: 1200, engagementRate: 78 },
        analysis: { sentiment: 'neutral', keywords: ['\uae08\ub9ac','\ucf54\uc2a4\ud53c','\uc5f0\uc900','\ub3d9\uacb0'], viralScore: 72 },
        publishedAt: h(3), collectedAt: h(2), source: 'scraper' },

      { threadId: 'thread_tech_001', originalUrl: 'https://www.threads.net/@tech_insider_kr/post/abc8',
        author: { username: 'tech_insider_kr', displayName: '\ud14c\ud06c\uc778\uc0ac\uc774\ub354', profilePicUrl: 'https://picsum.photos/seed/tech1/100', followerCount: 123000, isVerified: true },
        content: { text: '\ud83d\udcbb OpenAI GPT-5 \ucd9c\uc2dc \uc784\ubc15\uc124... \uba40\ud2f0\ubaa8\ub2ec \uc131\ub2a5 \ub300\ud3ed \ud5a5\uc0c1 \uc608\uace0 #OpenAI #GPT5 #AI',
          mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/gpt5/600/400'], thumbnailUrl: 'https://picsum.photos/seed/gpt5/300/200',
          hashtags: ['OpenAI','GPT5','AI'] },
        category: { primary: 'issue', sub: 'IT/\ud14c\ud06c', confidence: 0.97, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 12400, replies: 3200, reposts: 5600, engagementRate: 92 },
        analysis: { sentiment: 'positive', keywords: ['OpenAI','GPT-5','\uba40\ud2f0\ubaa8\ub2ec','AI'], viralScore: 88 },
        publishedAt: h(4), collectedAt: h(3), source: 'scraper' },

      { threadId: 'thread_sport_001', originalUrl: 'https://www.threads.net/@sports_flash/post/abc9',
        author: { username: 'sports_flash', displayName: '\uc2a4\ud3ec\uce20\ud50c\ub798\uc2dc', profilePicUrl: 'https://picsum.photos/seed/spt1/100', followerCount: 189000, isVerified: true },
        content: { text: '\u26bd \uc190\ud765\ubbfc \uc2dc\uc98c 20\ud638\uace8 \ud3ed\ubc1c! EPL \ub4dd\uc810\uc655 \uacbd\uc7c1 \ubcf8\uaca9\ud654 #\uc190\ud765\ubbfc #EPL #\ub4dd\uc810\uc655',
          mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/son1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/son1/300/200',
          hashtags: ['\uc190\ud765\ubbfc','EPL','\ub4dd\uc810\uc655'] },
        category: { primary: 'issue', sub: '\uc2a4\ud3ec\uce20', confidence: 0.99, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 34500, replies: 5600, reposts: 8900, engagementRate: 96 },
        analysis: { sentiment: 'positive', keywords: ['\uc190\ud765\ubbfc','EPL','\ub4dd\uc810\uc655','20\ud638\uace8'], viralScore: 95 },
        publishedAt: h(1), collectedAt: h(0.5), source: 'scraper' },

      { threadId: 'thread_mkt_001', originalUrl: 'https://www.threads.net/@growth_hacker_jin/post/abc10',
        author: { username: 'growth_hacker_jin', displayName: '\uadf8\ub85c\uc2a4\ud574\ucee4 \uc9c4', profilePicUrl: 'https://picsum.photos/seed/mkt1/100', followerCount: 34500, isVerified: false },
        content: { text: '\ud83d\ude80 \uc2a4\ub808\ub4dc \uc54c\uace0\ub9ac\uc998 \uc644\uc804 \ubd84\uc11d! \ub3c4\ub2ec\ub960 300% \uc62c\ub9ac\ub294 5\uac00\uc9c0 \ud301 \uacf5\uac1c\ud569\ub2c8\ub2e4 #\ub9c8\ucf00\ud305 #\uc2a4\ub808\ub4dc #\uc54c\uace0\ub9ac\uc998',
          mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/mkt2/600/400','https://picsum.photos/seed/mkt3/600/400'], thumbnailUrl: 'https://picsum.photos/seed/mkt2/300/200',
          hashtags: ['\ub9c8\ucf00\ud305','\uc2a4\ub808\ub4dc','\uc54c\uace0\ub9ac\uc998'] },
        category: { primary: 'personal', sub: '\ub9c8\ucf00\ud305', confidence: 0.94, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 6700, replies: 890, reposts: 2300, engagementRate: 91 },
        analysis: { sentiment: 'positive', keywords: ['\uc2a4\ub808\ub4dc','\uc54c\uace0\ub9ac\uc998','\ub3c4\ub2ec\ub960','\ub9c8\ucf00\ud305'], viralScore: 84 },
        publishedAt: h(1), collectedAt: h(0.5), source: 'scraper' },

      { threadId: 'thread_inv_001', originalUrl: 'https://www.threads.net/@warren_kr/post/abc11',
        author: { username: 'warren_kr', displayName: '\ud55c\uad6d\uc758 \uc6cc\ub80c', profilePicUrl: 'https://picsum.photos/seed/inv1/100', followerCount: 98700, isVerified: false },
        content: { text: '\ud83d\udcc8 2026\ub144 \uc0c1\ubc18\uae30 \ud3ec\ud2b8\ud3f4\ub9ac\uc624 \ub9ac\ubc38\ub7f0\uc2f1 \uc804\ub7b5. \ubc18\ub3c4\uccb4 \ube44\uc911 \ud655\ub300 \uc774\uc720\ub294... #\ud22c\uc790 #\ud3ec\ud2b8\ud3f4\ub9ac\uc624 #\ubc18\ub3c4\uccb4',
          mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/inv2/600/400'], thumbnailUrl: 'https://picsum.photos/seed/inv2/300/200',
          hashtags: ['\ud22c\uc790','\ud3ec\ud2b8\ud3f4\ub9ac\uc624','\ubc18\ub3c4\uccb4'] },
        category: { primary: 'personal', sub: '\ud22c\uc790', confidence: 0.90, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 9800, replies: 1560, reposts: 3400, engagementRate: 89 },
        analysis: { sentiment: 'neutral', keywords: ['\ud3ec\ud2b8\ud3f4\ub9ac\uc624','\ubc18\ub3c4\uccb4','\ud22c\uc790','2026'], viralScore: 80 },
        publishedAt: h(3), collectedAt: h(2), source: 'scraper' },

      { threadId: 'thread_des_001', originalUrl: 'https://www.threads.net/@design_muse/post/abc12',
        author: { username: 'design_muse', displayName: '\ub514\uc790\uc778\ubba4\uc988', profilePicUrl: 'https://picsum.photos/seed/des1/100', followerCount: 45600, isVerified: false },
        content: { text: '\ud83c\udfa8 Figma AI \uae30\ub2a5 \uc2e4\ubb34 \ud65c\uc6a9\ubc95 \ucd1d\uc815\ub9ac. \ub514\uc790\uc774\ub108 \uc0dd\uc0b0\uc131 2\ubc30 \uc62c\ub9ac\uae30 #Figma #\ub514\uc790\uc778 #AI',
          mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/fig1/600/400','https://picsum.photos/seed/fig2/600/400','https://picsum.photos/seed/fig3/600/400'], thumbnailUrl: 'https://picsum.photos/seed/fig1/300/200',
          hashtags: ['Figma','\ub514\uc790\uc778','AI'] },
        category: { primary: 'personal', sub: '\ub514\uc790\uc778', confidence: 0.88, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 4300, replies: 670, reposts: 1800, engagementRate: 82 },
        analysis: { sentiment: 'positive', keywords: ['Figma','AI','\ub514\uc790\uc778','\uc0dd\uc0b0\uc131'], viralScore: 73 },
        publishedAt: h(5), collectedAt: h(4), source: 'scraper' },

      { threadId: 'thread_del_001', originalUrl: 'https://www.threads.net/@deleted_user123/post/abc13',
        author: { username: 'deleted_user123', displayName: '(\uc0ad\uc81c\ub41c \uacc4\uc815)', profilePicUrl: '', followerCount: 0 },
        content: { text: '\uc774 \uac8c\uc2dc\ubb3c\uc740 \uc791\uc131\uc790\uc5d0 \uc758\ud574 \uc0ad\uc81c\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc6d0\ubcf8 \ub0b4\uc6a9: \uce5c\uad6c\uac00 \uc54c\ub824\uc900 \ucfe0\ud321 \ud560\uc778\ucf54\ub4dc \uacf5\uc720\ud569\ub2c8\ub2e4! #\ud560\uc778\ucf54\ub4dc',
          mediaType: 'text', hashtags: ['\ud560\uc778\ucf54\ub4dc'] },
        category: { primary: 'shopping', sub: '\ucfe0\ud321\ud30c\ud2b8\ub108\uc2a4', confidence: 0.85, classifiedBy: 'rule' },
        affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/del001', platform: 'coupang', detectedIn: 'content' }] },
        metrics: { likes: 340, replies: 23, reposts: 12, engagementRate: 45 },
        analysis: { sentiment: 'positive', keywords: ['\ucfe0\ud321','\ud560\uc778\ucf54\ub4dc'], viralScore: 30 },
        deletion: { isDeleted: true, deletedAt: h(1), detectedAt: h(0.5), reason: 'user_deleted' },
        publishedAt: h(8), collectedAt: h(6), source: 'scraper' },
    ];

    const inserted = await Thread.insertMany(threads);
    res.json({ success: true, message: inserted.length + ' demo threads added (including 1 deleted)', total: inserted.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;
