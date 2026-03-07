/**
 * content.js - Threads.net DOM 파싱 & 스크롤 감지
 * threads.com / threads.net 피드에서 스레드 데이터를 추출합니다.
 */

(function() {
  'use strict';

  const Utils = window.ThreadsUtils;
  const Classifier = window.ThreadsClassifier;

  // 이미 처리한 threadId Set
  const processedThreads = new Set();
  let isAutoCollecting = false;
  let observer = null;

  // ============ DOM 파싱 ============

  /**
   * 피드에서 모든 스레드 블록을 찾습니다.
   * Threads DOM: region[aria-label*="칼럼 본문"] 안의 반복 패턴
   * 각 스레드는 [프로필링크 → 유저네임링크 → 포스트링크 → 텍스트 → 버튼들] 패턴
   */
  function findAllThreadBlocks() {
    // 각 스레드의 고유 포스트 링크를 찾아서 기준으로 삼기
    const postLinks = document.querySelectorAll('a[href*="/post/"]');
    const threads = [];
    const seen = new Set();

    for (const postLink of postLinks) {
      const href = postLink.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);

      // postLink 기준으로 스레드 컨테이너 찾기
      // 상위로 올라가면서 스레드 블록 경계를 찾음
      const threadBlock = findThreadContainer(postLink);
      if (threadBlock) {
        threads.push({ postLink, container: threadBlock, href });
      }
    }

    return threads;
  }

  /**
   * 포스트 링크에서 상위 스레드 컨테이너를 찾습니다.
   */
  function findThreadContainer(postLink) {
    // 상위 요소를 탐색하면서 스레드 단위 컨테이너를 찾음
    // 일반적으로 포스트 링크 → 몇 단계 위 → 스레드 블록
    let el = postLink;
    for (let i = 0; i < 10; i++) {
      el = el.parentElement;
      if (!el) return null;

      // 다른 포스트 링크가 포함되어 있으면 너무 넓은 컨테이너
      const otherPosts = el.querySelectorAll('a[href*="/post/"]');
      if (otherPosts.length > 1) {
        // 이전 레벨이 적합한 컨테이너
        return el.children ? findBestChild(el, postLink) : postLink.parentElement;
      }
    }
    return postLink.parentElement;
  }

  function findBestChild(parent, postLink) {
    for (const child of parent.children) {
      if (child.contains(postLink)) return child;
    }
    return postLink.parentElement;
  }

  /**
   * 스레드 블록에서 데이터를 추출합니다.
   */
  function parseThread(threadInfo) {
    const { postLink, container, href } = threadInfo;

    try {
      // 1. threadId & URL
      const threadId = Utils.extractThreadId(href);
      if (!threadId) return null;

      // 2. 원본 URL 구성
      const baseUrl = window.location.origin;
      const originalUrl = href.startsWith('http') ? href : baseUrl + href;

      // 3. 저자 정보
      const author = extractAuthor(container, href);

      // 4. 텍스트 콘텐츠
      const textContent = extractText(container, postLink);

      // 5. 미디어
      const media = extractMedia(container);

      // 6. 메트릭
      const metrics = extractMetrics(container);

      // 7. 외부 링크
      const externalUrls = extractExternalUrls(container);

      // 8. 분류
      const allUrls = externalUrls.map(u => Utils.resolveThreadsUrl(u));
      const classification = Classifier.classify(textContent, allUrls);

      // 9. 제휴 링크
      const affiliate = Utils.detectAffiliateLinks(allUrls);

      // 10. Region
      const region = Utils.detectRegion(textContent);

      // 11. View Tier
      const viewTier = Utils.calculateViewTier(metrics.likes);

      return {
        threadId,
        platform: 'threads',
        originalUrl,
        author: {
          username: author.username,
          displayName: author.displayName || author.username,
          profilePicUrl: author.profilePicUrl || '',
          isVerified: author.isVerified,
          followerCount: 0,
        },
        content: {
          text: textContent,
          mediaType: media.type,
          mediaUrls: media.urls,
          thumbnailUrl: media.urls[0] || '',
          urls: allUrls,
          hashtags: Utils.extractHashtags(textContent),
          mentions: Utils.extractMentions(textContent),
        },
        category: {
          primary: classification.primary,
          confidence: classification.confidence,
          classifiedBy: classification.classifiedBy,
          classifiedAt: new Date().toISOString(),
        },
        region,
        viewTier,
        collectionSource: isAutoCollecting ? 'auto_keyword' : 'manual',
        affiliate,
        metrics,
        source: 'extension',
        collectedAt: new Date().toISOString(),
      };
    } catch (error) {
      Utils.log('error', '스레드 파싱 실패', error);
      return null;
    }
  }

  // ============ 세부 추출 함수들 ============

  function extractAuthor(container, postHref) {
    // 포스트 URL에서 username 추출: /@username/post/ID
    const usernameMatch = postHref.match(/@([\w.]+)/);
    const username = usernameMatch ? usernameMatch[1] : 'unknown';

    // 프로필 링크 찾기
    const profileLink = container.querySelector(`a[href*="/@${username}"]`);

    // 프로필 사진
    let profilePicUrl = '';
    if (profileLink) {
      const img = profileLink.querySelector('img');
      if (img) profilePicUrl = img.src || '';
    }

    // 표시 이름 (username과 같을 수 있음)
    let displayName = username;
    const allLinks = container.querySelectorAll('a');
    for (const link of allLinks) {
      const linkHref = link.getAttribute('href') || '';
      if (linkHref === `/@${username}` && link.textContent.trim() && !link.querySelector('img')) {
        displayName = link.textContent.trim();
        break;
      }
    }

    // 인증 배지 확인
    let isVerified = false;
    const allImgs = container.querySelectorAll('img');
    for (const img of allImgs) {
      const alt = img.getAttribute('alt') || '';
      if (alt.includes('인증') || alt.includes('verified') || alt.includes('Verified')) {
        isVerified = true;
        break;
      }
    }

    return { username, displayName, profilePicUrl, isVerified };
  }

  function extractText(container, postLink) {
    // 텍스트는 포스트 링크 이후에 나오는 일반 텍스트 노드들
    // 버튼(좋아요, 댓글 등)이나 링크가 아닌 텍스트를 수집

    const texts = [];

    // 컨테이너 내의 모든 요소 순회
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          // 버튼 내부 텍스트 제외
          if (node.closest('button')) return NodeFilter.FILTER_REJECT;
          // 링크 중 프로필/포스트 링크 내부 제외
          const parentLink = node.closest('a');
          if (parentLink) {
            const href = parentLink.getAttribute('href') || '';
            if (href.includes('/@') || href.includes('/post/') || href.includes('/search')) {
              return NodeFilter.FILTER_REJECT;
            }
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // 대안: 더 간단한 접근 - 특정 패턴의 텍스트 노드를 찾기
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      // 버튼이나 링크 내부가 아닌 텍스트
      if (el.closest('button')) continue;
      if (el.tagName === 'TIME' || el.tagName === 'A') continue;

      // 직접 텍스트를 가진 요소만
      const directText = getDirectText(el);
      if (directText && directText.length > 2) {
        // 시간 텍스트 필터 (17시간, 16시간 등)
        if (/^\d+시간$|^\d+분$|^\d+일$|^\d+초$/.test(directText.trim())) continue;
        // 메트릭 텍스트 필터
        if (/^[\d,.]+[만천KMB]?$/.test(directText.trim())) continue;
        // "번역하기" 등 UI 텍스트 필터
        if (['번역하기', '더 보기', '좋아요', '댓글', '리포스트', '공유하기'].includes(directText.trim())) continue;
        // "인증된 계정" 필터
        if (directText.includes('인증된 계정')) continue;
        // 프로필 이름 필터 (짧고 @포함 가능)
        if (directText.trim() === extractUsernameFromContainer(container)) continue;

        texts.push(directText.trim());
      }
    }

    // 중복 제거 및 결합
    const uniqueTexts = [...new Set(texts)];
    return uniqueTexts.join('\n').trim();
  }

  function getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  function extractUsernameFromContainer(container) {
    const postLink = container.querySelector('a[href*="/post/"]');
    if (postLink) {
      const match = (postLink.getAttribute('href') || '').match(/@([\w.]+)/);
      return match ? match[1] : '';
    }
    return '';
  }

  function extractMedia(container) {
    const urls = [];
    let type = 'text';

    // 이미지
    const images = container.querySelectorAll('img');
    for (const img of images) {
      const src = img.src || '';
      const alt = img.getAttribute('alt') || '';
      // 프로필 사진 제외
      if (alt.includes('프로필 사진') || alt.includes('profile')) continue;
      // 아이콘 제외 (작은 이미지)
      if (img.width < 50 && img.height < 50) continue;
      // UI 아이콘 제외
      if (alt.includes('좋아요') || alt.includes('댓글') || alt.includes('리포스트') ||
          alt.includes('공유') || alt.includes('더 보기') || alt.includes('인증')) continue;

      if (src && src.startsWith('http')) {
        urls.push(src);
        type = 'image';
      }
    }

    // 비디오
    const videos = container.querySelectorAll('video');
    if (videos.length > 0) {
      type = 'video';
      for (const video of videos) {
        if (video.src) urls.push(video.src);
        if (video.poster) urls.push(video.poster);
      }
    }

    // 비디오 플레이어 그룹
    const videoGroup = container.querySelector('[role="group"]');
    if (videoGroup) type = 'video';

    // 캐러셀 (여러 이미지)
    if (urls.length > 1 && type === 'image') type = 'carousel';

    return { type, urls };
  }

  function extractMetrics(container) {
    const metrics = { likes: 0, replies: 0, reposts: 0, views: 0 };

    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const img = btn.querySelector('img');
      if (!img) continue;

      const alt = img.getAttribute('alt') || '';
      // 버튼 안의 숫자 텍스트 찾기
      const spans = btn.querySelectorAll('*');
      let numText = '';
      for (const span of spans) {
        const text = getDirectText(span);
        if (text && /[\d만천KMB]/.test(text)) {
          numText = text;
          break;
        }
      }

      const value = Utils.parseMetricText(numText);

      if (alt.includes('좋아요') || alt.includes('like') || alt.includes('Like')) {
        metrics.likes = value;
      } else if (alt.includes('댓글') || alt.includes('comment') || alt.includes('Comment') || alt.includes('Reply')) {
        metrics.replies = value;
      } else if (alt.includes('리포스트') || alt.includes('repost') || alt.includes('Repost')) {
        metrics.reposts = value;
      }
    }

    return metrics;
  }

  function extractExternalUrls(container) {
    const urls = [];
    const links = container.querySelectorAll('a[href]');

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      // Threads 내부 링크 제외
      if (href.startsWith('/@') || href.includes('/post/') || href.includes('/search')) continue;
      // 외부 링크 (l.threads.com 리다이렉트 또는 직접 외부)
      if (href.includes('l.threads.com') || (href.startsWith('http') && !href.includes('threads.net') && !href.includes('threads.com'))) {
        urls.push(href);
      }
    }

    return urls;
  }

  // ============ 수집 로직 ============

  /**
   * 현재 보이는 모든 스레드를 수집합니다.
   */
  function collectVisibleThreads() {
    const threadBlocks = findAllThreadBlocks();
    let collected = 0;
    let duplicates = 0;

    Utils.log('info', `${threadBlocks.length}개 스레드 블록 발견`);

    for (const block of threadBlocks) {
      const threadData = parseThread(block);
      if (!threadData) continue;

      if (processedThreads.has(threadData.threadId)) {
        duplicates++;
        continue;
      }

      processedThreads.add(threadData.threadId);
      collected++;

      // background.js로 전송
      chrome.runtime.sendMessage({
        type: 'thread:collected',
        data: threadData
      });
    }

    Utils.log('info', `수집: ${collected}개, 중복: ${duplicates}개`);
    return { collected, duplicates };
  }

  // ============ MutationObserver (자동 수집) ============

  function startAutoCollect() {
    if (observer) return;

    isAutoCollecting = true;

    // 먼저 현재 보이는 스레드 수집
    collectVisibleThreads();

    // 새 스레드 감지
    const feedContainer = document.querySelector('[role="main"]') || document.body;

    let debounceTimer = null;

    observer = new MutationObserver((mutations) => {
      // 새 노드가 추가되었는지 확인
      let hasNewContent = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 새 포스트 링크가 포함되어 있는지
              if (node.querySelector && node.querySelector('a[href*="/post/"]')) {
                hasNewContent = true;
                break;
              }
            }
          }
        }
        if (hasNewContent) break;
      }

      if (hasNewContent) {
        // Debounce: 500ms 후 수집 (빠른 연속 DOM 변경 대응)
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          collectVisibleThreads();
        }, 500);
      }
    });

    observer.observe(feedContainer, {
      childList: true,
      subtree: true,
    });

    Utils.log('info', '자동 수집 시작됨');
  }

  function stopAutoCollect() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    isAutoCollecting = false;
    Utils.log('info', '자동 수집 중지됨');
  }

  // ============ 메시지 수신 ============

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'manual:collect':
        const result = collectVisibleThreads();
        sendResponse(result);
        break;

      case 'auto:start':
        startAutoCollect();
        sendResponse({ success: true });
        break;

      case 'auto:stop':
        stopAutoCollect();
        sendResponse({ success: true });
        break;

      case 'status:get':
        sendResponse({
          isAutoCollecting,
          processedCount: processedThreads.size,
          url: window.location.href
        });
        break;
    }
    return true; // 비동기 응답 지원
  });

  // ============ 초기화 ============

  // 저장된 자동수집 설정 확인
  chrome.storage.local.get(['autoCollect'], (result) => {
    if (result.autoCollect) {
      // 페이지 로드 후 약간 지연 후 자동 수집 시작
      setTimeout(() => startAutoCollect(), 2000);
    }
  });

  Utils.log('info', 'Threads 수집기 콘텐츠 스크립트 로드됨', window.location.href);

})();
