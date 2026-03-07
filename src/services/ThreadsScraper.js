import { chromium } from 'playwright-core';

class ThreadsScraper {
  constructor() {
    this.browser = null;
    this.executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
    this.defaultTimeout = 30000;
    this.networkIdleTimeout = 25000;
  }

  async _getBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      try {
        this.browser = await chromium.launch({
          executablePath: this.executablePath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--disable-web-resources',
            '--disable-extensions',
            '--disable-plugins'
          ]
        });
      } catch (err) {
        console.error('[ThreadsScraper] Browser launch error:', err.message);
        throw new Error(`Failed to launch browser: ${err.message}`);
      }
    }
    return this.browser;
  }

  async _newPage() {
    const browser = await this._getBrowser();
    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'ko-KR',
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      return page;
    } catch (err) {
      console.error('[ThreadsScraper] Page creation error:', err.message);
      throw new Error(`Failed to create new page: ${err.message}`);
    }
  }

  _delay(ms = 3000) {
    const randomDelay = ms + Math.random() * 2000;
    return new Promise(resolve => setTimeout(resolve, randomDelay));
  }

  _cleanText(raw) {
    if (!raw || typeof raw !== 'string') return '';

    return raw
      // Remove verified account indicators
      .replace(/^[\w.]+인증된\s*계정/i, '')
      .replace(/Verified\s+Account/gi, '')
      // Remove timestamp patterns
      .replace(/\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\d+[시일분초]간?\s*(전|ago)/g, '')
      // Remove UI button text
      .replace(/더\s*보기/g, '')
      .replace(/번역하기/g, '')
      .replace(/Show\s+more/gi, '')
      .replace(/Translate/gi, '')
      // Remove engagement metrics from text
      .replace(/좋아요[\d,.만천]*/g, '')
      .replace(/댓글[\d,.만천]*/g, '')
      .replace(/리포스트[\d,.만천]*/g, '')
      .replace(/공유하기[\d,.만천]*/g, '')
      .replace(/Likes?[\d,.만천]*/g, '')
      .replace(/Comments?[\d,.만천]*/g, '')
      .replace(/Reposts?[\d,.만천]*/g, '')
      .replace(/Shares?[\d,.만천]*/g, '')
      // Remove action buttons
      .replace(/팔로우/g, '')
      .replace(/언팔로우/g, '')
      .replace(/Follow/g, '')
      .replace(/Unfollow/g, '')
      .replace(/팔로워\s*[\d,.만천]+/g, '')
      .replace(/Followers?[\d,.만천]*/g, '')
      .replace(/답글\s*달기/g, '')
      .replace(/Reply/gi, '')
      // Remove edit/status indicators
      .replace(/수정됨/g, '')
      .replace(/\(edited\)/gi, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractMetrics(raw) {
    if (!raw || typeof raw !== 'string') {
      return { likeCount: 0, replyCount: 0, repostCount: 0, shareCount: 0 };
    }

    const parseNum = (numStr) => {
      if (!numStr || typeof numStr !== 'string') return 0;
      const cleaned = numStr.replace(/,/g, '').trim();
      let num = parseFloat(cleaned);
      if (isNaN(num)) return 0;
      if (cleaned.includes('만')) num *= 10000;
      else if (cleaned.includes('천')) num *= 1000;
      return Math.round(num);
    };

    const likeMatch = raw.match(/좋아요\s*([\d,.만천]+)|Likes?\s*[:=]?\s*([\d,.만천]+)/i);
    const replyMatch = raw.match(/댓글\s*([\d,.만천]+)|Comments?\s*[:=]?\s*([\d,.만천]+)/i);
    const repostMatch = raw.match(/리포스트\s*([\d,.만천]+)|Reposts?\s*[:=]?\s*([\d,.만천]+)/i);
    const shareMatch = raw.match(/공유하기\s*([\d,.만천]+)|Shares?\s*[:=]?\s*([\d,.만천]+)/i);

    return {
      likeCount: parseNum(likeMatch?.[1] || likeMatch?.[2]),
      replyCount: parseNum(replyMatch?.[1] || replyMatch?.[2]),
      repostCount: parseNum(repostMatch?.[1] || repostMatch?.[2]),
      shareCount: parseNum(shareMatch?.[1] || shareMatch?.[2]),
    };
  }

  async scrapeProfile(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username: must be a non-empty string');
    }

    const page = await this._newPage();
    const threads = [];
    const graphqlResponses = [];

    try {
      // Intercept GraphQL responses
      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (url.includes('/api/graphql') || url.includes('threads.net/graphql')) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('json')) {
              try {
                const json = await response.json();
                graphqlResponses.push(json);
              } catch (parseErr) {
                // Silent fail for parse errors
              }
            }
          }
        } catch (err) {
          // Silent fail for response processing
        }
      });

      console.log(`[ThreadsScraper] Scraping profile: @${username}`);
      await page.goto(`https://www.threads.net/@${username}`, {
        waitUntil: 'networkidle',
        timeout: this.defaultTimeout
      });
      await this._delay(3000);

      // Scroll to load more content
      for (let i = 0; i < 5; i++) {
        try {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await this._delay(1500);
        } catch (err) {
          console.warn(`[ThreadsScraper] Scroll iteration ${i} failed: ${err.message}`);
        }
      }

      // Extract profile metadata
      const profile = await page.evaluate(() => {
        try {
          const name = document.querySelector('meta[property="og:title"]')?.content || '';
          const desc = document.querySelector('meta[property="og:description"]')?.content || '';
          const pic = document.querySelector('meta[property="og:image"]')?.content || '';
          const url = document.querySelector('meta[property="og:url"]')?.content || '';

          return {
            displayName: name.split('(')[0].trim() || 'Unknown',
            bio: desc,
            profilePicUrl: pic,
            profileUrl: url,
            scraped: new Date().toISOString()
          };
        } catch (err) {
          return {
            displayName: 'Unknown',
            bio: '',
            profilePicUrl: '',
            profileUrl: '',
            scraped: new Date().toISOString()
          };
        }
      });

      // Extract threads from page DOM (fallback approach)
      const pageThreads = await page.evaluate(() => {
        const items = [];
        try {
          const containers = document.querySelectorAll('[data-pressable-container="true"]');
          containers.forEach((el, idx) => {
            try {
              const text = el.textContent || '';
              if (text.length > 10) {
                const img = el.querySelector('img[src*="scontent"]');
                const links = Array.from(el.querySelectorAll('a'))
                  .map(a => a.href)
                  .filter(h => h && h.startsWith('http'));
                items.push({
                  rawText: text,
                  imageUrl: img?.src || '',
                  index: idx,
                  links: links
                });
              }
            } catch (innerErr) {
              // Skip problematic elements
            }
          });
        } catch (err) {
          // Silent fail
        }
        return items;
      });

      for (const pt of pageThreads) {
        try {
          const cleaned = this._cleanText(pt.rawText);
          if (cleaned.length < 10) continue;

          const metrics = this._extractMetrics(pt.rawText);
          threads.push({
            threadId: `${username}_${Date.now()}_${pt.index}`,
            text: cleaned,
            rawText: pt.rawText,
            imageUrl: pt.imageUrl,
            links: pt.links || [],
            likeCount: metrics.likeCount,
            replyCount: metrics.replyCount,
            repostCount: metrics.repostCount,
            shareCount: metrics.shareCount,
            timestamp: new Date().toISOString(),
            source: 'page_scrape'
          });
        } catch (err) {
          console.warn(`[ThreadsScraper] Error processing thread item: ${err.message}`);
        }
      }

      console.log(`[ThreadsScraper] Successfully scraped ${threads.length} threads from @${username}`);

      return {
        success: true,
        profile,
        threads,
        graphqlResponseCount: graphqlResponses.length
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Profile scrape error for @${username}: ${err.message}`);
      return {
        success: false,
        profile: { displayName: username, bio: '', profilePicUrl: '', profileUrl: '' },
        threads: [],
        error: err.message
      };
    } finally {
      try {
        await page.close().catch(() => {});
      } catch (err) {
        console.warn('[ThreadsScraper] Error closing page:', err.message);
      }
    }
  }

  async scrapeKeywords(keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error('Keywords must be a non-empty array');
    }

    const page = await this._newPage();
    const discoveredUrls = new Map();
    const graphqlResponses = [];

    try {
      // Intercept GraphQL responses (same pattern as scrapeProfile)
      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (url.includes('/api/graphql') || url.includes('threads.net/graphql')) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('json')) {
              try {
                const json = await response.json();
                graphqlResponses.push(json);
              } catch (parseErr) {
                // Silent fail for parse errors
              }
            }
          }
        } catch (err) {
          // Silent fail for response processing
        }
      });

      for (const keyword of keywords) {
        try {
          if (typeof keyword !== 'string' || !keyword.trim()) continue;

          console.log(`[ThreadsScraper] Searching Threads for: "${keyword}"`);
          graphqlResponses.length = 0; // Clear for each keyword

          const searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword.trim())}&serp_type=default`;
          await page.goto(searchUrl, {
            waitUntil: 'networkidle',
            timeout: this.defaultTimeout
          });
          await this._delay(3000);

          // Scroll to trigger more GraphQL loads
          for (let i = 0; i < 3; i++) {
            try {
              await page.evaluate(() => window.scrollBy(0, 800));
              await this._delay(2000);
            } catch (scrollErr) { break; }
          }

          // Extract thread URLs from GraphQL responses
          const threadUrls = new Set();
          for (const resp of graphqlResponses) {
            try {
              const jsonStr = JSON.stringify(resp);
              // Find thread post codes (e.g., C1abc23DEfg)
              const codeMatches = jsonStr.match(/"code":"([A-Za-z0-9_-]{6,15})"/g) || [];
              codeMatches.forEach(m => {
                const code = m.match(/"code":"([^"]+)"/)[1];
                // Find associated username
                const usernameMatch = jsonStr.match(/"username":"([^"]+)"/);
                if (usernameMatch) {
                  threadUrls.add(`https://www.threads.net/@${usernameMatch[1]}/post/${code}`);
                }
              });
              // Also look for direct post URLs in the response
              const urlMatches = jsonStr.match(/threads\.net\/@[\w.]+\/post\/[A-Za-z0-9_-]+/g) || [];
              urlMatches.forEach(u => threadUrls.add('https://www.' + u.replace(/\\/g, '')));
            } catch (e) {
              // Silent fail
            }
          }

          // Also try extracting from DOM as fallback
          try {
            const domUrls = await page.evaluate(() => {
              const results = [];
              document.querySelectorAll('a').forEach(a => {
                const href = a.href || '';
                if (href.includes('threads.net/') && href.includes('/post/')) {
                  results.push(href);
                }
              });
              return [...new Set(results)];
            });
            domUrls.forEach(u => threadUrls.add(u));
          } catch (e) {}

          const urlArray = [...threadUrls].slice(0, 15);
          urlArray.forEach(url => {
            discoveredUrls.set(url, { url, keyword: keyword.trim(), discovered: new Date().toISOString() });
          });

          console.log(`[ThreadsScraper] Found ${urlArray.length} threads for keyword "${keyword}"`);
          await this._delay(2000);
        } catch (err) {
          console.warn(`[ThreadsScraper] Error searching keyword "${keyword}": ${err.message}`);
        }
      }

      const results = Array.from(discoveredUrls.values());
      console.log(`[ThreadsScraper] Discovered ${results.length} unique thread URLs total`);

      return {
        success: true,
        keywords: keywords.length,
        threadsDiscovered: results.length,
        threads: results
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Keyword search error: ${err.message}`);
      return {
        success: false,
        keywords: keywords.length,
        threadsDiscovered: 0,
        threads: [],
        error: err.message
      };
    } finally {
      try {
        await page.close().catch(() => {});
      } catch (err) {
        console.warn('[ThreadsScraper] Error closing page:', err.message);
      }
    }
  }

  async scrapeThreadDetail(threadUrl) {
    if (!threadUrl || typeof threadUrl !== 'string') {
      throw new Error('Invalid threadUrl: must be a non-empty string');
    }

    const page = await this._newPage();

    try {
      console.log(`[ThreadsScraper] Scraping thread detail: ${threadUrl}`);

      await page.goto(threadUrl, {
        waitUntil: 'networkidle',
        timeout: this.defaultTimeout
      });
      await this._delay(2000);

      // Extract main thread data
      const threadData = await page.evaluate(() => {
        try {
          const text = document.querySelector('meta[property="og:description"]')?.content || '';
          const title = document.querySelector('meta[property="og:title"]')?.content || '';
          const image = document.querySelector('meta[property="og:image"]')?.content || '';
          const url = document.querySelector('meta[property="og:url"]')?.content || window.location.href;
          const author = document.querySelector('a[href*="/@"]')?.textContent?.trim() || '';

          return { text, title, image, url, author };
        } catch (err) {
          return { text: '', title: '', image: '', url: threadUrl, author: '' };
        }
      });

      // Scroll to load comments
      for (let i = 0; i < 3; i++) {
        try {
          await page.evaluate(() => window.scrollBy(0, 800));
          await this._delay(1500);
        } catch (err) {
          console.warn(`[ThreadsScraper] Scroll iteration ${i} failed: ${err.message}`);
        }
      }

      // Extract comments
      const comments = await page.evaluate(() => {
        const results = [];
        try {
          const commentElements = document.querySelectorAll('[data-pressable-container="true"]');
          const arr = Array.from(commentElements);

          // Skip first element (main post), process comments
          for (let i = 1; i < Math.min(arr.length, 30); i++) {
            try {
              const el = arr[i];
              const text = el.textContent || '';

              if (text.length > 5) {
                const links = Array.from(el.querySelectorAll('a'))
                  .map(a => a.href)
                  .filter(h => h && h.startsWith('http'));

                const authorLink = el.querySelector('a[href*="/@"]');
                const commentAuthor = authorLink?.textContent?.trim() || '';

                results.push({
                  author: commentAuthor,
                  text: text,
                  links: links,
                  extractedAt: new Date().toISOString()
                });
              }
            } catch (innerErr) {
              // Skip problematic comment elements
            }
          }
        } catch (err) {
          // Silent fail
        }
        return results;
      });

      const cleanedText = this._cleanText(threadData.text);
      const metrics = this._extractMetrics(threadData.text);

      console.log(`[ThreadsScraper] Extracted thread with ${comments.length} comments`);

      return {
        success: true,
        threadUrl: threadData.url,
        title: threadData.title,
        author: threadData.author,
        text: cleanedText,
        rawText: threadData.text,
        image: threadData.image,
        comments: comments,
        commentCount: comments.length,
        likeCount: metrics.likeCount,
        replyCount: metrics.replyCount,
        repostCount: metrics.repostCount,
        shareCount: metrics.shareCount,
        scrapedAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Thread detail error for ${threadUrl}: ${err.message}`);
      return {
        success: false,
        threadUrl: threadUrl,
        error: err.message,
        comments: []
      };
    } finally {
      try {
        await page.close().catch(() => {});
      } catch (err) {
        console.warn('[ThreadsScraper] Error closing page:', err.message);
      }
    }
  }

  async scrapeComments(threadUrl) {
    if (!threadUrl || typeof threadUrl !== 'string') {
      throw new Error('Invalid threadUrl: must be a non-empty string');
    }

    const page = await this._newPage();

    try {
      console.log(`[ThreadsScraper] Scraping comments from: ${threadUrl}`);

      await page.goto(threadUrl, {
        waitUntil: 'networkidle',
        timeout: this.defaultTimeout
      });
      await this._delay(3000);

      // Scroll to load more comments
      for (let i = 0; i < 5; i++) {
        try {
          await page.evaluate(() => window.scrollBy(0, 800));
          await this._delay(1500);
        } catch (err) {
          console.warn(`[ThreadsScraper] Scroll iteration ${i} failed: ${err.message}`);
        }
      }

      // Extract all comments with affiliate link detection
      const comments = await page.evaluate(() => {
        const results = [];
        try {
          const containers = document.querySelectorAll('[data-pressable-container="true"]');
          const arr = Array.from(containers);

          for (let i = 1; i < arr.length; i++) {
            try {
              const el = arr[i];
              const text = el.textContent || '';

              if (text.length > 5) {
                const links = Array.from(el.querySelectorAll('a'))
                  .map(a => ({
                    href: a.href,
                    text: a.textContent?.trim() || ''
                  }))
                  .filter(l => l.href && l.href.startsWith('http'));

                const authorLink = el.querySelector('a[href*="/@"]');
                const username = authorLink?.textContent?.trim() || '';

                // Detect potential affiliate links
                const affiliateLinks = links.filter(l => {
                  const href = l.href.toLowerCase();
                  return href.includes('ref=') || href.includes('affiliate') ||
                    href.includes('utm_') || href.includes('tracking') ||
                    href.includes('coupon') || href.includes('promo');
                });

                results.push({
                  username: username,
                  text: text,
                  links: links,
                  affiliateLinks: affiliateLinks,
                  extractedAt: new Date().toISOString()
                });
              }
            } catch (innerErr) {
              // Skip problematic elements
            }
          }
        } catch (err) {
          // Silent fail
        }
        return results;
      });

      console.log(`[ThreadsScraper] Extracted ${comments.length} comments (${comments.filter(c => c.affiliateLinks.length > 0).length} with affiliate links)`);

      return {
        success: true,
        threadUrl: threadUrl,
        comments: comments,
        totalComments: comments.length,
        commentsWithAffiliateLinks: comments.filter(c => c.affiliateLinks.length > 0).length,
        scrapedAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Comments scrape error for ${threadUrl}: ${err.message}`);
      return {
        success: false,
        threadUrl: threadUrl,
        comments: [],
        error: err.message
      };
    } finally {
      try {
        await page.close().catch(() => {});
      } catch (err) {
        console.warn('[ThreadsScraper] Error closing page:', err.message);
      }
    }
  }

  async scrapeProfileLinks(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username: must be a non-empty string');
    }

    const page = await this._newPage();

    try {
      console.log(`[ThreadsScraper] Scraping profile links for: @${username}`);

      await page.goto(`https://www.threads.net/@${username}`, {
        waitUntil: 'networkidle',
        timeout: this.networkIdleTimeout
      });
      await this._delay(2000);

      // Extract bio and links
      const profileData = await page.evaluate(() => {
        try {
          const bio = document.querySelector('meta[property="og:description"]')?.content || '';
          const displayName = document.querySelector('meta[property="og:title"]')?.content || '';
          const profilePic = document.querySelector('meta[property="og:image"]')?.content || '';

          return {
            bio: bio,
            displayName: displayName,
            profilePic: profilePic
          };
        } catch (err) {
          return {
            bio: '',
            displayName: '',
            profilePic: ''
          };
        }
      });

      // Extract all external links
      const links = await page.evaluate(() => {
        const results = [];
        try {
          const allLinks = Array.from(document.querySelectorAll('a[href]'));

          allLinks.forEach(a => {
            try {
              const href = a.href || '';
              const text = a.textContent?.trim() || '';

              if (href.startsWith('http') &&
                !href.includes('threads.net') &&
                !href.includes('instagram.com') &&
                !href.includes('facebook.com') &&
                !href.includes('google.com/search') &&
                !href.includes('twitter.com') &&
                !href.includes('x.com')) {

                // Detect link type
                const isAffiliate = href.toLowerCase().includes('ref=') ||
                  href.toLowerCase().includes('affiliate') ||
                  href.toLowerCase().includes('utm_');

                results.push({
                  href: href,
                  text: text,
                  isAffiliate: isAffiliate,
                  domain: new URL(href).hostname
                });
              }
            } catch (innerErr) {
              // Skip malformed URLs
            }
          });
        } catch (err) {
          // Silent fail
        }
        return results;
      });

      // Deduplicate by URL
      const uniqueLinks = Array.from(
        new Map(links.map(l => [l.href, l])).values()
      );

      console.log(`[ThreadsScraper] Found ${uniqueLinks.length} external links for @${username} (${uniqueLinks.filter(l => l.isAffiliate).length} affiliate)`);

      return {
        success: true,
        username: username,
        displayName: profileData.displayName,
        bio: profileData.bio,
        profilePic: profileData.profilePic,
        links: uniqueLinks,
        totalLinks: uniqueLinks.length,
        affiliateLinks: uniqueLinks.filter(l => l.isAffiliate),
        affiliateLinkCount: uniqueLinks.filter(l => l.isAffiliate).length,
        scrapedAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[ThreadsScraper] Profile links error for @${username}: ${err.message}`);
      return {
        success: false,
        username: username,
        links: [],
        error: err.message
      };
    } finally {
      try {
        await page.close().catch(() => {});
      } catch (err) {
        console.warn('[ThreadsScraper] Error closing page:', err.message);
      }
    }
  }

  async close() {
    try {
      if (this.browser && this.browser.isConnected?.()) {
        await this.browser.close();
        console.log('[ThreadsScraper] Browser closed successfully');
      }
      this.browser = null;
    } catch (err) {
      console.error('[ThreadsScraper] Error closing browser:', err.message);
      this.browser = null;
    }
  }
}

export default ThreadsScraper;
