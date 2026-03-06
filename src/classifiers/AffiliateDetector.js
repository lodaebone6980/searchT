import logger from '../utils/logger.js';

const AFFILIATE_PATTERNS = {
  aliexpress: {
    label: 'AliExpress',
    patterns: [/ali\.ski\//i, /s\.click\.aliexpress\.com/i, /aliexpress\.com.*aff_/i],
  },
  coupang: {
    label: 'Coupang Partners',
    patterns: [/link\.coupang\.com/i, /coupa\.ng\//i, /partners\.coupang\.com/i],
  },
  rakuten: {
    label: 'Rakuten',
    patterns: [/a\.r10\.to\//i, /click\.linksynergy\.com/i, /hb\.afl\.rakuten\.co\.jp/i],
  },
  amazon: {
    label: 'Amazon',
    patterns: [/amzn\.to\//i, /amazon\.(?:com|co\.jp).*tag=/i],
  },
  other: {
    label: 'Other',
    patterns: [/shareasale\.com/i, /bit\.ly\//i, /linktr\.ee\//i],
  },
};

export class AffiliateDetector {
  analyze(threadData) {
    const result = { hasAffiliate: false, links: [] };
    const text = threadData.content?.text || '';
    const urls = threadData.content?.urls || [];
    const bio = threadData.author?.bio || '';
    const allUrls = [...urls, ...this._extractUrls(text), ...this._extractUrls(bio)];
    for (const url of allUrls) {
      const d = this._detect(url);
      if (d) { result.hasAffiliate = true; result.links.push({ url, platform: d.platform, detectedIn: 'content' }); }
    }
    return result;
  }

  _detect(url) {
    if (!url) return null;
    for (const [platform, config] of Object.entries(AFFILIATE_PATTERNS)) {
      for (const p of config.patterns) { if (p.test(url)) return { platform, label: config.label }; }
    }
    return null;
  }

  _extractUrls(text) {
    if (!text) return [];
    const re = /https?:\/\/[^\s<>]+/gi;
    return (text.match(re) || []);
  }

  static generateStats(threads) {
    const stats = { totalWithAffiliate: 0, byPlatform: {} };
    for (const t of threads) {
      if (!t.affiliate?.hasAffiliate) continue;
      stats.totalWithAffiliate++;
      for (const l of t.affiliate.links) { stats.byPlatform[l.platform || 'other'] = (stats.byPlatform[l.platform || 'other'] || 0) + 1; }
    }
    return stats;
  }
}

export default AffiliateDetector;
