import { Router } from 'express';
import Thread from '../models/Thread.js';
import ThreadsScraper from '../services/ThreadsScraper.js';

const router = Router();
let scraper = null;

function getScraper() {
  if (!scraper) scraper = new ThreadsScraper();
  return scraper;
}

// ===== Stats =====
router.get('/stats', async (req, res) => {
  try {
    const total = await Thread.countDocuments({ 'deletion.isDeleted': { $ne: true } });
    const today = await Thread.countDocuments({
      collectedAt: { $gte: new Date(new Date().setHours(0,0,0,0)) },
      'deletion.isDeleted': { $ne: true }
    });
    const profiles = await Thread.distinct('author.username');
    const affiliateCount = await Thread.countDocuments({ 'affiliate.hasAffiliate': true, 'deletion.isDeleted': { $ne: true } });
    const deleted = await Thread.countDocuments({ 'deletion.isDeleted': true });
    const domestic = await Thread.countDocuments({ region: 'domestic', 'deletion.isDeleted': { $ne: true } });
    const overseas = await Thread.countDocuments({ region: 'overseas', 'deletion.isDeleted': { $ne: true } });

    const byCat = await Thread.aggregate([
      { $match: { 'deletion.isDeleted': { $ne: true } } },
      { $group: { _id: '$category.primary', count: { $sum: 1 } } }
    ]);
    const bySentiment = await Thread.aggregate([
      { $match: { 'deletion.isDeleted': { $ne: true } } },
      { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
    ]);

    res.json({
      total, today, profiles: profiles.length, affiliateCount, deleted, domestic, overseas,
      byCat: byCat.reduce((o, i) => { o[i._id] = i.count; return o; }, {}),
      bySentiment: bySentiment.reduce((o, i) => { o[i._id] = i.count; return o; }, {}),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Thread list =====
router.get('/threads', async (req, res) => {
  try {
    const { category, region, search, sort = 'latest', page = 1, limit = 50, includeDeleted } = req.query;
    const filter = {};
    if (!includeDeleted) filter['deletion.isDeleted'] = { $ne: true };
    if (category && category !== 'all') filter['category.primary'] = category;
    if (region && region !== 'all') filter.region = region;
    if (search) {
      filter.$or = [
        { 'content.text': { $regex: search, $options: 'i' } },
        { 'author.username': { $regex: search, $options: 'i' } },
        { 'content.hashtags': { $regex: search, $options: 'i' } },
      ];
    }
    const sortMap = { latest: { collectedAt: -1 }, popular: { 'metrics.likes': -1 }, engagement: { 'metrics.engagementRate': -1 }, replies: { 'metrics.replies': -1 } };
    const threads = await Thread.find(filter).sort(sortMap[sort] || sortMap.latest).skip((page-1)*limit).limit(Number(limit));
    const total = await Thread.countDocuments(filter);
    res.json({ threads, total, page: Number(page), pages: Math.ceil(total/limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Collector status =====
router.get('/collector/status', async (req, res) => {
  res.json({ running: false, lastRun: null, hasToken: !!process.env.THREADS_ACCESS_TOKEN });
});

// ===== Scrape collect (FREE - no API token needed) =====
router.post('/collector/scrape', async (req, res) => {
  const { usernames } = req.body;
  if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ success: false, message: '수집할 유저명 목록을 입력해주세요.' });
  }

  try {
    const sc = getScraper();
    let totalSaved = 0;
    const results = [];

    for (const username of usernames.slice(0, 5)) { // max 5 users per request
      const clean = username.replace('@', '').trim();
      if (!clean) continue;

      console.log('[Collect] Scraping @' + clean + '...');
      const data = await sc.scrapeProfile(clean);
      let saved = 0;

      for (const t of data.threads) {
        const exists = await Thread.findOne({ threadId: String(t.threadId) });
        if (exists) continue;

        const text = t.text || '';
        const hashtags = text.match(/#[\w\uAC00-\uD7A3]+/g) || [];
        const mentions = text.match(/@[\w.]+/g) || [];
        const urls = text.match(/https?:\/\/[^\s]+/g) || [];
        
        const isKorean = /[\uAC00-\uD7A3]/.test(text);
        const hasAli = urls.some(u => /ali/i.test(u));
        const hasCoupang = urls.some(u => /coupang/i.test(u));
        const hasAmazon = urls.some(u => /amzn|amazon/i.test(u));
        const hasRakuten = urls.some(u => /rakuten/i.test(u));
        const hasAffiliate = hasAli || hasCoupang || hasAmazon || hasRakuten;

        const affLinks = [];
        if (hasAli) affLinks.push({ url: urls.find(u => /ali/i.test(u)), platform: 'aliexpress', detectedIn: 'content' });
        if (hasCoupang) affLinks.push({ url: urls.find(u => /coupang/i.test(u)), platform: 'coupang', detectedIn: 'content' });
        if (hasAmazon) affLinks.push({ url: urls.find(u => /amzn|amazon/i.test(u)), platform: 'amazon', detectedIn: 'content' });
        if (hasRakuten) affLinks.push({ url: urls.find(u => /rakuten/i.test(u)), platform: 'rakuten', detectedIn: 'content' });

        let catPrimary = 'personal';
        if (hasAffiliate || /(할인|쿠폰|링크|세일|최저가|배송|리뷰|추천|구매)/i.test(text)) catPrimary = 'shopping';
        else if (/(속보|논란|규제|선거|정치|경제|사회|사건|이슈|국회|법안)/i.test(text)) catPrimary = 'issue';

        const mediaType = t.mediaType === 'video' ? 'video' : t.mediaType === 'carousel' ? 'carousel' : t.imageUrl ? 'image' : 'text';

        await Thread.create({
          threadId: String(t.threadId),
          originalUrl: t.permalink || '',
          author: {
            username: clean,
            displayName: data.profile?.displayName || clean,
            profilePicUrl: data.profile?.profilePicUrl || '',
            bio: data.profile?.bio || '',
            isVerified: false,
          },
          content: {
            text,
            mediaType,
            mediaUrls: t.imageUrl ? [t.imageUrl] : [],
            thumbnailUrl: t.imageUrl || '',
            videoUrl: t.videoUrl || '',
            urls, hashtags, mentions,
          },
          category: { primary: catPrimary, sub: '', confidence: 0.7, classifiedBy: 'rule' },
          region: isKorean ? 'domestic' : 'overseas',
          affiliate: { hasAffiliate, links: affLinks },
          metrics: {
            likes: t.likeCount || 0,
            replies: t.replyCount || 0,
            reposts: t.repostCount || 0,
            quotes: t.quoteCount || 0,
            engagementRate: Math.min(100, Math.round(((t.likeCount || 0) + (t.replyCount || 0) * 3) / Math.max(1, (t.likeCount || 0)) * 30)),
          },
          analysis: {
            sentiment: 'neutral',
            keywords: hashtags.map(h => h.replace('#', '')).slice(0, 5),
            language: isKorean ? 'ko' : 'en',
          },
          publishedAt: t.timestamp || new Date(),
          collectedAt: new Date(),
          source: 'scraper',
        });
        saved++;
      }
      totalSaved += saved;
      results.push({ username: clean, found: data.threads.length, saved });
    }

    res.json({ 
      success: true, 
      message: totalSaved + '개 스레드 수집 완료',
      total: totalSaved,
      details: results
    });
  } catch (e) {
    console.error('[Collect] Error:', e);
    res.status(500).json({ success: false, message: '수집 오류: ' + e.message });
  }
});

// ===== Seed demo data =====
router.post('/seed-demo', async (req, res) => {
  try {
    await Thread.deleteMany({});
    const now = new Date();
    const ago = (m) => new Date(now - m * 60000);
    const threads = [
      { threadId: 'demo_kr_shop_1', author: { username: 'coupang_picks', displayName: '쿠팡추천마니아', profilePicUrl: 'https://picsum.photos/seed/cp1/100', followerCount: 45000, isVerified: true }, content: { text: '🎁 쿠팡 로켓배송 오늘의 핵딜 TOP5 #쿠팡 #핵딜 #로켓배송', mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/shop1/600/400','https://picsum.photos/seed/shop1b/600/400'], thumbnailUrl: 'https://picsum.photos/seed/shop1/600/400', urls: ['https://link.coupang.com/xyz789'], hashtags: ['#쿠팡','#핵딜'] }, category: { primary: 'shopping', sub: '쿠팡파트너스', confidence: 0.95, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/xyz789', platform: 'coupang', detectedIn: 'content' }] }, metrics: { likes: 1890, replies: 312, reposts: 445, engagementRate: 88 }, analysis: { sentiment: 'positive', keywords: ['쿠팡','핵딜'], language: 'ko' }, publishedAt: ago(120), source: 'scraper' },
      { threadId: 'demo_kr_shop_2', author: { username: 'beauty_haul_kr', displayName: '뷰티하울', profilePicUrl: 'https://picsum.photos/seed/bh1/100', followerCount: 23000 }, content: { text: '💄 올리브영 립오일 50% 할인! #올리브영 #뷰티딜', mediaType: 'video', thumbnailUrl: 'https://picsum.photos/seed/beauty1/600/400', videoUrl: 'https://example.com/v1.mp4', urls: ['https://link.coupang.com/beauty01'], hashtags: ['#올리브영'] }, category: { primary: 'shopping', sub: '쿠팡파트너스', confidence: 0.92, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/beauty01', platform: 'coupang', detectedIn: 'content' }] }, metrics: { likes: 3400, replies: 567, reposts: 234, engagementRate: 91 }, analysis: { sentiment: 'positive', keywords: ['올리브영','할인'], language: 'ko' }, publishedAt: ago(90), source: 'scraper' },
      { threadId: 'demo_os_shop_1', author: { username: 'deal_hunter_kr', displayName: '딜헌터KR', profilePicUrl: 'https://picsum.photos/seed/dh1/100', followerCount: 18000 }, content: { text: '🔥 알리 역대급 할인! 에어팟맥스 케이스 $2.99 #알리익스프레스 #할인', mediaType: 'image', thumbnailUrl: 'https://picsum.photos/seed/ali1/600/400', urls: ['https://ali.ski/abc123'], hashtags: ['#알리익스프레스'] }, category: { primary: 'shopping', sub: 'AliExpress', confidence: 0.95, classifiedBy: 'rule' }, region: 'overseas', affiliate: { hasAffiliate: true, links: [{ url: 'https://ali.ski/abc123', platform: 'aliexpress', detectedIn: 'content' }] }, metrics: { likes: 2340, replies: 189, reposts: 567, engagementRate: 94 }, analysis: { sentiment: 'positive', keywords: ['알리','할인'], language: 'ko' }, publishedAt: ago(60), source: 'scraper' },
      { threadId: 'demo_os_shop_2', author: { username: 'us_deal_master', displayName: '미국직구마스터', profilePicUrl: 'https://picsum.photos/seed/us1/100', followerCount: 32000, isVerified: true }, content: { text: '🇺🇸 아마존 프라임데이 사전할인! 갤럭시 버즈3 프로 최저가 #아마존 #프라임데이', mediaType: 'video', thumbnailUrl: 'https://picsum.photos/seed/amz1/600/400', videoUrl: 'https://example.com/v2.mp4', urls: ['https://amzn.to/def456'], hashtags: ['#아마존'] }, category: { primary: 'shopping', sub: 'Amazon', confidence: 0.96, classifiedBy: 'rule' }, region: 'overseas', affiliate: { hasAffiliate: true, links: [{ url: 'https://amzn.to/def456', platform: 'amazon', detectedIn: 'content' }] }, metrics: { likes: 3210, replies: 456, reposts: 789, engagementRate: 97 }, analysis: { sentiment: 'positive', keywords: ['아마존','프라임데이'], language: 'ko' }, publishedAt: ago(180), source: 'scraper' },
      { threadId: 'demo_kr_issue_1', author: { username: 'ent_news_live', displayName: '연예뉴스라이브', profilePicUrl: 'https://picsum.photos/seed/ent1/100', followerCount: 120000, isVerified: true }, content: { text: '🎤 속보: BTS 지민 솔로 월드투어 일정 공개! #BTS #지민 #월드투어', mediaType: 'image', thumbnailUrl: 'https://picsum.photos/seed/bts1/600/400', hashtags: ['#BTS','#지민'] }, category: { primary: 'issue', sub: '연예', confidence: 0.97, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: false, links: [] }, metrics: { likes: 45200, replies: 8900, reposts: 12300, engagementRate: 99 }, analysis: { sentiment: 'positive', keywords: ['BTS','지민','월드투어'], language: 'ko' }, publishedAt: ago(20), source: 'scraper' },
      { threadId: 'demo_kr_issue_2', author: { username: 'politics_watch', displayName: '정치워치', profilePicUrl: 'https://picsum.photos/seed/pol1/100', followerCount: 67000, isVerified: true }, content: { text: '🏛️ 국회 AI 규제법안 본회의 통과 #AI규제 #국회', mediaType: 'text', hashtags: ['#AI규제'] }, category: { primary: 'issue', sub: '시사', confidence: 0.94, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: false, links: [] }, metrics: { likes: 8900, replies: 2340, reposts: 3400, engagementRate: 85 }, analysis: { sentiment: 'neutral', keywords: ['AI규제','국회'], language: 'ko' }, publishedAt: ago(100), source: 'scraper' },
      { threadId: 'demo_kr_issue_3', author: { username: 'sports_flash', displayName: '스포츠플래시', profilePicUrl: 'https://picsum.photos/seed/sp1/100', followerCount: 89000, isVerified: true }, content: { text: '⚽ 손흥민 시즌 20호골! EPL 득점왕 경쟁 본격화 #손흥민 #EPL', mediaType: 'video', thumbnailUrl: 'https://picsum.photos/seed/son1/600/400', videoUrl: 'https://example.com/son.mp4', hashtags: ['#손흥민','#EPL'] }, category: { primary: 'issue', sub: '스포츠', confidence: 0.96, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: false, links: [] }, metrics: { likes: 34500, replies: 5600, reposts: 8900, engagementRate: 96 }, analysis: { sentiment: 'positive', keywords: ['손흥민','EPL'], language: 'ko' }, publishedAt: ago(30), source: 'scraper' },
      { threadId: 'demo_os_issue_1', author: { username: 'tech_insider_kr', displayName: '테크인사이더', profilePicUrl: 'https://picsum.photos/seed/tech1/100', followerCount: 95000, isVerified: true }, content: { text: '💻 OpenAI GPT-5 출시 임박설 #OpenAI #GPT5 #AI', mediaType: 'video', thumbnailUrl: 'https://picsum.photos/seed/gpt1/600/400', videoUrl: 'https://example.com/gpt5.mp4', hashtags: ['#OpenAI','#GPT5','#AI'] }, category: { primary: 'issue', sub: 'IT/테크', confidence: 0.95, classifiedBy: 'rule' }, region: 'overseas', affiliate: { hasAffiliate: false, links: [] }, metrics: { likes: 12400, replies: 3200, reposts: 5600, engagementRate: 92 }, analysis: { sentiment: 'positive', keywords: ['OpenAI','GPT5','AI'], language: 'ko' }, publishedAt: ago(200), source: 'scraper' },
      { threadId: 'demo_kr_personal_1', author: { username: 'growth_hacker_jin', displayName: '그로스해커진', profilePicUrl: 'https://picsum.photos/seed/gh1/100', followerCount: 28000 }, content: { text: '🚀 스레드 알고리즘 분석! 도달율 300% 올리는 5가지 팁 #마케팅 #스레드', mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/mk1/600/400','https://picsum.photos/seed/mk2/600/400'], thumbnailUrl: 'https://picsum.photos/seed/mk1/600/400', hashtags: ['#마케팅','#스레드'] }, category: { primary: 'personal', sub: '마케팅', confidence: 0.91, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: false, links: [] }, metrics: { likes: 6700, replies: 890, reposts: 2300, engagementRate: 91 }, analysis: { sentiment: 'positive', keywords: ['스레드','알고리즘'], language: 'ko' }, publishedAt: ago(35), source: 'scraper' },
      { threadId: 'demo_os_personal_1', author: { username: 'warren_kr', displayName: '한국의워렌', profilePicUrl: 'https://picsum.photos/seed/wr1/100', followerCount: 41000 }, content: { text: '📈 2026년 포트폴리오 리밸런싱 전략 #투자 #포트폴리오 #반도체', mediaType: 'image', thumbnailUrl: 'https://picsum.photos/seed/inv1/600/400', hashtags: ['#투자','#반도체'] }, category: { primary: 'personal', sub: '투자', confidence: 0.88, classifiedBy: 'rule' }, region: 'overseas', affiliate: { hasAffiliate: false, links: [] }, metrics: { likes: 9800, replies: 1560, reposts: 3400, engagementRate: 89 }, analysis: { sentiment: 'neutral', keywords: ['투자','반도체'], language: 'ko' }, publishedAt: ago(170), source: 'scraper' },
      { threadId: 'demo_deleted_1', author: { username: 'deleted_user123', displayName: '삭제된유저' }, content: { text: '삭제된 게시물. 원본: 쿠팡 할인코드 공유 #할인코드', mediaType: 'text', urls: ['https://link.coupang.com/del001'], hashtags: ['#할인코드'] }, category: { primary: 'shopping', sub: '쿠팡', confidence: 0.8, classifiedBy: 'rule' }, region: 'domestic', affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/del001', platform: 'coupang', detectedIn: 'content' }] }, metrics: { likes: 340, replies: 23, reposts: 12, engagementRate: 45 }, analysis: { sentiment: 'positive', keywords: ['쿠팡'], language: 'ko' }, deletion: { isDeleted: true, deletedAt: ago(30), detectedAt: ago(25), reason: 'user_deleted' }, publishedAt: ago(300), source: 'scraper' },
    ];
    await Thread.insertMany(threads);
    res.json({ success: true, message: threads.length + '개 데모 스레드 추가', total: threads.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
