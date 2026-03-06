import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';

export class ThreadsScraper {
  constructor() {
    this.client = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
  }

  async scrapeProfileThreads(username) {
    try {
      const url = 'https://www.threads.net/@' + username;
      const { data } = await this.client.get(url);
      const $ = cheerio.load(data);

      // Extract profile info from JSON-LD
      let profileData = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html());
          if (json['@type'] === 'Person') profileData = json;
        } catch(e) {}
      });

      // Extract thread content from meta tags
      const ogDesc = $('meta[property="og:description"]').attr('content') || '';
      const ogImage = $('meta[property="og:image"]').attr('content') || '';
      const ogTitle = $('meta[property="og:title"]').attr('content') || '';
      const pageTitle = $('title').text() || '';

      // Try to extract embedded thread data from script tags
      const threads = [];
      const scriptContents = [];
      $('script').each((_, el) => {
        const html = $(el).html() || '';
        if (html.includes('text') && (html.includes('thread') || html.includes('post'))) {
          scriptContents.push(html);
        }
      });

      // Parse any JSON data found in scripts
      for (const sc of scriptContents) {
        try {
          const jsonMatches = sc.match(/\{"[^"]*text[^"]*"[^}]*\}/g);
          if (jsonMatches) {
            for (const m of jsonMatches) {
              try {
                const obj = JSON.parse(m);
                if (obj.text && obj.text.length > 10) {
                  threads.push({
                    threadId: 'thread_' + username + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    content: { text: obj.text, mediaUrls: [], urls: this._extractUrls(obj.text) },
                    metrics: { likes: obj.like_count || 0, replies: obj.reply_count || 0, reposts: obj.repost_count || 0 },
                    source: 'scraper',
                    postedAt: obj.taken_at ? new Date(obj.taken_at * 1000) : new Date(),
                  });
                }
              } catch(e) {}
            }
          }
        } catch(e) {}
      }

      // If no threads found from scripts, create entry from meta tags
      if (threads.length === 0 && ogDesc) {
        // og:description often contains the latest post text
        const descText = ogDesc.replace(/^.*?:\s*"?/, '').replace(/"?\s*$/, '');
        if (descText.length > 5) {
          threads.push({
            threadId: 'thread_' + username + '_' + Date.now() + '_meta',
            content: {
              text: descText,
              mediaUrls: ogImage ? [ogImage] : [],
              urls: this._extractUrls(descText),
            },
            metrics: { likes: 0, replies: 0, reposts: 0 },
            source: 'scraper',
            postedAt: new Date(),
          });
        }
      }

      // Update profile info
      const profile = {
        username,
        displayName: profileData ? profileData.name : ogTitle.replace(/ \(.*/, ''),
        bio: profileData ? profileData.description : '',
        followerCount: profileData ? (parseInt(profileData.interactionStatistic?.userInteractionCount) || 0) : 0,
        isVerified: !!profileData?.identifier,
      };

      logger.info('Scraped @' + username + ': ' + threads.length + ' threads found');
      return { profile, threads };
    } catch (e) {
      logger.warn('Scrape failed for @' + username, { error: e.message });
      return { profile: { username }, threads: [] };
    }
  }

  async scrapeThread(threadUrl) {
    try {
      const { data } = await this.client.get(threadUrl);
      const $ = cheerio.load(data);
      const text = $('meta[property="og:description"]').attr('content') || '';
      const image = $('meta[property="og:image"]').attr('content') || '';
      const urlMatch = threadUrl.match(/\/post\/([^/?]+)/);
      return {
        threadId: urlMatch ? urlMatch[1] : 'thread_' + Date.now(),
        content: { text, mediaUrls: image ? [image] : [], urls: this._extractUrls(text) },
        metrics: { likes: 0, replies: 0, reposts: 0 },
        source: 'scraper',
        postedAt: new Date(),
      };
    } catch (e) {
      logger.warn('Thread scrape failed', { error: e.message });
      return null;
    }
  }

  _extractUrls(text) { return (text.match(/https?:\/\/[^\s]+/gi) || []); }
}

export default ThreadsScraper;
