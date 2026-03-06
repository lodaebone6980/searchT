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

      // Try to extract profile info from the page
      const profileData = await page.evaluate(() => {
        // Look for meta tags
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
            // Filter for actual post content (longer text, has hashtags or mentions)
            if (text.length > 30 && !seen.has(text) && !text.includes('followers') && !text.includes('Log in')) {
              seen.add(text);
              posts.push({ text, type: 'text' });
            }
          });
        } else {
          textElements.forEach(el => {
            const text = el.textContent.trim();
            if (text.length > 10) {
              // Check for images/videos inside
              const img = el.querySelector('img[src*="scontent"]');
              const video = el.querySelector('video');
              posts.push({
                text,
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

      // If GraphQL didn't yield results, use page scraping
      if (results.threads.length === 0 && pageThreads.length > 0) {
        pageThreads.forEach((pt, i) => {
          results.threads.push({
            threadId: 'scraped_' + username + '_' + Date.now() + '_' + i,
            text: pt.text,
            mediaType: pt.type,
            imageUrl: pt.imageUrl,
            timestamp: new Date(),
          });
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
