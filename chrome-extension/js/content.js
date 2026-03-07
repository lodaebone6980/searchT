/**
 * content.js - Threads.net DOM 파싱 & 자동 스크롤 수집 엔진
 * threads.com / threads.net 피드에서 스레드 데이터를 추출합니다.
 *
 * v2: 자동 스크롤 + 랜덤 딜레이 + 막힘 감지 + 새로고침
 */

(function() {
  'use strict';

  const Utils = window.ThreadsUtils;
  const Classifier = window.ThreadsClassifier;

  // 이미 처리한 threadId Set
  const processedThreads = new Set();
  let isAutoCollecting = false;
  let observer = null;

  // ============ 자동 스크롤 엔진 ============

  const scrollEngine = {
    active: false,
    speed: 'medium', // slow, medium, fast
    intervalId: null,
    stuckCount: 0,
    lastThreadCount: 0,
    totalScrolls: 0,
    refreshCount: 0,
    maxRefreshes: 5, // 연속 새로고침 한도
    isPaused: false,  // 잠시 멈춤 (사람처럼 읽는 척)

    // 속도별 설정 (밀리초)
    speedConfig: {
      slow: {
        scrollDelayMin: 3000,
        scrollDelayMax: 7000,
        scrollAmountMin: 300,
        scrollAmountMax: 600,
        pauseChance: 0.3,       // 30% 확률로 읽는 척 멈춤
        pauseDurationMin: 2000,
        pauseDurationMax: 8000,
        stuckThreshold: 5,      // 5번 스크롤해도 새 스레드 없으면 막힌 것
      },
      medium: {
        scrollDelayMin: 1500,
        scrollDelayMax: 4000,
        scrollAmountMin: 400,
        scrollAmountMax: 800,
        pauseChance: 0.2,
        pauseDurationMin: 1000,
        pauseDurationMax: 5000,
        stuckThreshold: 4,
      },
      fast: {
        scrollDelayMin: 800,
        scrollDelayMax: 2000,
        scrollAmountMin: 500,
        scrollAmountMax: 1000,
        pauseChance: 0.1,
        pauseDurationMin: 500,
        pauseDurationMax: 2000,
        stuckThreshold: 3,
      },
    },

    getConfig() {
      return this.speedConfig[this.speed] || this.speedConfig.medium;
    },

    // 랜덤 범위 값
    randomBetween(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    // 사람처럼 보이는 스크롤 양 (약간의 지터 추가)
    getScrollAmount() {
      const config = this.getConfig();
      const base = this.randomBetween(config.scrollAmountMin, config.scrollAmountMax);
      // 가끔 작게, 가끔 크게 (비규칙적)
      const jitter = (Math.random() - 0.5) * 200;
      return Math.max(100, Math.round(base + jitter));
    },

    // 다음 스크롤까지 대기 시간
    getScrollDelay() {
      const config = this.getConfig();
      return this.randomBetween(config.scrollDelayMin, config.scrollDelayMax);
    },

    // 사람처럼 가끔 위로 살짝 스크롤 (읽던 걸 다시 보는 느낌)
    shouldScrollUp() {
      return Math.random() < 0.05; // 5% 확률
    },

    // "읽는 척" 멈춤
    shouldPause() {
      const config = this.getConfig();
      return Math.random() < config.pauseChance;
    },

    getPauseDuration() {
      const config = this.getConfig();
      return this.randomBetween(config.pauseDurationMin, config.pauseDurationMax);
    },

    // 시작
    start(speed) {
      if (this.active) return;
      this.active = true;
      this.speed = speed || this.speed;
      this.stuckCount = 0;
      this.totalScrolls = 0;
      this.refreshCount = 0;
      this.lastThreadCount = processedThreads.size;

      Utils.log('info', `자동 스크롤 시작 (속도: ${this.speed})`);
      this.scheduleNextScroll();
      this.broadcastStatus();
    },

    // 정지
    stop() {
      this.active = false;
      if (this.intervalId) {
        clearTimeout(this.intervalId);
        this.intervalId = null;
      }
      Utils.log('info', '자동 스크롤 중지');
      this.broadcastStatus();
    },

    // 다음 스크롤 예약
    scheduleNextScroll() {
      if (!this.active) return;

      const delay = this.getScrollDelay();

      this.intervalId = setTimeout(async () => {
        if (!this.active) return;

        // 가끔 멈추기 (사람 패턴)
        if (this.shouldPause()) {
          const pauseMs = this.getPauseDuration();
          Utils.log('debug', `읽는 중... (${(pauseMs/1000).toFixed(1)}초 대기)`);
          this.isPaused = true;
          this.broadcastStatus();
          await new Promise(r => setTimeout(r, pauseMs));
          this.isPaused = false;
          if (!this.active) return;
        }

        // 스크롤 실행
        this.doScroll();
        this.totalScrolls++;

        // 수집 실행
        const beforeCount = processedThreads.size;
        collectVisibleThreads();
        const afterCount = processedThreads.size;
        const newFound = afterCount - beforeCount;

        // 막힘 감지
        if (newFound === 0) {
          this.stuckCount++;
        } else {
          this.stuckCount = 0;
          this.refreshCount = 0; // 새로운 게 나오면 리셋
        }

        const config = this.getConfig();
        if (this.stuckCount >= config.stuckThreshold) {
          Utils.log('warn', `${this.stuckCount}번 연속 새 스레드 없음 → 조치 중`);
          await this.handleStuck();
        }

        this.broadcastStatus();

        // 다음 스크롤 예약
        this.scheduleNextScroll();
      }, delay);
    },

    // 실제 스크롤 동작
    doScroll() {
      if (this.shouldScrollUp()) {
        // 가끔 위로 살짝 (사람 행동 모방)
        const upAmount = this.randomBetween(100, 300);
        window.scrollBy({ top: -upAmount, behavior: 'smooth' });
        Utils.log('debug', `↑ 위로 ${upAmount}px 스크롤 (자연스러운 패턴)`);
      } else {
        const amount = this.getScrollAmount();
        window.scrollBy({ top: amount, behavior: 'smooth' });
        Utils.log('debug', `↓ 아래로 ${amount}px 스크롤`);
      }
    },

    // 막혔을 때 처리
    async handleStuck() {
      this.stuckCount = 0;

      // 1단계: 맨 아래까지 빠르게 스크롤 시도
      if (this.refreshCount === 0) {
        Utils.log('info', '피드 끝 감지 → 맨 아래 스크롤 시도');
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 3000));
        this.refreshCount++;
        return;
      }

      // 2단계: 페이지 맨 위로 올린 후 다시 내려가기
      if (this.refreshCount === 1) {
        Utils.log('info', '맨 위로 이동 후 재스크롤');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 2000));
        this.refreshCount++;
        return;
      }

      // 3단계: 페이지 새로고침
      if (this.refreshCount < this.maxRefreshes) {
        Utils.log('info', `페이지 새로고침 (${this.refreshCount}/${this.maxRefreshes})`);
        this.refreshCount++;

        // 새로고침 전 상태 저장
        chrome.storage.local.set({
          scrollEngine: {
            active: true,
            speed: this.speed,
            refreshCount: this.refreshCount,
            totalScrolls: this.totalScrolls,
          }
        });

        // 랜덤 딜레이 후 새로고침 (봇 감지 회피)
        const refreshDelay = this.randomBetween(3000, 8000);
        Utils.log('info', `${(refreshDelay/1000).toFixed(1)}초 후 새로고침...`);
        await new Promise(r => setTimeout(r, refreshDelay));
        window.location.reload();
        return;
      }

      // 4단계: 최대 새로고침 초과 → 자동 중지
      Utils.log('warn', '최대 새로고침 횟수 초과 → 자동 스크롤 중지');
      this.stop();

      // 팝업에 알림
      chrome.runtime.sendMessage({
        type: 'scroll:maxRefresh',
        message: '더 이상 새 스레드를 찾을 수 없어 자동 스크롤을 중지했습니다.'
      }).catch(() => {});
    },

    // 상태를 background/popup에 전파
    broadcastStatus() {
      chrome.runtime.sendMessage({
        type: 'scroll:status',
        data: {
          active: this.active,
          speed: this.speed,
          totalScrolls: this.totalScrolls,
          stuckCount: this.stuckCount,
          refreshCount: this.refreshCount,
          isPaused: this.isPaused,
          processedCount: processedThreads.size,
        }
      }).catch(() => {});
    },

    // 속도 변경
    setSpeed(newSpeed) {
      if (['slow', 'medium', 'fast'].includes(newSpeed)) {
        this.speed = newSpeed;
        Utils.log('info', `스크롤 속도 변경: ${newSpeed}`);
        this.broadcastStatus();
      }
    },
  };

  // ============ DOM 파싱 ============

  function findAllThreadBlocks() {
    const postLinks = document.querySelectorAll('a[href*="/post/"]');
    const threads = [];
    const seen = new Set();

    for (const postLink of postLinks) {
      const href = postLink.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const threadBlock = findThreadContainer(postLink);
      if (threadBlock) {
        threads.push({ postLink, container: threadBlock, href });
      }
    }

    return threads;
  }

  function findThreadContainer(postLink) {
    let el = postLink;
    for (let i = 0; i < 10; i++) {
      el = el.parentElement;
      if (!el) return null;

      const otherPosts = el.querySelectorAll('a[href*="/post/"]');
      if (otherPosts.length > 1) {
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

  function parseThread(threadInfo) {
    const { postLink, container, href } = threadInfo;

    try {
      const threadId = Utils.extractThreadId(href);
      if (!threadId) return null;

      const baseUrl = window.location.origin;
      const originalUrl = href.startsWith('http') ? href : baseUrl + href;
      const author = extractAuthor(container, href);
      const textContent = extractText(container, postLink);
      const media = extractMedia(container);
      const metrics = extractMetrics(container);
      const externalUrls = extractExternalUrls(container);
      const allUrls = externalUrls.map(u => Utils.resolveThreadsUrl(u));
      const classification = Classifier.classify(textContent, allUrls);
      const affiliate = Utils.detectAffiliateLinks(allUrls);
      const region = Utils.detectRegion(textContent);
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
    const usernameMatch = postHref.match(/@([\w.]+)/);
    const username = usernameMatch ? usernameMatch[1] : 'unknown';

    const profileLink = container.querySelector(`a[href*="/@${username}"]`);

    let profilePicUrl = '';
    if (profileLink) {
      const img = profileLink.querySelector('img');
      if (img) profilePicUrl = img.src || '';
    }

    let displayName = username;
    const allLinks = container.querySelectorAll('a');
    for (const link of allLinks) {
      const linkHref = link.getAttribute('href') || '';
      if (linkHref === `/@${username}` && link.textContent.trim() && !link.querySelector('img')) {
        displayName = link.textContent.trim();
        break;
      }
    }

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
    const texts = [];
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      if (el.closest('button')) continue;
      if (el.tagName === 'TIME' || el.tagName === 'A') continue;

      const directText = getDirectText(el);
      if (directText && directText.length > 2) {
        if (/^\d+시간$|^\d+분$|^\d+일$|^\d+초$/.test(directText.trim())) continue;
        if (/^[\d,.]+[만천KMB]?$/.test(directText.trim())) continue;
        if (['번역하기', '더 보기', '좋아요', '댓글', '리포스트', '공유하기'].includes(directText.trim())) continue;
        if (directText.includes('인증된 계정')) continue;
        if (directText.trim() === extractUsernameFromContainer(container)) continue;

        texts.push(directText.trim());
      }
    }

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

    const images = container.querySelectorAll('img');
    for (const img of images) {
      const src = img.src || '';
      const alt = img.getAttribute('alt') || '';
      if (alt.includes('프로필 사진') || alt.includes('profile')) continue;
      if (img.width < 50 && img.height < 50) continue;
      if (alt.includes('좋아요') || alt.includes('댓글') || alt.includes('리포스트') ||
          alt.includes('공유') || alt.includes('더 보기') || alt.includes('인증')) continue;

      if (src && src.startsWith('http')) {
        urls.push(src);
        type = 'image';
      }
    }

    const videos = container.querySelectorAll('video');
    if (videos.length > 0) {
      type = 'video';
      for (const video of videos) {
        if (video.src) urls.push(video.src);
        if (video.poster) urls.push(video.poster);
      }
    }

    const videoGroup = container.querySelector('[role="group"]');
    if (videoGroup) type = 'video';

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
      if (href.startsWith('/@') || href.includes('/post/') || href.includes('/search')) continue;
      if (href.includes('l.threads.com') || (href.startsWith('http') && !href.includes('threads.net') && !href.includes('threads.com'))) {
        urls.push(href);
      }
    }

    return urls;
  }

  // ============ 수집 로직 ============

  function collectVisibleThreads() {
    const threadBlocks = findAllThreadBlocks();
    let collected = 0;
    let duplicates = 0;

    for (const block of threadBlocks) {
      const threadData = parseThread(block);
      if (!threadData) continue;

      if (processedThreads.has(threadData.threadId)) {
        duplicates++;
        continue;
      }

      processedThreads.add(threadData.threadId);
      collected++;

      chrome.runtime.sendMessage({
        type: 'thread:collected',
        data: threadData
      });
    }

    if (collected > 0) {
      Utils.log('info', `수집: ${collected}개, 중복: ${duplicates}개 (총 ${processedThreads.size}개)`);
    }
    return { collected, duplicates };
  }

  // ============ MutationObserver (자동 수집) ============

  function startAutoCollect() {
    if (observer) return;

    isAutoCollecting = true;

    // 먼저 현재 보이는 스레드 수집
    collectVisibleThreads();

    const feedContainer = document.querySelector('[role="main"]') || document.body;

    let debounceTimer = null;

    observer = new MutationObserver((mutations) => {
      let hasNewContent = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
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
      case 'manual:collect': {
        const result = collectVisibleThreads();
        sendResponse(result);
        break;
      }

      case 'auto:start':
        startAutoCollect();
        sendResponse({ success: true });
        break;

      case 'auto:stop':
        stopAutoCollect();
        sendResponse({ success: true });
        break;

      // 자동 스크롤 제어
      case 'scroll:start':
        startAutoCollect(); // 자동 수집도 같이 켜기
        scrollEngine.start(message.speed || 'medium');
        sendResponse({ success: true });
        break;

      case 'scroll:stop':
        scrollEngine.stop();
        sendResponse({ success: true });
        break;

      case 'scroll:setSpeed':
        scrollEngine.setSpeed(message.speed);
        sendResponse({ success: true });
        break;

      case 'scroll:status':
        sendResponse({
          active: scrollEngine.active,
          speed: scrollEngine.speed,
          totalScrolls: scrollEngine.totalScrolls,
          stuckCount: scrollEngine.stuckCount,
          refreshCount: scrollEngine.refreshCount,
          isPaused: scrollEngine.isPaused,
        });
        break;

      case 'status:get':
        sendResponse({
          isAutoCollecting,
          isScrolling: scrollEngine.active,
          scrollSpeed: scrollEngine.speed,
          processedCount: processedThreads.size,
          url: window.location.href
        });
        break;
    }
    return true;
  });

  // ============ 초기화 ============

  // 새로고침 후 자동 스크롤 복원
  chrome.storage.local.get(['autoCollect', 'scrollEngine'], (result) => {
    if (result.autoCollect) {
      setTimeout(() => startAutoCollect(), 2000);
    }

    // 새로고침으로 인한 스크롤 복원
    if (result.scrollEngine && result.scrollEngine.active) {
      Utils.log('info', '새로고침 후 자동 스크롤 복원');
      setTimeout(() => {
        startAutoCollect();
        scrollEngine.refreshCount = result.scrollEngine.refreshCount || 0;
        scrollEngine.totalScrolls = result.scrollEngine.totalScrolls || 0;
        scrollEngine.start(result.scrollEngine.speed || 'medium');

        // 복원 후 저장된 상태 삭제
        chrome.storage.local.remove('scrollEngine');
      }, 3000); // 페이지 로드 대기
    }
  });

  Utils.log('info', 'Threads 수집기 콘텐츠 스크립트 v2 로드됨', window.location.href);

})();
