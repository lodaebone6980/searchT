import mongoose from 'mongoose';

const threadSchema = new mongoose.Schema({
  threadId: { type: String, required: true, unique: true, index: true },
  platform: { type: String, default: 'threads' },
  originalUrl: String,

  author: {
    userId: String,
    username: { type: String, index: true },
    displayName: String,
    profilePicUrl: String,
    bio: String,
    isVerified: { type: Boolean, default: false },
    followerCount: { type: Number, default: 0 },
  },

  content: {
    text: { type: String, default: '' },
    mediaType: { type: String, enum: ['text', 'image', 'video', 'carousel', 'link'], default: 'text' },
    mediaUrls: [String],
    thumbnailUrl: String,
    videoUrl: String,
    urls: [String],
    hashtags: [String],
    mentions: [String],
  },

  category: {
    primary: { type: String, enum: ['shopping', 'issue', 'personal', 'uncategorized'], default: 'uncategorized', index: true },
    sub: { type: String, default: '' },
    confidence: { type: Number, default: 0 },
    classifiedBy: { type: String, enum: ['ai', 'rule', 'manual'], default: 'rule' },
    classifiedAt: Date,
  },

  region: { type: String, enum: ['domestic', 'overseas'], default: 'domestic', index: true },

  viewTier: { type: String, enum: ['under1k', '1k', '5k', '10k', '50k', '100k'], default: 'under1k', index: true },
  collectionSource: { type: String, enum: ['manual', 'auto_keyword', 'auto_profile', 'api'], default: 'manual' },
  lastViewUpdate: Date,

  affiliate: {
    hasAffiliate: { type: Boolean, default: false, index: true },
    links: [{
      url: String,
      platform: { type: String, enum: ['aliexpress', 'coupang', 'rakuten', 'amazon', 'other'] },
      shortUrl: String,
      resolvedUrl: String,
      detectedIn: { type: String, enum: ['content', 'bio', 'comment'] },
    }],
  },

  metrics: {
    likes: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    quotes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
  },

  analysis: {
    sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
    sentimentScore: { type: Number, default: 0, min: -1, max: 1 },
    keywords: [String],
    summary: String,
    language: { type: String, default: 'ko' },
    viralScore: { type: Number, default: 0, min: 0, max: 100 },
  },

  deletion: {
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    detectedAt: Date,
    reason: String,
  },

  publishedAt: { type: Date, index: true },
  collectedAt: { type: Date, default: Date.now, index: true },
  source: { type: String, default: 'scraper' },
}, { timestamps: true });

// Static method to calculate view tier
threadSchema.statics.calcViewTier = function(views) {
  if (!views || views < 1000) return 'under1k';
  if (views < 5000) return '1k';
  if (views < 10000) return '5k';
  if (views < 50000) return '10k';
  if (views < 100000) return '50k';
  return '100k';
};

// Compound indexes
threadSchema.index({ 'category.primary': 1, viewTier: 1 });
threadSchema.index({ 'affiliate.hasAffiliate': 1, viewTier: 1 });
threadSchema.index({ collectionSource: 1, collectedAt: -1 });
threadSchema.index({ 'content.text': 'text' });

const Thread = mongoose.model('Thread', threadSchema);
export default Thread;
