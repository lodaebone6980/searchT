import { Router } from 'express';
import Thread from '../models/Thread.js';
import Profile from '../models/Profile.js';
import logger from '../utils/logger.js';

const router = Router();

// Get threads with filters
router.get('/threads', async (req, res) => {
  try {
    const { category, sentiment, hasAffiliate, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category) filter['category.primary'] = category;
    if (sentiment) filter['analysis.sentiment'] = sentiment;
    if (hasAffiliate === 'true') filter['affiliate.hasAffiliate'] = true;
    if (search) filter['$text'] = { $search: search };

    const total = await Thread.countDocuments(filter);
    const threads = await Thread.find(filter)
      .sort({ collectedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, data: threads, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get single thread
router.get('/threads/:id', async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.id);
    res.json({ success: true, data: thread });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Stats overview
router.get('/stats/overview', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [totalThreads, todayThreads, totalProfiles, affiliateCount] = await Promise.all([
      Thread.countDocuments(),
      Thread.countDocuments({ collectedAt: { $gte: today } }),
      Profile.countDocuments(),
      Thread.countDocuments({ 'affiliate.hasAffiliate': true }),
    ]);
    res.json({ success: true, data: { totalThreads, todayThreads, totalProfiles, affiliateCount } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Stats affiliate
router.get('/stats/affiliate', async (req, res) => {
  try {
    const data = await Thread.aggregate([
      { $match: { 'affiliate.hasAffiliate': true } },
      { $group: { _id: '$affiliate.platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Trending keywords
router.get('/stats/trending', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = new Date(Date.now() - hours * 3600000);
    const threads = await Thread.find({ collectedAt: { $gte: since } }).select('content.text');
    const words = {};
    for (const t of threads) {
      const text = t.content?.text || '';
      const tokens = text.split(/[\s,.!?]+/).filter(w => w.length > 2);
      for (const w of tokens) {
        const lw = w.toLowerCase();
        words[lw] = (words[lw] || 0) + 1;
      }
    }
    const sorted = Object.entries(words).sort((a,b) => b[1] - a[1]).slice(0, 20).map(([keyword, count]) => ({ keyword, count }));
    res.json({ success: true, data: sorted });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Profiles
router.get('/profiles', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const total = await Profile.countDocuments();
    const data = await Profile.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
    res.json({ success: true, data, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const { username, category, priority } = req.body;
    const existing = await Profile.findOne({ username: username.replace('@', '') });
    if (existing) return res.status(400).json({ success: false, error: 'Profile already exists' });
    const profile = new Profile({
      username: username.replace('@', ''),
      category: { primary: category || 'personal' },
      tracking: { isTracking: true, priority: priority || 'medium' },
    });
    await profile.save();
    res.json({ success: true, data: profile });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/profiles/:id', async (req, res) => {
  try {
    const profile = await Profile.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: profile });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/profiles/:id', async (req, res) => {
  try {
    await Profile.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Collector controls
router.post('/collector/run', async (req, res) => {
  try {
    const engine = req.app.get('collectorEngine');
    engine.runCollectionCycle().catch(e => logger.error('Manual run error', { error: e.message }));
    res.json({ success: true, message: 'Collection started' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/collector/status', async (req, res) => {
  try {
    const engine = req.app.get('collectorEngine');
    res.json({ success: true, data: engine.getStats() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Seed demo data
router.post('/seed-demo', async (req, res) => {
  try {
    const demoThreads = [
      { threadId: 'demo_shop_1', content: { text: '\ud83d\udce6 \uc624\ub298\uc758 \uc1fc\ud551 \ucd94\ucc9c! \uc544\uc774\ud3f0 16 Pro Max \ucfe0\ud321\uc5d0\uc11c 50% \ud560\uc778 \uc911! \uc774 \ub9c1\ud06c\ub85c \uad6c\ub9e4\ud558\uc138\uc694 https://link.coupang.com/abc123 #\uc1fc\ud551 #\ud560\uc778 #\uc544\uc774\ud3f0', mediaUrls: [], urls: ['https://link.coupang.com/abc123'] }, metrics: { likes: 234, replies: 45, reposts: 12 }, author: { username: 'shopping_queen', displayName: '\uc1fc\ud551\uc5ec\uc655' }, category: { primary: 'shopping', confidence: 0.95 }, affiliate: { hasAffiliate: true, platform: 'coupang', urls: ['https://link.coupang.com/abc123'] }, source: 'scraper', postedAt: new Date(Date.now() - 3600000), collectedAt: new Date() },
      { threadId: 'demo_shop_2', content: { text: '\uc544\ub9c8\uc874 \ud504\ub77c\uc784\ub370\uc774 \uc138\uc77c \uc2dc\uc791! \uc5d0\uc5b4\ud31f \ud504\ub85c 2 \ucd5c\uc800\uac00 \ub3c4\uc804 https://amzn.to/xyz789 \ud83d\udd25', mediaUrls: [], urls: ['https://amzn.to/xyz789'] }, metrics: { likes: 567, replies: 89, reposts: 34 }, author: { username: 'deal_hunter', displayName: '\ub51c\ud5cc\ud130' }, category: { primary: 'shopping', confidence: 0.92 }, affiliate: { hasAffiliate: true, platform: 'amazon', urls: ['https://amzn.to/xyz789'] }, source: 'scraper', postedAt: new Date(Date.now() - 7200000), collectedAt: new Date() },
      { threadId: 'demo_issue_1', content: { text: '\uc18d\ubcf4) \uc0bc\uc131\uc804\uc790 \uc2e0\ud615 \uac24\ub7ed\uc2dc S26 \uc2dc\ub9ac\uc988 \uacf5\uac1c \uc784\ubc15! AI \uae30\ub2a5 \ub300\ud3ed \uc5c5\uadf8\ub808\uc774\ub4dc \uc608\uc0c1. \uc0bc\uc131\uc774 \uc560\ud50c\uc744 \ub530\ub77c\uc7a1\uc744\uac70\ub77c\ub294 \uc804\ub9dd \ub9ce\uc544. #\uc0bc\uc131 #\uac24\ub7ed\uc2dc #AI', mediaUrls: [], urls: [] }, metrics: { likes: 1203, replies: 234, reposts: 156 }, author: { username: 'tech_insider', displayName: '\ud14c\ud06c\uc778\uc0ac\uc774\ub354' }, category: { primary: 'issue', confidence: 0.88 }, affiliate: { hasAffiliate: false }, source: 'scraper', postedAt: new Date(Date.now() - 1800000), collectedAt: new Date() },
      { threadId: 'demo_issue_2', content: { text: '\ud83d\udea8 \uce74\uce74\uc624\ud1a1 \uba39\ud1b5 \uc7a5\uc560 \ubc1c\uc0dd \uc911! \uba54\uc2dc\uc9c0 \uc804\uc1a1 \uc548\ub418\ub294 \uc0ac\ub78c \ub098\ub9cc \uadf8\ub7f0\uac70 \uc544\ub2c8\uc9c0? \ubcf5\uad6c \uc5b8\uc81c \ub418\ub294\uac70\uc57c #\uce74\uce74\uc624\ud1a1 #\uba39\ud1b5 #\uc7a5\uc560', mediaUrls: [], urls: [] }, metrics: { likes: 3456, replies: 892, reposts: 445 }, author: { username: 'news_flash_kr', displayName: '\uc18d\ubcf4\uc54c\ub9ac\ubbf8' }, category: { primary: 'issue', confidence: 0.91 }, affiliate: { hasAffiliate: false }, source: 'scraper', postedAt: new Date(Date.now() - 900000), collectedAt: new Date() },
      { threadId: 'demo_personal_1', content: { text: '\uc624\ub298 \ud55c\uac15 \uc0b0\ucc45\ud558\ub2e4\uac00 \ucc0d\uc740 \uc0ac\uc9c4 \ud83c\udf38 \ubc9a\uaf43\uc774 \ub9cc\uac1c\ud55c \uacc4\uc808\uc774 \uc654\ub124\uc694. \ub0a0\uc528\uac00 \ub108\ubb34 \uc88b\uc544\uc11c \ud589\ubcf5\ud55c \ud558\ub8e8\uc600\uc2b5\ub2c8\ub2e4. #\ubd04 #\ubc9a\uaf43 #\ud55c\uac15', mediaUrls: ['https://images.example.com/hangang.jpg'], urls: [] }, metrics: { likes: 89, replies: 12, reposts: 3 }, author: { username: 'zuck', displayName: 'Mark Zuckerberg' }, category: { primary: 'personal', confidence: 0.85 }, affiliate: { hasAffiliate: false }, source: 'scraper', postedAt: new Date(Date.now() - 5400000), collectedAt: new Date() },
      { threadId: 'demo_personal_2', content: { text: '\uc624\ub298 \uc810\uc2ec \uba54\ub274 \ucd94\ucc9c \ubc1b\uc2b5\ub2c8\ub2e4 \ud83c\udf5c \uc131\uc218\ub3d9 \ub9db\uc9d1 \ubc1c\uacac! \ub9c8\ub77c\ud0d5 \ucc28\ub3cc\ubc15\uc774 \ub9e4\uc6b4 \ub9db\uc774 \ub05d\ub0b4\uc92c\uc74c \ud83d\udd25 #\ub9db\uc9d1 #\uc131\uc218\ub3d9 #\ub9c8\ub77c\ud0d5', mediaUrls: [], urls: [] }, metrics: { likes: 45, replies: 8, reposts: 2 }, author: { username: 'foodie_kr', displayName: '\ub9db\uc9d1\ud0d0\ubc29\uac00' }, category: { primary: 'personal', confidence: 0.82 }, affiliate: { hasAffiliate: false }, source: 'scraper', postedAt: new Date(Date.now() - 10800000), collectedAt: new Date() },
    ];

    let added = 0;
    for (const t of demoThreads) {
      const exists = await Thread.findOne({ threadId: t.threadId });
      if (!exists) {
        await new Thread(t).save();
        added++;
      }
    }
    res.json({ success: true, message: added + ' demo threads added', total: demoThreads.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
