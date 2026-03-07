// ThreadsScraper - Threads GraphQL API based collector
import https from 'https';

class ThreadsScraper {
  constructor() {
    this.lsdToken = null;
    this.initialized = false;

    this.headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
    };

    this.apiHeaders = {
      'User-Agent': 'Barcelona 289.0.0.77.109 Android',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-IG-App-ID': '238260118697367',
      'Accept': '*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Sec-Fetch-Site': 'same-origin',
      'X-FB-LSD': '',
    };

    // Known Korean Threads profiles per category
    this.categoryProfiles = {
      shopping: ['styler_official', 'musinsa.official', 'oliveyoung_official', 'kurly.official', 'coupang.official'],
      issue: ['jtbcnews', 'sbsnews8', 'yaborpress', 'newneek', 'theqoo.official'],
      personal: ['zuck', 'mosseri', 'threads']
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
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearTimeout(timeout);
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `https://${urlObj.hostname}${res.headers.location}`;
          this._fetch(redirectUrl, options).then(resolve).catch(reject);
          return;
        }
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

  async _init() {
    if (this.initialized) return;
    try {
      console.log('[ThreadsScraper] Initializing - fetching tokens...');
      const res = await this._fetch('https://www.threads.net/');

      // Extract LSD token from HTML (multiple patterns)
      const patterns = [
        /"LSD",\[\],\{"token":"([^"]+)"\}/,
        /name="lsd" value="([^"]+)"/,
        /"lsd_token":"([^"]+)"/,
        /LSD.*?"token":"([^"]+)"/,
      ];

      for (const pattern of patterns) {
        const match = res.data.match(pattern);
        if (match) {
          this.lsdToken = match[1];
          this.apiHeaders['X-FB-LSD'] = this.lsdToken;
          console.log('[ThreadsScraper] Got LSD token');
          break;
        }
      }

      this.initialized = true;
      console.log('[ThreadsScraper] Init complete. LSD: ' + (this.lsdToken ? 'yes' : 'no'));
    } catch (err) {
      console.error('[ThreadsScraper] Init error:', err.message);
      this.initialized = true;
    }
  }

  async _graphqlRequest(docId, variables = {}) {
    await this._init();

    const params = new URLSearchParams();
    if (this.lsdToken) params.append('lsd', this.lsdToken);
    params.append('variables', JSON.stringify(variables));
    params.append('doc_id', docId);

    const body = params.toString();

    try {
      const res = await this._fetch('https://www.threads.net/api/graphql', {
        method: 'POST',
        body,
        headers: {
          ...this.apiHeaders,
          'Content-Length': Buffer.byteLength(body).toString(),
        }
      });

      if (res.data) {
        try {
          return JSON.parse(res.data);
        } catch (e) {
          // Sometimes response has multiple JSON objects separated by newlines
          const lines = res.data.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              return JSON.parse(line);
            } catch (e2) {}
          }
        }
      }
    } catch (err) {
      console.warn('[ThreadsScraper] GraphQL request failed:', err.message);
    }
    return null;
  }

  _extractThreadsFromData(data) {
    const threads = [];
    if (!data) return threads;

    const seen = new Set();

    const extract = (obj, depth = 0) => {
      if (depth > 20 || !obj || typeof obj !== 'object') return;

      // Pattern 1: thread_items array (Threads native format)
      if (obj.thread_items && Array.isArray(obj.thread_items)) {
        for (const item of obj.thread_items) {
          const post = item.post || item;
          if (post && post.code && !seen.has(post.code)) {
            seen.add(post.code);
            const username = post.user?.username || '';
            threads.push({
              url: `https://www.threads.net/@${username}/post/${post.code}`,
              text: post.caption?.text || '',
              author: username,
              likes: post.like_count || 0,
              replies: post.text_post_app_info?.direct_reply_count || 0,
              timestamp: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : null,
              imageUrl: post.image_versions2?.candidates?.[0]?.url || '',
            });
          }
        }
      }

      // Pattern 2: edges with nodes (GraphQL standard)
      if (obj.edges && Array.isArray(obj.edges)) {
        for (const edge of obj.edges) {
          if (edge.node) extract(edge.node, depth + 1);
        }
      }

      // Pattern 3: items array
      if (obj.items && Array.isArray(obj.items)) {
        for (const item of obj.items) {
          extract(item, depth + 1);
        }
      }

      // Recurse into sub-objects
      if (Array.isArray(obj)) {
        obj.forEach(item => extract(item, depth + 1));
      } else {
        for (const [key, val] of Object.entries(obj)) {
          if (val && typeof val === 'object') {
            extract(val, depth + 1);
          }
        }
      }
    };

    extract(data);
    return threads;
  }

  _extractFromHTML(html) {
    const threads = [];
    try {
      // Extract from script tags containing thread data
      const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const script of scriptMatches) {
        const content = script.replace(/<\/?script[^>]*>/gi, '');
        if (content.includes('thread_items') || content.includes('post_id') || content.includes('"code"')) {
          const jsonMatches = content.match(/\{[\s\S]{50,}\}/g) || [];
          for (const jsonStr of jsonMatches) {
            try {
              const data = JSON.parse(jsonStr);
              threads.push(...this._extractThreadsFromData(data));
            } catch (e) {}
          }
        }
      }

      // Extract thread URLs from HTML links
      const urlMatches = html.match(/threads\.net\/@[\w.]+\/post\/[A-Za-z0-9_-]+/g) || [];
      const seen = new Set(threads.map(t => t.url));
      urlMatches.forEach(u => {
        const fullUrl = 'https://www.' + u;
        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          threads.push({ url: fullUrl, text: '', author: u.split('/@')[1]?.split('/')[0] || '' });
        }
      });
    } catch (e) {
      console.warn('[ThreadsScraper] HTML parse error:', e.message);
    }
    return threads;
  }

  async scrapeProfile(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username');
    }

    const cleanUser = username.replace('@', '').trim();
    console.log(`[ThreadsScraper] Fetching profile: @${cleanUser}`);

    const allThreads = [];

    // Method 1: GraphQL API for user threads
    try {
      const result = await this._graphqlRequest('23996318473300828', { username: cleanUser });
      if (result) {
        const found = this._extractThreadsFromData(result);
        allThreads.push(...found);
        console.log(`[ThreadsScraper] GraphQL: ${found.length} threads for @${cleanUser}`);
      }
    } catch (err) {
      console.warn(`[ThreadsScraper] GraphQL profile error: ${err.message}`);
    }

    // Method 2: Alternative GraphQL doc_id
    if (allThreads.length === 0) {
      try {
        const result = await this._graphqlRequest('6232751443445612', { userID: cleanUser });
        if (result) {
          const found = this._extractThreadsFromData(result);
          allThreads.push(...found);
          console.log(`[ThreadsScraper] GraphQL alt: ${found.length} threads for @${cleanUser}`);
        }
      } catch (err) {
        console.warn(`[ThreadsScraper] GraphQL alt error: ${err.message}`);
      }
    }

    // Method 3: HTML page with embedded data
    if (allThreads.length === 0) {
      try {
        const res = await this._fetch(`https://www.threads.net/@${cleanUser}`);
        const found = this._extractFromHTML(res.data);
        allThreads.push(...found);
        console.log(`[ThreadsScraper] HTML: ${found.length} threads for @${cleanUser}`);
      } catch (err) {
        console.warn(`[ThreadsScraper] HTML profile error: ${err.message}`);
      }
    }

    return {
      success: allThreads.length > 0,
      profile: { displayName: cleanUser, bio: '', profilePicUrl: '', profileUrl: `https://www.threads.net/@${cleanUser}` },
      threads: allThreads.map(t => t.url),
      graphqlResponseCount: allThreads.length,
    };
  }

  async scrapeKeywords(keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error('Keywords must be a non-empty array');
    }

    const discoveredUrls = new Map();
    await this._init();

    for (const keyword of keywords) {
      if (typeof keyword !== 'string' || !keyword.trim()) continue;
      console.log(`[ThreadsScraper] Searching: "${keyword}"`);

      // Method 1: GraphQL search
      try {
        const searchResult = await this._graphqlRequest('26277468008498498', {
          query: keyword.trim(),
          search_surface: 'default',
        });
        if (searchResult) {
          const threads = this._extractThreadsFromData(searchResult);
          threads.forEach(t => {
            discoveredUrls.set(t.url, { ...t, keyword: keyword.trim(), discovered: new Date().toISOString() });
          });
          console.log(`[ThreadsScraper] GraphQL search: ${threads.length} for "${keyword}"`);
        }
      } catch (err) {
        console.warn(`[ThreadsScraper] GraphQL search error: ${err.message}`);
      }

      // Method 2: HTML search page
      try {
        const searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword.trim())}&serp_type=default`;
        const res = await this._fetch(searchUrl);
        const threads = this._extractFromHTML(res.data);
        threads.forEach(t => {
          if (!discoveredUrls.has(t.url)) {
            discoveredUrls.set(t.url, { ...t, keyword: keyword.trim(), discovered: new Date().toISOString() });
          }
        });
        console.log(`[ThreadsScraper] HTML search: ${threads.length} for "${keyword}"`);
      } catch (err) {
        console.warn(`[ThreadsScraper] HTML search error: ${err.message}`);
      }

      // Small delay between keywords
      await new Promise(r => setTimeout(r, 800));
    }

    // Fallback: If search found nothing, scrape known profiles
    if (discoveredUrls.size === 0) {
      console.log('[ThreadsScraper] Search empty, trying known profiles as fallback...');
      const allProfiles = [
        ...this.categoryProfiles.shopping,
        ...this.categoryProfiles.issue,
        ...this.categoryProfiles.personal,
      ];

      for (const profile of allProfiles.slice(0, 8)) {
        try {
          const profileResult = await this.scrapeProfile(profile);
          if (profileResult.threads && profileResult.threads.length > 0) {
            profileResult.threads.forEach(url => {
              if (!discoveredUrls.has(url)) {
                discoveredUrls.set(url, { url, keyword: 'profile:' + profile, discovered: new Date().toISOString() });
              }
            });
          }
        } catch (err) {
          console.warn(`[ThreadsScraper] Profile fallback error @${profile}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 500));
      }
      console.log(`[ThreadsScraper] Profile fallback total: ${discoveredUrls.size} threads`);
    }

    const results = Array.from(discoveredUrls.values()).slice(0, 30);
    return {
      success: results.length > 0,
      threads: results,
    };
  }

  async scrapeThreadDetail(threadUrl) {
    console.log(`[ThreadsScraper] Fetching detail: ${threadUrl}`);

    try {
      const res = await this._fetch(threadUrl);
      const html = res.data;

      // Extract OG meta tags
      const ogTitle = (html.match(/property="og:title"\s+content="([^"]*)"/) || [])[1] || '';
      const ogDesc = (html.match(/property="og:description"\s+content="([^"]*)"/) || [])[1] || '';
      const ogImage = (html.match(/property="og:image"\s+content="([^"]*)"/) || [])[1] || '';
      const ogUrl = (html.match(/property="og:url"\s+content="([^"]*)"/) || [])[1] || threadUrl;

      // Try author from URL
      const authorMatch = threadUrl.match(/@([\w.]+)/);
      const author = authorMatch ? authorMatch[1] : '';

      // Try embedded JSON data
      let threadData = {};
      const htmlThreads = this._extractFromHTML(html);
      if (htmlThreads.length > 0) {
        threadData = htmlThreads[0];
      }

      const text = threadData.text || ogDesc || ogTitle;

      return {
        url: ogUrl || threadUrl,
        author: threadData.author || author,
        content: text,
        text: text,
        likes: threadData.likes || 0,
        replies: threadData.replies || 0,
        timestamp: threadData.timestamp || new Date().toISOString(),
        imageUrl: threadData.imageUrl || ogImage,
        externalLinks: (text.match(/https?:\/\/[^\s"<>]+/g) || []),
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Detail error: ${err.message}`);
      return { url: threadUrl, author: '', content: '', text: '', likes: 0, replies: 0, externalLinks: [] };
    }
  }

  async scrapeComments(threadUrl) {
    // Comments require authentication - return empty
    return { comments: [], count: 0 };
  }

  async scrapeProfileLinks(username) {
    const cleanUser = username.replace('@', '').trim();
    try {
      const res = await this._fetch(`https://www.threads.net/@${cleanUser}`);
      const links = res.data.match(/https?:\/\/(?!www\.threads\.net)[^\s"<>]+/g) || [];
      return { links: [...new Set(links)].slice(0, 20) };
    } catch (err) {
      return { links: [] };
    }
  }

  async close() {
    // No-op for HTTP-based scraper
    this.initialized = false;
    this.lsdToken = null;
  }
}

export default ThreadsScraper;
