// ThreadsScraper - HTTP-based Threads data collector (no Playwright needed)
const https = require('https');

class ThreadsScraper {
  constructor() {
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
    };
    this.graphqlHeaders = {
      'User-Agent': 'Barcelona 289.0.0.77.109 Android',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-IG-App-ID': '238260118697367',
      'Accept': '*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    };
  }

  _fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Request timeout')), 15000);
      const urlObj = new URL(url);
      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || this.headers,
      };
      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          clearTimeout(timeout);
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      });
      req.on('error', (err) => { clearTimeout(timeout); reject(err); });
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  async _fetchJSON(url, options = {}) {
    const res = await this._fetch(url, options);
    try {
      return JSON.parse(res.data);
    } catch (e) {
      return null;
    }
  }

  _extractThreadsFromHTML(html) {
    const threads = [];
    try {
      // Extract thread data from SSR HTML or embedded JSON
      const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const script of scriptMatches) {
        const content = script.replace(/<\/?script[^>]*>/gi, '');
        if (content.includes('thread_items') || content.includes('post_id') || content.includes('"code"')) {
          // Try to find JSON data
          const jsonMatches = content.match(/\{[\s\S]{50,}\}/g) || [];
          for (const jsonStr of jsonMatches) {
            try {
              const data = JSON.parse(jsonStr);
              this._extractFromObject(data, threads);
            } catch (e) {}
          }
        }
      }
      // Also extract thread URLs directly from HTML
      const urlMatches = html.match(/threads\.net\/@[\w.]+\/post\/[A-Za-z0-9_-]+/g) || [];
      urlMatches.forEach(u => {
        const fullUrl = 'https://www.' + u;
        if (!threads.find(t => t.url === fullUrl)) {
          threads.push({ url: fullUrl, text: '', author: u.split('/@')[1]?.split('/')[0] || '' });
        }
      });
    } catch (e) {
      console.warn('[ThreadsScraper] HTML parse error:', e.message);
    }
    return threads;
  }

  _extractFromObject(obj, threads, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (obj.code && obj.user && obj.user.username) {
      const url = `https://www.threads.net/@\${obj.user.username}/post/\${obj.code}`;
      if (!threads.find(t => t.url === url)) {
        threads.push({
          url,
          text: obj.caption?.text || '',
          author: obj.user.username,
          likes: obj.like_count || 0,
          replies: obj.text_post_app_info?.direct_reply_count || 0,
        });
      }
    }
    if (Array.isArray(obj)) {
      obj.forEach(item => this._extractFromObject(item, threads, depth + 1));
    } else {
      Object.values(obj).forEach(val => {
        if (val && typeof val === 'object') this._extractFromObject(val, threads, depth + 1);
      });
    }
  }

  async scrapeProfile(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username');
    }
    const cleanUser = username.replace('@', '').trim();
    console.log(`[ThreadsScraper] Fetching profile: @\${cleanUser}`);

    try {
      const res = await this._fetch(`https://www.threads.net/@\${cleanUser}`);
      const threads = this._extractThreadsFromHTML(res.data);
      console.log(`[ThreadsScraper] Found \${threads.length} threads from @\${cleanUser}`);
      
      return {
        success: threads.length > 0,
        profile: { displayName: cleanUser, bio: '', profilePicUrl: '', profileUrl: `https://www.threads.net/@\${cleanUser}` },
        threads: threads.map(t => t.url),
        graphqlResponseCount: 0
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Profile error: \${err.message}`);
      return { success: false, profile: { displayName: cleanUser }, threads: [], error: err.message };
    }
  }

  async scrapeKeywords(keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error('Keywords must be a non-empty array');
    }

    const discoveredUrls = new Map();

    for (const keyword of keywords) {
      try {
        if (typeof keyword !== 'string' || !keyword.trim()) continue;
        console.log(`[ThreadsScraper] Searching: "\${keyword}"`);

        // Method 1: Try threads.net search page
        const searchUrl = `https://www.threads.net/search?q=\${encodeURIComponent(keyword.trim())}&serp_type=default`;
        const res = await this._fetch(searchUrl);
        const threads = this._extractThreadsFromHTML(res.data);
        
        threads.forEach(t => {
          discoveredUrls.set(t.url, { url: t.url, keyword: keyword.trim(), discovered: new Date().toISOString() });
        });

        console.log(`[ThreadsScraper] Found \${threads.length} threads for "\${keyword}"`);
      } catch (err) {
        console.warn(`[ThreadsScraper] Error searching "\${keyword}": \${err.message}`);
      }
    }

    // If search found nothing, try homepage/explore
    if (discoveredUrls.size === 0) {
      try {
        console.log('[ThreadsScraper] Search empty, trying homepage...');
        const res = await this._fetch('https://www.threads.net/');
        const threads = this._extractThreadsFromHTML(res.data);
        threads.forEach(t => {
          discoveredUrls.set(t.url, { url: t.url, keyword: 'trending', discovered: new Date().toISOString() });
        });
        console.log(`[ThreadsScraper] Found \${threads.length} threads from homepage`);
      } catch (err) {
        console.warn(`[ThreadsScraper] Homepage error: \${err.message}`);
      }
    }

    const results = Array.from(discoveredUrls.values()).slice(0, 30);
    return {
      success: results.length > 0,
      keywords: keywords.length,
      threadsDiscovered: results.length,
      threads: results
    };
  }

  async scrapeThreadDetail(threadUrl) {
    console.log(`[ThreadsScraper] Fetching thread: \${threadUrl}`);
    try {
      const res = await this._fetch(threadUrl);
      const threads = this._extractThreadsFromHTML(res.data);
      
      // Extract OG meta tags as fallback
      const ogTitle = res.data.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) || [];
      const ogDesc = res.data.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/) || [];
      const ogImage = res.data.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/) || [];
      
      const urlParts = threadUrl.match(/\/@([\w.]+)\/post\/([\w-]+)/);
      const author = urlParts ? urlParts[1] : '';
      const postCode = urlParts ? urlParts[2] : '';

      return {
        success: true,
        thread: {
          id: postCode,
          url: threadUrl,
          author: author,
          text: ogDesc[1] || (threads[0] && threads[0].text) || '',
          title: ogTitle[1] || '',
          imageUrl: ogImage[1] || '',
          publishedAt: new Date().toISOString(),
          metrics: {
            likes: (threads[0] && threads[0].likes) || 0,
            replies: (threads[0] && threads[0].replies) || 0,
            views: 0,
          },
          links: this._extractLinks(res.data),
        }
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Thread detail error: \${err.message}`);
      return { success: false, error: err.message };
    }
  }

  _extractLinks(html) {
    const links = [];
    const linkMatches = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
    linkMatches.forEach(url => {
      if (!url.includes('threads.net') && !url.includes('instagram.com') && !url.includes('facebook.com')
          && !url.includes('cdninstagram') && !url.includes('fbcdn')) {
        if (!links.includes(url)) links.push(url);
      }
    });
    return links.slice(0, 10);
  }

  async scrapeComments(threadUrl) {
    // Comments require authenticated API - return empty for now
    return { success: true, comments: [] };
  }

  async scrapeProfileLinks(username) {
    try {
      const res = await this._fetch(`https://www.threads.net/@\${username.replace('@','')}`);
      const links = this._extractLinks(res.data);
      return { success: true, links };
    } catch (err) {
      return { success: false, links: [], error: err.message };
    }
  }

  async close() {
    // No browser to close - HTTP-based scraper
    console.log('[ThreadsScraper] HTTP scraper - nothing to close');
  }
}

module.exports = ThreadsScraper;
