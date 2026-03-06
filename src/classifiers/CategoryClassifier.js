import OpenAI from 'openai';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const KEYWORD_RULES = {
  shopping: {
    keywords: ['ali.ski', 'link.coupang', 'amzn.to', 'coupa.ng', 'rakuten',
      'affiliate', 'discount', 'coupon', 'deal', 'sale', 'free shipping',
      'review', 'unboxing', 'haul', 'recommendation', 'best buy'],
    subs: {
      aliexpress: ['aliexpress', 'ali', 'ali.ski'],
      coupang: ['coupang', 'coupa.ng', 'coupang partners'],
      rakuten: ['rakuten', 'r10.to'],
      amazon: ['amazon', 'amzn.to'],
    },
  },
  issue: {
    keywords: ['breaking', 'news', 'trending', 'viral', 'controversy',
      'election', 'economy', 'stock', 'crisis', 'update', 'official'],
    subs: {
      entertainment: ['celebrity', 'drama', 'movie', 'kpop', 'idol'],
      politics: ['election', 'president', 'government', 'policy', 'vote'],
      economy: ['stock', 'bitcoin', 'inflation', 'gdp', 'interest rate'],
      tech: ['ai', 'apple', 'google', 'startup', 'launch', 'update'],
      sports: ['goal', 'match', 'championship', 'league', 'score'],
    },
  },
  personal: {
    keywords: ['marketing', 'branding', 'portfolio', 'freelance',
      'consultant', 'coach', 'expert', 'tips', 'growth'],
    subs: {
      marketing: ['marketing', 'ads', 'growth', 'social media'],
      design: ['design', 'ui', 'ux', 'figma', 'creative'],
      dev: ['developer', 'coding', 'javascript', 'react', 'api'],
      lifestyle: ['lifestyle', 'travel', 'fitness', 'daily'],
    },
  },
};

export class CategoryClassifier {
  constructor() {
    this.openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;
  }

  async classify(threadData) {
    const text = (threadData.content?.text || '').toLowerCase();
    let result = this._ruleBasedClassify(text);
    if (result.confidence < 0.6 && this.openai) {
      try { result = await this._aiClassify(threadData); }
      catch (e) { logger.warn('AI classification failed', { error: e.message }); }
    }
    return result;
  }

  _ruleBasedClassify(text) {
    let best = { primary: 'uncategorized', sub: '', confidence: 0, classifiedBy: 'rule' };
    for (const [category, rules] of Object.entries(KEYWORD_RULES)) {
      let score = 0;
      for (const kw of rules.keywords) { if (text.includes(kw)) score++; }
      const confidence = Math.min(score / 3, 1);
      if (confidence > best.confidence) {
        let sub = '';
        for (const [subName, subKws] of Object.entries(rules.subs)) {
          if (subKws.some(k => text.includes(k))) { sub = subName; break; }
        }
        best = { primary: category, sub, confidence, classifiedBy: 'rule' };
      }
    }
    return best;
  }

  async _aiClassify(threadData) {
    const resp = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: 'Classify this Threads post into: shopping, issue, or personal. Return JSON: {primary, sub, confidence, sentiment, keywords}'
      }, {
        role: 'user',
        content: threadData.content?.text || ''
      }],
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    return { ...parsed, classifiedBy: 'ai' };
  }
}

export default CategoryClassifier;
