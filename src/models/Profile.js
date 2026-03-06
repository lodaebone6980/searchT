import mongoose from 'mongoose';

const profileSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  userId: String,
  displayName: String,
  bio: String,
  followerCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  category: {
    primary: { type: String, default: 'uncategorized' },
    sub: { type: String, default: '' },
  },
  tracking: {
    isTracking: { type: Boolean, default: true, index: true },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    collectFrequency: { type: String, default: 'normal' },
    lastCollectedAt: Date,
    totalCollected: { type: Number, default: 0 },
  },
  stats: {
    avgLikes: { type: Number, default: 0 },
    avgReplies: { type: Number, default: 0 },
    postFrequency: { type: Number, default: 0 },
  },
  tags: [String],
}, { timestamps: true });

export default mongoose.model('Profile', profileSchema);
