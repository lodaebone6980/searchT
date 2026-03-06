import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

export class ThreadsOfficialAPI {
  constructor() {
    this.baseUrl = config.threads.baseUrl;
    this.accessToken = config.threads.accessToken;
    this.client = axios.create({ baseURL: this.baseUrl, timeout: 30000 });
  }

  async getUserProfile(userId = 'me') {
    const { data } = await this.client.get('/' + userId, {
      params: { fields: 'id,username,name,threads_biography,threads_profile_picture_url', access_token: this.accessToken },
    });
    return data;
  }

  async getUserThreads(userId = 'me', limit = 25) {
    const { data } = await this.client.get('/' + userId + '/threads', {
      params: { fields: 'id,text,timestamp,media_type,media_url,permalink,is_reply', limit, access_token: this.accessToken },
    });
    return data?.data || [];
  }

  async getThreadReplies(threadId) {
    const { data } = await this.client.get('/' + threadId + '/replies', {
      params: { fields: 'id,text,timestamp,username', access_token: this.accessToken },
    });
    return data?.data || [];
  }

  async collectAllThreads(userId, maxPages = 5) {
    let allThreads = [];
    let url = '/' + userId + '/threads';
    let params = { fields: 'id,text,timestamp,media_type,permalink', limit: 25, access_token: this.accessToken };
    for (let page = 0; page < maxPages; page++) {
      const { data } = await this.client.get(url, { params });
      allThreads.push(...(data?.data || []));
      if (!data?.paging?.cursors?.after) break;
      params.after = data.paging.cursors.after;
      await new Promise(r => setTimeout(r, 1000));
    }
    logger.info('Collected ' + allThreads.length + ' threads via Official API');
    return allThreads;
  }

  normalize(raw) {
    return {
      threadId: raw.id,
      content: { text: raw.text || '', mediaType: (raw.media_type || 'text').toLowerCase(), urls: this._extractUrls(raw.text || '') },
      publishedAt: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      source: 'official_api',
    };
  }

  _extractUrls(text) { return (text.match(/https?:\/\/[^\s]+/gi) || []); }
}

export default ThreadsOfficialAPI;
