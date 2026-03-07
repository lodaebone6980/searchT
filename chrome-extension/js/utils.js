/**
 * utils.js - 유틸리티 함수 (제휴링크 감지, region 감지, 메트릭 파싱)
 */

const ThreadsUtils = {
  // ============ 제휴링크 감지 ============
  affiliatePatterns: {
    coupang: [/link\.coupang\.com/i, /coupa\.ng/i],
    aliexpress: [/ali\.ski/i, /s\.click\.aliexpress\.com/i, /aliexpress\.com/i],
    amazon: [/amzn\.to/i, /amazon\.com\/dp/i, /tag=/i],
    rakuten: [/a\.r10\.to/i, /rakuten/i],
    tmon: [/tmon\.co\.kr/i],
    wemakeprice: [/wemakeprice\.com/i],
    eleven: [/11st\.co\.kr/i],
  },

  detectAffiliateLinks(urls) {
    const links = [];
    let hasAffiliate = false;

    for (const url of urls) {
      for (const [platform, patterns] of Object.entries(this.affiliatePatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(url)) {
            hasAffiliate = true;
            links.push({ url, platform });
            break;
          }
        }
        if (links.length > 0 && links[links.length - 1].url === url) break;
      }
    }

    return { hasAffiliate, links };
  },

  // ============ Region 감지 ============
  detectRegion(text) {
    if (!text) return 'domestic';
    const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    if (totalChars === 0) return 'domestic';
    const koreanRatio = (koreanChars / totalChars) * 100;
    return koreanRatio > 10 ? 'domestic' : 'overseas';
  },

  // ============ 메트릭 파싱 ============
  parseMetricText(text) {
    if (!text) return 0;
    text = text.trim();

    // "1.2만" → 12000, "1.1천" → 1100, "486" → 486
    const manMatch = text.match(/([\d.]+)\s*만/);
    if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);

    const cheonMatch = text.match(/([\d.]+)\s*천/);
    if (cheonMatch) return Math.round(parseFloat(cheonMatch[1]) * 1000);

    // English: "1.5K" → 1500, "2.3M" → 2300000
    const kMatch = text.match(/([\d.]+)\s*K/i);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);

    const mMatch = text.match(/([\d.]+)\s*M/i);
    if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);

    const num = parseInt(text.replace(/[,\s]/g, ''), 10);
    return isNaN(num) ? 0 : num;
  },

  // ============ Threads 리다이렉트 URL 복원 ============
  resolveThreadsUrl(url) {
    if (!url) return url;
    // l.threads.com/?u=ENCODED_URL → 원본 URL
    const match = url.match(/l\.threads\.com\/?\?u=([^&]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (e) {
        return url;
      }
    }
    return url;
  },

  // ============ View Tier 계산 ============
  calculateViewTier(likes) {
    if (likes >= 100000) return '100k';
    if (likes >= 50000) return '50k';
    if (likes >= 10000) return '10k';
    if (likes >= 5000) return '5k';
    if (likes >= 1000) return '1k';
    return 'under1k';
  },

  // ============ 해시태그/멘션 추출 ============
  extractHashtags(text) {
    return (text.match(/#[\w\uAC00-\uD7AF]+/g) || []);
  },

  extractMentions(text) {
    return (text.match(/@[\w.]+/g) || []);
  },

  // ============ threadId 생성 ============
  extractThreadId(postUrl) {
    // URL 패턴: /@username/post/POST_ID
    const match = postUrl.match(/\/post\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    // 폴백: URL 해시
    return 'ext_' + this.hashString(postUrl);
  },

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  },

  // ============ 로깅 ============
  log(level, message, data) {
    const prefix = '[Threads수집기]';
    if (level === 'error') {
      console.error(prefix, message, data || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, data || '');
    } else {
      console.log(prefix, message, data || '');
    }
  }
};

// content script에서 사용 가능하도록
if (typeof window !== 'undefined') {
  window.ThreadsUtils = ThreadsUtils;
}
