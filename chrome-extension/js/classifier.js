/**
 * classifier.js - 카테고리 분류 (한글 키워드 기반)
 */

const ThreadsClassifier = {
  categoryKeywords: {
    shopping: [
      '쇼핑', '구매', '할인', '세일', '판매', '상품', '리뷰', '추천',
      '가격', '프로모션', '쿠폰', '배송', '무료배송', '주문', '신상',
      '오픈런', '홈세일', '광고', '득템', '언박싱', '하울', '직구',
      '최저가', '핫딜', '타임세일', '특가', '사은품', '공구', '공동구매'
    ],
    issue: [
      '뉴스', '속보', '이슈', '정치', '경제', '사회', '사건', '사고',
      '논란', '발표', '공식', '긴급', '단독', '인터뷰', '브레이킹',
      '선거', '국회', '대통령', '정부', '법원', '검찰', '경찰'
    ],
    personal: [
      '일상', '셀카', 'OOTD', '오늘', '오늘의', '내일', '맛집',
      '카페', '여행', '일기', '운동', '헬스', '요리', '레시피',
      '데일리', '출근', '퇴근', '주말', '휴가', '브이로그'
    ]
  },

  classify(text, urls) {
    if (!text) return { primary: 'uncategorized', confidence: 0, classifiedBy: 'rule' };

    const lowerText = text.toLowerCase();

    // 제휴 링크가 있으면 쇼핑 우선
    if (urls && urls.length > 0) {
      const affiliateResult = ThreadsUtils.detectAffiliateLinks(urls);
      if (affiliateResult.hasAffiliate) {
        return { primary: 'shopping', confidence: 0.9, classifiedBy: 'rule' };
      }
    }

    // 키워드 매칭
    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      const matches = keywords.filter(kw => lowerText.includes(kw.toLowerCase()));
      if (matches.length > 0) {
        const confidence = Math.min(0.5 + (matches.length * 0.1), 0.95);
        return { primary: category, confidence, classifiedBy: 'rule' };
      }
    }

    return { primary: 'uncategorized', confidence: 0, classifiedBy: 'rule' };
  }
};

if (typeof window !== 'undefined') {
  window.ThreadsClassifier = ThreadsClassifier;
}
