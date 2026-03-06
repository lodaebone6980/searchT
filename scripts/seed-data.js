import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import Profile from '../src/models/Profile.js';
import Thread from '../src/models/Thread.js';

const seedProfiles = [
  { username: 'ali_deals_kr', category: { primary: 'shopping', sub: 'aliexpress' }, tracking: { isTracking: true, priority: 'high' } },
  { username: 'coupang_best', category: { primary: 'shopping', sub: 'coupang' }, tracking: { isTracking: true, priority: 'high' } },
  { username: 'tech_news_kr', category: { primary: 'issue', sub: 'tech' }, tracking: { isTracking: true, priority: 'medium' } },
  { username: 'kpop_daily', category: { primary: 'issue', sub: 'entertainment' }, tracking: { isTracking: true, priority: 'medium' } },
  { username: 'startup_ceo', category: { primary: 'personal', sub: 'marketing' }, tracking: { isTracking: true, priority: 'low' } },
  { username: 'design_studio', category: { primary: 'personal', sub: 'design' }, tracking: { isTracking: true, priority: 'low' } },
];

const seedThreads = [
  {
    threadId: 'seed_1',
    author: { username: 'ali_deals_kr' },
    content: { text: 'AliExpress spring sale! Up to 70% off. Check link in bio ali.ski/xyz123', urls: ['https://ali.ski/xyz123'] },
    category: { primary: 'shopping', sub: 'aliexpress', confidence: 0.95, classifiedBy: 'rule' },
    affiliate: { hasAffiliate: true, links: [{ url: 'https://ali.ski/xyz123', platform: 'aliexpress', detectedIn: 'content' }] },
    metrics: { likes: 234, replies: 45, reposts: 12 },
    analysis: { sentiment: 'positive', keywords: ['aliexpress', 'sale', 'discount'] },
  },
  {
    threadId: 'seed_2',
    author: { username: 'tech_news_kr' },
    content: { text: 'Apple Vision Pro officially launches in Korea this month' },
    category: { primary: 'issue', sub: 'tech', confidence: 0.9, classifiedBy: 'rule' },
    affiliate: { hasAffiliate: false, links: [] },
    metrics: { likes: 1523, replies: 234, reposts: 89 },
    analysis: { sentiment: 'positive', keywords: ['apple', 'vision pro', 'korea', 'launch'] },
  },
  {
    threadId: 'seed_3',
    author: { username: 'startup_ceo' },
    content: { text: '5 marketing strategies that helped us grow 300% in 6 months' },
    category: { primary: 'personal', sub: 'marketing', confidence: 0.85, classifiedBy: 'rule' },
    affiliate: { hasAffiliate: false, links: [] },
    metrics: { likes: 876, replies: 123, reposts: 45 },
    analysis: { sentiment: 'positive', keywords: ['marketing', 'growth', 'startup'] },
  },
];

async function seed() {
  await mongoose.connect(config.mongodb.uri);
  console.log('Connected to MongoDB');

  await Profile.deleteMany({});
  await Thread.deleteMany({});

  await Profile.insertMany(seedProfiles);
  console.log('Seeded ' + seedProfiles.length + ' profiles');

  await Thread.insertMany(seedThreads);
  console.log('Seeded ' + seedThreads.length + ' threads');

  await mongoose.disconnect();
  console.log('Done!');
}

seed().catch(console.error);
