import { Router } from 'express';
import Thread from '../models/Thread.js';
import Profile from '../models/Profile.js';
import AffiliateDetector from '../classifiers/AffiliateDetector.js';
import logger from '../utils/logger.js';

const router = Router();

// Threads list with filters + pagination
router.get('/threads', async (req, res) => {
  try {
    const { category, sentiment, hasAffiliate, search, sortBy = 'collectedAt', order = 'desc', page = 1, limit = 20 } = req.query;
    const query = {};
    if (category) query['category.primary'] = category;
    if (sentiment) query['analysis.sentiment'] = sentiment;
    if (hasAffiliate !== undefined) query['affiliate.hasAffiliate'] = hasAffiliate === 'true';
    if (search) query.$text = { $search: search };
    const sortObj = {};
    sortObj[sortBy === 'likes' ? 'metrics.likes' : 'collectedAt'] = order === 'asc' ? 1 : -1;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [threads, total] = await Promise.all([
      Thread.find(query).sort(sortObj).skip(skip).limit(parseInt(limit)),
      Thread.countDocuments(query),
    ]);
    res.json({ success: true, data: threads, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    logger.error('GET /threads error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Thread detail
router.get('/threads/:id', async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.id);
    if (!thread) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: thread });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Overview stats
router.get('/stats/overview', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [totalThreads, todayThreads, totalProfiles, affiliateCount] = await Promise.all([
      Thread.countDocuments(), Thread.countDocuments({ collectedAt: { $gte: today } }),
      Profile.countDocuments({ 'tracking.isTracking': true }), Thread.countDocuments({ 'affiliate.hasAffiliate': true }),
    ]);
    res.json({ success: true, data: { totalThreads, todayThreads, totalProfiles, affiliateCount } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Affiliate stats
router.get('/stats/affiliate', async (req, res) => {
  try {
    const threads = await Thread.find({ 'affiliate.hasAffiliate': true });
    const stats = AffiliateDetector.generateStats(threads);
    res.json({ success: true, data: stats });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Trending keywords
router.get('/stats/trending', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const since = new Date(Date.now() - parseInt(hours) * 3600000);
    const keywords = await Thread.aggregate([
      { $match: { collectedAt: { $gte: since } } },
      { $unwind: '$analysis.keywords' },
      { $group: { _id: '$analysis.keywords', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 30 },
    ]);
    res.json({ success: true, data: keywords.map(k => ({ keyword: k._id, count: k.count })) });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Profile CRUD
router.get('/profiles', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [profiles, total] = await Promise.all([
      Profile.find().sort({ 'tracking.priority': -1 }).skip(skip).limit(parseInt(limit)),
      Profile.countDocuments(),
    ]);
    res.json({ success: true, data: profiles, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/profiles', async (req, res) => {
  try {
    const { username, category, priority, tags } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'username required' });
    const existing = await Profile.findOne({ username });
    if (existing) return res.status(409).json({ success: false, error: 'Already tracked' });
    const profile = new Profile({ username, category: { primary: category || 'uncategorized' }, tracking: { isTracking: true, priority: priority || 'medium' }, tags: tags || [] });
    await profile.save();
    res.status(201).json({ success: true, data: profile });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/profiles/:id', async (req, res) => {
  try {
    const profile = await Profile.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!profile) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: profile });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/profiles/:id', async (req, res) => {
  try {
    await Profile.findByIdAndUpdate(req.params.id, { 'tracking.isTracking': false });
    res.json({ success: true, message: 'Tracking stopped' });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Manual collection trigger
router.post('/collector/run', async (req, res) => {
  try {
    const engine = req.app.get('collectorEngine');
    if (!engine) return res.status(500).json({ success: false, error: 'Engine not initialized' });
    engine.runCollectionCycle().catch(e => logger.error('Manual collection failed', { error: e.message }));
    res.json({ success: true, message: 'Collection started' });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/collector/status', async (req, res) => {
  const engine = req.app.get('collectorEngine');
  res.json({ success: true, data: engine ? engine.getStats() : { status: 'not initialized' } });
});

export default router;
