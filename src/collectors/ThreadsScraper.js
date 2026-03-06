import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';

export class ThreadsScraper {
  constructor() {
    this.client = axios.create({
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
  }

  async scrapeProfile(username) {
    try {
      const { data } = await this.client.get('https://www.threads.net/@' + username);
      const $ = cheerio.load(data);
      const scripts = $('script[type="application/ld+json"]');
      let profileData = null;
      scripts.each((_, el) => {
        try { const json = JSON.parse($(el).html()); if (json['@type'] === 'Person') profileData = json; } catch(e) {}
      });
      return profileData ? {
        username, displayName: profileData.name, bio: profileData.description,
        followerCount: parseInt(profileData.interactionStatistic?.userInteractionCount) || 0,
      } : { username };
    } catch (e) {
      logger.warn('Scrape failed for @' + username, { error: e.message });
      return { username };
    }
  }

  async scrapeThread(threadUrl) {
    try {
      const { data } = await this.client.get(threadUrl);
      const $ = cheerio.load(data);
      const text = $('meta[property="og:description"]').attr('content') || '';
      const image = $('meta[property="og:image"]').attr('content') || '';
      return {
        content: { text, mediaUrls: image ? [image] : [], urls: this._extractUrls(text) },
        source: 'scraper',
      };
    } catch (e) {
      logger.warn('Thread scrape failed', { error: e.message });
      return null;
    }
  }

  async batchScrapeProfiles(usernames) {
    const results = [];
    for (const u of usernames) {
      results.push(await this.scrapeProfile(u));
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    }
    return results;
  }

  _extractUrls(text) { return (text.match(/https?:\/\/[^\s]+/gi) || []); }
}

export default ThreadsScraper;
