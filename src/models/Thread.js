import mongoose from 'mongoose';

const threadSchema = new mongoose.Schema({
  threadId: { type: String, required: true, unique: true, index: true },
  originalUrl: { type: String, default: '' },
  platform: { type: String, enum: ['threads', 'instagram', 'twitter'], default: 'threads' },
  author: {
    username: { type: String, required: true, index: true },
    userId: String,
    displayName: String,
    profilePicUrl: String,
    bio: String,
    followerCount: Number,
    isVerified: { type: Boolean, default: false },
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
    classifiedBy: { type: String, enum: ['rule', 'ai', 'manual'], default: 'rule' },
  },
  region: {
    type: String,
    enum: ['domestic', 'overseas'],
    default: 'domestic',
    index: true,
  },
  affiliate: {
    hasAffiliate: { type: Boolean, default: false, index: true },
    links: [{
      url: String,
      platform: { type: String, enum: ['aliexpress', 'coupang', 'rakuten', 'amazon', 'other'] },
      shortUrl: String,
      detectedIn: { type: String, enum: ['content', 'bio', 'comment'] },
    }],
  },
  metrics: {
    likes: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    quotes: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
  },
  analysis: {
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
    keywords: [String],
    viralScore: { type: Number, default: 0 },
    language: { type: String, default: 'ko' },
  },
  deletion: {
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    detectedAt: Date,
    reason: { type: String, enum: ['user_deleted', 'platform_removed', 'account_suspended', 'unknown'] },
  },
  publishedAt: { type: Date },
  collectedAt: { type: Date, default: Date.now },
  source: { type: String, enum: ['official_api', 'scraper', 'manual'], default: 'official_api' },
}, { timestamps: true });

threadSchema.index({ 'category.primary': 1, region: 1, collectedAt: -1 });
threadSchema.index({ 'author.username': 1, collectedAt: -1 });
threadSchema.index({ 'analysis.keywords': 1 });
threadSchema.index({ 'deletion.isDeleted': 1 });

export default mongoose.model('Thread', threadSchema);
