import { Router } from 'express';
import Thread from '../models/Thread.js';

const router = Router();

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
    const byRegion = await Thread.aggregate([
      { $match: { 'deletion.isDeleted': { $ne: true } } },
      { $group: { _id: { cat: '$category.primary', region: '$region' }, count: { $sum: 1 } } }
    ]);
    const bySentiment = await Thread.aggregate([
      { $match: { 'deletion.isDeleted': { $ne: true } } },
      { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
    ]);

    res.json({
      total, today, profiles: profiles.length, affiliateCount, deleted,
      domestic, overseas,
      byCat: byCat.reduce((o, i) => { o[i._id] = i.count; return o; }, {}),
      byRegion: byRegion.map(i => ({ cat: i._id.cat, region: i._id.region, count: i.count })),
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

// ===== Manual collect trigger =====
router.post('/collector/run', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.json({ success: false, message: 'Meta Threads API 액세스 토큰이 필요합니다. 환경변수 THREADS_ACCESS_TOKEN을 설정하거나 요청 본문에 accessToken을 포함해주세요.' });
    }
    // Fetch user profile
    const profileRes = await fetch('https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url,threads_biography&access_token=' + accessToken);
    const profile = await profileRes.json();
    if (profile.error) return res.json({ success: false, message: 'API 오류: ' + profile.error.message });

    // Fetch user threads
    const threadsRes = await fetch('https://graph.threads.net/v1.0/me/threads?fields=id,text,timestamp,media_type,media_url,permalink,is_quote_post,shortcode&limit=25&access_token=' + accessToken);
    const threadsData = await threadsRes.json();
    if (threadsData.error) return res.json({ success: false, message: 'API 오류: ' + threadsData.error.message });

    let saved = 0;
    for (const t of (threadsData.data || [])) {
      const exists = await Thread.findOne({ threadId: t.id });
      if (exists) continue;

      const mediaType = (t.media_type || 'TEXT').toLowerCase();
      const mappedMedia = mediaType === 'text_post' ? 'text' : mediaType === 'image' ? 'image' : mediaType === 'video' ? 'video' : mediaType === 'carousel_album' ? 'carousel' : 'text';

      const hashtags = (t.text || '').match(/#[\w\uAC00-\uD7A3]+/g) || [];
      const mentions = (t.text || '').match(/@[\w.]+/g) || [];
      const urls = (t.text || '').match(/https?:\/\/[^\s]+/g) || [];

      const isKorean = /[\uAC00-\uD7A3]/.test(t.text || '');
      const hasAliexpress = urls.some(u => /ali/i.test(u));
      const hasCoupang = urls.some(u => /coupang/i.test(u));
      const hasAmazon = urls.some(u => /amzn|amazon/i.test(u));
      const hasRakuten = urls.some(u => /rakuten/i.test(u));
      const hasAffiliate = hasAliexpress || hasCoupang || hasAmazon || hasRakuten;
      const affLinks = [];
      if (hasAliexpress) affLinks.push({ url: urls.find(u => /ali/i.test(u)), platform: 'aliexpress', detectedIn: 'content' });
      if (hasCoupang) affLinks.push({ url: urls.find(u => /coupang/i.test(u)), platform: 'coupang', detectedIn: 'content' });
      if (hasAmazon) affLinks.push({ url: urls.find(u => /amzn|amazon/i.test(u)), platform: 'amazon', detectedIn: 'content' });
      if (hasRakuten) affLinks.push({ url: urls.find(u => /rakuten/i.test(u)), platform: 'rakuten', detectedIn: 'content' });

      let catPrimary = 'personal';
      if (hasAffiliate || /(\uD560\uC778|\uCFE0\uD3F0|\uB9C1\uD06C|\uC138\uC77C|\uCC5C\uC800\uAC00|\uBC30\uC1A1|\uB9AC\uBDF0|\uCD94\uCC9C)/i.test(t.text || '')) catPrimary = 'shopping';
      else if (/(\uC18D\uBCF4|\uB17C\uB780|\uADDC\uC81C|\uC120\uAC70|\uC815\uCE58|\uACBD\uC81C|\uC0AC\uD68C|\uC0AC\uAC74|\uC774\uC288)/i.test(t.text || '')) catPrimary = 'issue';

      const region = isKorean ? 'domestic' : 'overseas';

      await Thread.create({
        threadId: t.id,
        originalUrl: t.permalink || '',
        author: {
          username: profile.username || 'unknown',
          userId: profile.id,
          displayName: profile.name || profile.username,
          profilePicUrl: profile.threads_profile_picture_url || '',
          isVerified: false,
        },
        content: {
          text: t.text || '',
          mediaType: mappedMedia,
          mediaUrls: t.media_url ? [t.media_url] : [],
          thumbnailUrl: mappedMedia === 'image' || mappedMedia === 'video' ? (t.media_url || '') : '',
          videoUrl: mappedMedia === 'video' ? (t.media_url || '') : '',
          urls, hashtags, mentions,
        },
        category: { primary: catPrimary, sub: '', confidence: 0.7, classifiedBy: 'rule' },
        region,
        affiliate: { hasAffiliate, links: affLinks },
        metrics: { likes: 0, replies: 0, reposts: 0, quotes: 0, engagementRate: 0 },
        analysis: { sentiment: 'neutral', keywords: hashtags.map(h => h.replace('#','')).slice(0,5), language: isKorean ? 'ko' : 'en' },
        publishedAt: t.timestamp ? new Date(t.timestamp) : new Date(),
        collectedAt: new Date(),
        source: 'official_api',
      });
      saved++;
    }
    res.json({ success: true, message: saved + '개 스레드 수집 완료 (' + profile.username + ')', total: saved, profile: profile.username });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===== Collector status =====
router.get('/collector/status', async (req, res) => {
  res.json({ running: false, lastRun: null, nextRun: null, hasToken: !!process.env.THREADS_ACCESS_TOKEN });
});

// ===== Seed demo data =====
router.post('/seed-demo', async (req, res) => {
  try {
    await Thread.deleteMany({});
    const now = new Date();
    const ago = (m) => new Date(now - m * 60000);

    const threads = [
      // === 국내 쇼핑 ===
      {
        threadId: 'demo_kr_shop_1', originalUrl: 'https://threads.net/@coupang_picks/1',
        author: { username: 'coupang_picks', displayName: '쿠팡 추천마니아', profilePicUrl: 'https://picsum.photos/seed/cp1/100', followerCount: 45000, isVerified: true },
        content: { text: '🎁 쿠팡 로켓배송 오늘의 핵딜 TOP5 정리했습니다! 댓글에 링크 있어요 #쿠팡 #핵딜 #로켓배송', mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/shop1/600/400','https://picsum.photos/seed/shop1b/600/400','https://picsum.photos/seed/shop1c/600/400'], thumbnailUrl: 'https://picsum.photos/seed/shop1/600/400', urls: ['https://link.coupang.com/xyz789'], hashtags: ['#쿠팡','#핵딜','#로켓배송'] },
        category: { primary: 'shopping', sub: '쿠팡파트너스', confidence: 0.95, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/xyz789', platform: 'coupang', detectedIn: 'content' }] },
        metrics: { likes: 1890, replies: 312, reposts: 445, engagementRate: 88 },
        analysis: { sentiment: 'positive', keywords: ['쿠팡','핵딜','로켓배송'], viralScore: 75, language: 'ko' },
        publishedAt: ago(120), source: 'scraper',
      },
      {
        threadId: 'demo_kr_shop_2', originalUrl: 'https://threads.net/@beauty_haul_kr/2',
        author: { username: 'beauty_haul_kr', displayName: '뷰티하울', profilePicUrl: 'https://picsum.photos/seed/bh1/100', followerCount: 23000, isVerified: false },
        content: { text: '💄 올리브영 립오일 50% 할인! 이건 진짜 나만 아는 가격이에요... 링크 프로필에 #올리브영 #립오일 #뷰티딜', mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/beauty1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/beauty1/600/400', videoUrl: 'https://example.com/video1.mp4', urls: ['https://link.coupang.com/beauty01'], hashtags: ['#올리브영','#립오일','#뷰티딜'] },
        category: { primary: 'shopping', sub: '쿠팡파트너스', confidence: 0.92, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/beauty01', platform: 'coupang', detectedIn: 'content' }] },
        metrics: { likes: 3400, replies: 567, reposts: 234, engagementRate: 91 },
        analysis: { sentiment: 'positive', keywords: ['올리브영','립오일','할인'], viralScore: 82, language: 'ko' },
        publishedAt: ago(90), source: 'scraper',
      },
      // === 해외 쇼핑 ===
      {
        threadId: 'demo_os_shop_1', originalUrl: 'https://threads.net/@deal_hunter_kr/3',
        author: { username: 'deal_hunter_kr', displayName: '딜헌터KR', profilePicUrl: 'https://picsum.photos/seed/dh1/100', followerCount: 18000, isVerified: false },
        content: { text: '🔥 알리 역대급 할인! 에어팟 맥스 호환 케이스 $2.99 링크는 프로필에! #알리익스프레스 #할인 #에어팟맥스', mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/ali1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/ali1/600/400', urls: ['https://ali.ski/abc123'], hashtags: ['#알리익스프레스','#할인','#에어팟맥스'] },
        category: { primary: 'shopping', sub: 'AliExpress', confidence: 0.95, classifiedBy: 'rule' },
        region: 'overseas',
        affiliate: { hasAffiliate: true, links: [{ url: 'https://ali.ski/abc123', platform: 'aliexpress', detectedIn: 'content' }] },
        metrics: { likes: 2340, replies: 189, reposts: 567, engagementRate: 94 },
        analysis: { sentiment: 'positive', keywords: ['알리익스프레스','할인','에어팟맥스'], viralScore: 80, language: 'ko' },
        publishedAt: ago(60), source: 'scraper',
      },
      {
        threadId: 'demo_os_shop_2', originalUrl: 'https://threads.net/@us_deal_master/4',
        author: { username: 'us_deal_master', displayName: '미국직구마스터', profilePicUrl: 'https://picsum.photos/seed/us1/100', followerCount: 32000, isVerified: true },
        content: { text: '🇺🇸 아마존 프라임데이 사전 할인 시작! 갤럭시 버즈3 프로 역대 최저가 #아마존 #프라임데이 #갤럭시버즈', mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/amz1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/amz1/600/400', videoUrl: 'https://example.com/video2.mp4', urls: ['https://amzn.to/def456'], hashtags: ['#아마존','#프라임데이','#갤럭시버즈'] },
        category: { primary: 'shopping', sub: 'Amazon', confidence: 0.96, classifiedBy: 'rule' },
        region: 'overseas',
        affiliate: { hasAffiliate: true, links: [{ url: 'https://amzn.to/def456', platform: 'amazon', detectedIn: 'content' }] },
        metrics: { likes: 3210, replies: 456, reposts: 789, engagementRate: 97 },
        analysis: { sentiment: 'positive', keywords: ['아마존','프라임데이','갤럭시'], viralScore: 90, language: 'ko' },
        publishedAt: ago(180), source: 'scraper',
      },
      {
        threadId: 'demo_os_shop_3', originalUrl: 'https://threads.net/@japan_deal_info/5',
        author: { username: 'japan_deal_info', displayName: '일본직구정보', profilePicUrl: 'https://picsum.photos/seed/jp1/100', followerCount: 15000, isVerified: false },
        content: { text: '🇯🇵 라쿠텐 슈퍼세일 시작! 일본 직구 필수템 리스트 업데이트 #라쿠텐 #일본직구', mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/rkt1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/rkt1/600/400', urls: ['https://a.r10.to/ghi789'], hashtags: ['#라쿠텐','#일본직구'] },
        category: { primary: 'shopping', sub: 'Rakuten', confidence: 0.93, classifiedBy: 'rule' },
        region: 'overseas',
        affiliate: { hasAffiliate: true, links: [{ url: 'https://a.r10.to/ghi789', platform: 'rakuten', detectedIn: 'content' }] },
        metrics: { likes: 1560, replies: 234, reposts: 445, engagementRate: 76 },
        analysis: { sentiment: 'positive', keywords: ['라쿠텐','일본직구','세일'], viralScore: 65, language: 'ko' },
        publishedAt: ago(150), source: 'scraper',
      },
      // === 국내 이슈 ===
      {
        threadId: 'demo_kr_issue_1', originalUrl: 'https://threads.net/@ent_news_live/6',
        author: { username: 'ent_news_live', displayName: '연예뉴스라이브', profilePicUrl: 'https://picsum.photos/seed/ent1/100', followerCount: 120000, isVerified: true },
        content: { text: '🎤 속보: BTS 지민 솔로 월드투어 일정 공개! 서울 콘서트 3회 확정 #BTS #지민 #월드투어', mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/bts1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/bts1/600/400', hashtags: ['#BTS','#지민','#월드투어'] },
        category: { primary: 'issue', sub: '연예', confidence: 0.97, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 45200, replies: 8900, reposts: 12300, engagementRate: 99 },
        analysis: { sentiment: 'positive', keywords: ['BTS','지민','월드투어','콘서트'], viralScore: 99, language: 'ko' },
        publishedAt: ago(20), source: 'scraper',
      },
      {
        threadId: 'demo_kr_issue_2', originalUrl: 'https://threads.net/@politics_watch/7',
        author: { username: 'politics_watch', displayName: '정치워치', profilePicUrl: 'https://picsum.photos/seed/pol1/100', followerCount: 67000, isVerified: true },
        content: { text: '🏛️ 국회 AI 규제법안 본회의 통과... 업계 반응 엇갈리는 #AI규제 #국회 #법안통과', mediaType: 'text', hashtags: ['#AI규제','#국회','#법안통과'] },
        category: { primary: 'issue', sub: '시사', confidence: 0.94, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 8900, replies: 2340, reposts: 3400, engagementRate: 85 },
        analysis: { sentiment: 'neutral', keywords: ['AI규제','국회','법안'], viralScore: 78, language: 'ko' },
        publishedAt: ago(100), source: 'scraper',
      },
      {
        threadId: 'demo_kr_issue_3', originalUrl: 'https://threads.net/@sports_flash/8',
        author: { username: 'sports_flash', displayName: '스포츠플래시', profilePicUrl: 'https://picsum.photos/seed/sp1/100', followerCount: 89000, isVerified: true },
        content: { text: '⚽ 손흥민 시즌 20호골 폭발! EPL 득점왕 경쟁 본격화 #손흥민 #EPL #득점왕', mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/son1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/son1/600/400', videoUrl: 'https://example.com/son.mp4', hashtags: ['#손흥민','#EPL','#득점왕'] },
        category: { primary: 'issue', sub: '스포츠', confidence: 0.96, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 34500, replies: 5600, reposts: 8900, engagementRate: 96 },
        analysis: { sentiment: 'positive', keywords: ['손흥민','EPL','득점왕'], viralScore: 95, language: 'ko' },
        publishedAt: ago(30), source: 'scraper',
      },
      // === 해외 이슈 ===
      {
        threadId: 'demo_os_issue_1', originalUrl: 'https://threads.net/@tech_insider_kr/9',
        author: { username: 'tech_insider_kr', displayName: '테크인사이더', profilePicUrl: 'https://picsum.photos/seed/tech1/100', followerCount: 95000, isVerified: true },
        content: { text: '💻 OpenAI GPT-5 출시 임박설... 멀티모달 성능 대폭 향상 예고 #OpenAI #GPT5 #AI', mediaType: 'video', mediaUrls: ['https://picsum.photos/seed/gpt1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/gpt1/600/400', videoUrl: 'https://example.com/gpt5.mp4', hashtags: ['#OpenAI','#GPT5','#AI'] },
        category: { primary: 'issue', sub: 'IT/테크', confidence: 0.95, classifiedBy: 'rule' },
        region: 'overseas',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 12400, replies: 3200, reposts: 5600, engagementRate: 92 },
        analysis: { sentiment: 'positive', keywords: ['OpenAI','GPT5','AI','멀티모달'], viralScore: 88, language: 'ko' },
        publishedAt: ago(200), source: 'scraper',
      },
      {
        threadId: 'demo_os_issue_2', originalUrl: 'https://threads.net/@money_signal/10',
        author: { username: 'money_signal', displayName: '머니시그널', profilePicUrl: 'https://picsum.photos/seed/money1/100', followerCount: 54000, isVerified: false },
        content: { text: '💰 미 연준 금리 동결 전망 우세... 코스피 3,200 돌파 가능성은? #금리 #코스피 #연준', mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/stock1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/stock1/600/400', hashtags: ['#금리','#코스피','#연준'] },
        category: { primary: 'issue', sub: '경제', confidence: 0.93, classifiedBy: 'rule' },
        region: 'overseas',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 5600, replies: 890, reposts: 1200, engagementRate: 78 },
        analysis: { sentiment: 'neutral', keywords: ['금리','코스피','연준'], viralScore: 70, language: 'ko' },
        publishedAt: ago(140), source: 'scraper',
      },
      // === 국내 퍼스널 ===
      {
        threadId: 'demo_kr_personal_1', originalUrl: 'https://threads.net/@growth_hacker_jin/11',
        author: { username: 'growth_hacker_jin', displayName: '그로스해커진', profilePicUrl: 'https://picsum.photos/seed/gh1/100', followerCount: 28000, isVerified: false },
        content: { text: '🚀 스레드 알고리즘 완전 분석! 도달율 300% 올리는 5가지 팁 공개합니다 #마케팅 #스레드 #알고리즘', mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/mk1/600/400','https://picsum.photos/seed/mk2/600/400'], thumbnailUrl: 'https://picsum.photos/seed/mk1/600/400', hashtags: ['#마케팅','#스레드','#알고리즘'] },
        category: { primary: 'personal', sub: '마케팅', confidence: 0.91, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 6700, replies: 890, reposts: 2300, engagementRate: 91 },
        analysis: { sentiment: 'positive', keywords: ['스레드','알고리즘','도달율','마케팅'], viralScore: 83, language: 'ko' },
        publishedAt: ago(35), source: 'scraper',
      },
      {
        threadId: 'demo_kr_personal_2', originalUrl: 'https://threads.net/@design_muse/12',
        author: { username: 'design_muse', displayName: '디자인뮤즈', profilePicUrl: 'https://picsum.photos/seed/ds1/100', followerCount: 19000, isVerified: false },
        content: { text: '🎨 Figma AI 기능 실무 활용법 총정리, 디자이너 생산성 2배 올리기 #Figma #디자인 #AI', mediaType: 'carousel', mediaUrls: ['https://picsum.photos/seed/fig1/600/400','https://picsum.photos/seed/fig2/600/400','https://picsum.photos/seed/fig3/600/400'], thumbnailUrl: 'https://picsum.photos/seed/fig1/600/400', hashtags: ['#Figma','#디자인','#AI'] },
        category: { primary: 'personal', sub: '디자인', confidence: 0.89, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 4300, replies: 670, reposts: 1800, engagementRate: 82 },
        analysis: { sentiment: 'positive', keywords: ['Figma','AI','디자인','생산성'], viralScore: 72, language: 'ko' },
        publishedAt: ago(160), source: 'scraper',
      },
      // === 해외 퍼스널 ===
      {
        threadId: 'demo_os_personal_1', originalUrl: 'https://threads.net/@warren_kr/13',
        author: { username: 'warren_kr', displayName: '한국의워렌', profilePicUrl: 'https://picsum.photos/seed/wr1/100', followerCount: 41000, isVerified: false },
        content: { text: '📈 2026년 상반기 포트폴리오 리밸런싱 전략, 반도체 비중 확대 이유는... #투자 #포트폴리오 #반도체', mediaType: 'image', mediaUrls: ['https://picsum.photos/seed/inv1/600/400'], thumbnailUrl: 'https://picsum.photos/seed/inv1/600/400', hashtags: ['#투자','#포트폴리오','#반도체'] },
        category: { primary: 'personal', sub: '투자', confidence: 0.88, classifiedBy: 'rule' },
        region: 'overseas',
        affiliate: { hasAffiliate: false, links: [] },
        metrics: { likes: 9800, replies: 1560, reposts: 3400, engagementRate: 89 },
        analysis: { sentiment: 'neutral', keywords: ['투자','포트폴리오','반도체'], viralScore: 77, language: 'ko' },
        publishedAt: ago(170), source: 'scraper',
      },
      // === 삭제된 콘텐츠 ===
      {
        threadId: 'demo_deleted_1', originalUrl: 'https://threads.net/@deleted_user123/14',
        author: { username: 'deleted_user123', displayName: '삭제된유저', profilePicUrl: '', followerCount: 500, isVerified: false },
        content: { text: '이 게시물은 작성자에 의해 삭제되었습니다. 원본 내용: 친구가 알려준 쿠팡 할인코드 공유합니다 #할인코드', mediaType: 'text', urls: ['https://link.coupang.com/del001'], hashtags: ['#할인코드'] },
        category: { primary: 'shopping', sub: '쿠팡파트너스', confidence: 0.8, classifiedBy: 'rule' },
        region: 'domestic',
        affiliate: { hasAffiliate: true, links: [{ url: 'https://link.coupang.com/del001', platform: 'coupang', detectedIn: 'content' }] },
        metrics: { likes: 340, replies: 23, reposts: 12, engagementRate: 45 },
        analysis: { sentiment: 'positive', keywords: ['쿠팡','할인코드'], viralScore: 20, language: 'ko' },
        deletion: { isDeleted: true, deletedAt: ago(30), detectedAt: ago(25), reason: 'user_deleted' },
        publishedAt: ago(300), source: 'scraper',
      },
    ];

    await Thread.insertMany(threads);
    res.json({ success: true, message: threads.length + '개 데모 스레드 추가 (국내/해외 구분 포함, 삭제된 콘텐츠 1건)', total: threads.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
