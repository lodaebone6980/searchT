import { chromium } from 'playwright-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

export default class ThreadsScraper {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (this.browser) return;
    this.browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // Clean scraped text by removing Threads UI elements
  _cleanText(raw) {
    let text = raw;
    // Remove username + verified badge prefix (e.g., "zuck인증된 계정")
    text = text.replace(/^[\w.]+인증된\s*계정/, '');
    // Remove date patterns like "2025-12-03"
    text = text.replace(/\d{4}-\d{2}-\d{2}/g, '');
    // Remove "더 보기" (show more) and "수정됨" (edited) labels
    text = text.replace(/더\s*보기/g, '');
    text = text.replace(/수정됨/g, '');
    // Remove trailing Threads UI buttons text
    text = text.replace(/번역하기/g, '');
    text = text.replace(/좋아요\d*/g, '');
    text = text.replace(/댓글\d*/g, '');
    text = text.replace(/리포스트\d*/g, '');
    text = text.replace(/공유하기\d*/g, '');
    text = text.replace(/답글\s*달기/g, '');
    text = text.replace(/팔로우/g, '');
    text = text.replace(/팔로워\s*[\d,.만천]+/g, '');
    // Remove "N시간 전", "N일 전", "N분 전" etc. time labels
    text = text.replace(/\d+[시일분초]간?\s*전/g, '');
    // Clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  // Extract metrics from raw UI text
  _extractMetrics(raw) {
    const metrics = { likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 0 };

    // Parse Korean UI metrics: 좋아요277, 댓글29, 리포스트17, 공유하기19
    const likeMatch = raw.match(/좋아요([\d,.]+[만천]?)/);
    const replyMatch = raw.match(/댓글([\d,.]+[만천]?)/);
    const repostMatch = raw.match(/리포스트([\d,.]+[만천]?)/);
    const shareMatch = raw.match(/공유하기([\d,.]+[만천]?)/);

    const parseNum = (str) => {
      if (!str) return 0;
      str = str.replace(/,/g, '');
      if (str.includes('만')) return parseFloat(str) * 10000;
      if (str.includes('천')) return parseFloat(str) * 1000;
      return parseInt(str) || 0;
    };

    if (likeMatch) metrics.likeCount = parseNum(likeMatch[1]);
    if (replyMatch) metrics.replyCount = parseNum(replyMatch[1]);
    if (repostMatch) metrics.repostCount = parseNum(repostMatch[1]);
    if (shareMatch) metrics.quoteCount = parseNum(shareMatch[1]);

    return metrics;
  }

  // Scrape a public Threads profile
  async scrapeProfile(username) {
    await this.init();
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      locale: 'ko-KR',
    });

    const page = await context.newPage();
    const results = { profile: null, threads: [] };

    try {
      const url = 'https://www.threads.net/@' + username;
      console.log('[Scraper] Navigating to:', url);

      // Intercept API calls to capture data
      const capturedData = [];
      page.on('response', async (response) => {
        const reqUrl = response.url();
        if (reqUrl.includes('/api/graphql')) {
          try {
            const json = await response.json();
            capturedData.push(json);
          } catch (e) {}
        }
      });

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Scroll down to trigger more content loading
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(2000);

      // Try to extract profile info from the page
      const profileData = await page.evaluate(() => {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        const ogDesc = document.querySelector('meta[property="og:description"]');
        const ogImage = document.querySelector('meta[property="og:image"]');

        return {
          title: ogTitle ? ogTitle.content : '',
          description: ogDesc ? ogDesc.content : '',
          image: ogImage ? ogImage.content : '',
        };
      });

      // Parse profile from meta data
      const titleMatch = profileData.title.match(/^(.+?)\s*\(@(.+?)\)/);
      results.profile = {
        username: username,
        displayName: titleMatch ? titleMatch[1] : username,
        bio: profileData.description || '',
        profilePicUrl: profileData.image || '',
      };

      // Try to scrape threads from the rendered page
      const pageThreads = await page.evaluate(() => {
        const posts = [];
        // Threads renders posts in article-like containers
        const textElements = document.querySelectorAll('[data-pressable-container="true"]');

        if (textElements.length === 0) {
          // Fallback: try to find any text content blocks
          const allText = document.querySelectorAll('span');
          const seen = new Set();
          allText.forEach(el => {
            const text = el.textContent.trim();
            // Filter for actual post content (longer text)
            if (text.length > 30 && !seen.has(text) && !text.includes('followers') && !text.includes('Log in')) {
              seen.add(text);
              posts.push({ text, rawText: text, type: 'text' });
            }
          });
        } else {
          textElements.forEach(el => {
            const rawText = el.textContent.trim();
            if (rawText.length > 10) {
              const img = el.querySelector('img[src*="scontent"]');
              const video = el.querySelector('video');
              posts.push({
                text: rawText,
                rawText: rawText,
                type: video ? 'video' : img ? 'image' : 'text',
                imageUrl: img ? img.src : null,
              });
            }
          });
        }
        return posts;
      });

      // Also try to extract from captured GraphQL responses
      for (const data of capturedData) {
        try {
          this._extractThreadsFromGraphQL(data, results, username);
        } catch (e) {}
      }

      // If GraphQL didn't yield results, use page scraping with cleaning
      if (results.threads.length === 0 && pageThreads.length > 0) {
        pageThreads.forEach((pt, i) => {
          const rawText = pt.rawText || pt.text;
          const cleanedText = this._cleanText(rawText);
          const metrics = this._extractMetrics(rawText);

          // Only include if cleaned text has meaningful content
          if (cleanedText.length > 10) {
            results.threads.push({
              threadId: 'scraped_' + username + '_' + Date.now() + '_' + i,
              text: cleanedText,
              mediaType: pt.type,
              imageUrl: pt.imageUrl,
              likeCount: metrics.likeCount,
              replyCount: metrics.replyCount,
              repostCount: metrics.repostCount,
              quoteCount: metrics.quoteCount,
              timestamp: new Date(),
            });
          }
        });
      }

      console.log('[Scraper] Found', results.threads.length, 'threads for @' + username);
    } catch (e) {
      console.error('[Scraper] Error:', e.message);
    } finally {
      await context.close();
    }

    return results;
  }

  _extractThreadsFromGraphQL(data, results, username) {
    // Navigate through Threads GraphQL response structure
    const edges = this._findEdges(data);
    for (const edge of edges) {
      const node = edge.node || edge;
      const post = node.thread_items?.[0]?.post || node.post || node;

      if (!post || !post.caption) continue;

      const text = post.caption?.text || '';
      const mediaType = post.media_type === 1 ? 'image' : post.media_type === 2 ? 'video' : post.carousel_media ? 'carousel' : 'text';

      const imageUrl = post.image_versions2?.candidates?.[0]?.url || '';
      const videoUrl = post.video_versions?.[0]?.url || '';

      results.threads.push({
        threadId: post.pk || post.id || ('scraped_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
        text,
        mediaType,
        imageUrl,
        videoUrl,
        likeCount: post.like_count || 0,
        replyCount: post.text_post_app_info?.direct_reply_count || 0,
        repostCount: post.text_post_app_info?.repost_count || 0,
        quoteCount: post.text_post_app_info?.quote_count || 0,
        timestamp: post.taken_at ? new Date(post.taken_at * 1000) : new Date(),
        permalink: post.code ? 'https://www.threads.net/@' + username + '/post/' + post.code : '',
      });
    }
  }

  _findEdges(obj) {
    const edges = [];
    if (!obj || typeof obj !== 'object') return edges;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        edges.push(...this._findEdges(item));
      }
    } else {
      if (obj.edges && Array.isArray(obj.edges)) {
        edges.push(...obj.edges);
      }
      if (obj.thread_items && Array.isArray(obj.thread_items)) {
        edges.push(obj);
      }
      for (const key of Object.keys(obj)) {
        if (key !== 'edges' && key !== 'thread_items') {
          edges.push(...this._findEdges(obj[key]));
        }
      }
    }
    return edges;
  }
}
