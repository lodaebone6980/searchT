/**
 * background.js - 서비스 워커 (배치 전송, 중복 관리, 통계)
 */

const API_URL = 'https://searcht-production.up.railway.app';
const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;

// 상태
let batchQueue = [];
let batchTimer = null;
let threadCache = new Set(); // 중복 감지용
let stats = {
  collected: 0,
  duplicates: 0,
  errors: 0,
  sent: 0,
  lastSentAt: null,
};
let recentLogs = []; // 최근 수집 로그 (최대 50개)

// ============ 배치 큐 관리 ============

function addToBatch(threadData) {
  // 로컬 중복 체크
  if (threadCache.has(threadData.threadId)) {
    stats.duplicates++;
    updateBadge();
    return;
  }

  threadCache.add(threadData.threadId);
  batchQueue.push(threadData);
  stats.collected++;

  // 로그 추가
  addLog(threadData);

  // 배치 크기 도달 시 즉시 전송
  if (batchQueue.length >= BATCH_SIZE) {
    flushBatch();
  } else {
    // 타이머 리셋
    clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, BATCH_TIMEOUT_MS);
  }

  updateBadge();
}

async function flushBatch() {
  if (batchQueue.length === 0) return;

  clearTimeout(batchTimer);
  const threads = batchQueue.splice(0);

  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      const response = await fetch(`${API_URL}/api/threads/batch-collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threads }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      stats.sent += result.collectedCount || 0;
      stats.duplicates += result.duplicateCount || 0;
      stats.lastSentAt = new Date().toISOString();

      console.log(`[Threads수집기] 배치 전송 성공: ${result.collectedCount}개 저장, ${result.duplicateCount}개 중복`);

      // 통계 저장
      saveStats();
      updateBadge();

      // 팝업에 결과 알림
      chrome.runtime.sendMessage({
        type: 'batch:result',
        success: true,
        collected: result.collectedCount,
        duplicates: result.duplicateCount,
      }).catch(() => {}); // 팝업이 닫혀있으면 무시

      return;

    } catch (error) {
      retries++;
      console.error(`[Threads수집기] 배치 전송 실패 (시도 ${retries}/${MAX_RETRIES}):`, error);

      if (retries >= MAX_RETRIES) {
        stats.errors += threads.length;
        console.error('[Threads수집기] 최대 재시도 초과, 스레드 폐기:', threads.length);
        saveStats();
        updateBadge();
      } else {
        // 재시도 전 대기
        await new Promise(r => setTimeout(r, 1000 * retries));
      }
    }
  }
}

// ============ 로그 관리 ============

function addLog(threadData) {
  const logEntry = {
    time: new Date().toLocaleTimeString('ko-KR'),
    username: threadData.author?.username || 'unknown',
    category: threadData.category?.primary || 'uncategorized',
    text: (threadData.content?.text || '').substring(0, 50),
    threadId: threadData.threadId,
  };

  recentLogs.unshift(logEntry);
  if (recentLogs.length > 50) recentLogs.pop();
}

// ============ 배지 업데이트 ============

function updateBadge() {
  const count = stats.collected;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // 녹색
}

// ============ 통계 저장/로드 ============

function saveStats() {
  chrome.storage.local.set({ stats, recentLogs });
}

function loadStats() {
  chrome.storage.local.get(['stats', 'recentLogs'], (result) => {
    if (result.stats) stats = result.stats;
    if (result.recentLogs) recentLogs = result.recentLogs;
    updateBadge();
  });
}

// ============ 메시지 핸들러 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'thread:collected':
      addToBatch(message.data);
      sendResponse({ success: true });
      break;

    case 'stats:get':
      sendResponse({ stats, recentLogs, queueSize: batchQueue.length });
      break;

    case 'stats:reset':
      stats = { collected: 0, duplicates: 0, errors: 0, sent: 0, lastSentAt: null };
      recentLogs = [];
      threadCache.clear();
      saveStats();
      updateBadge();
      sendResponse({ success: true });
      break;

    case 'batch:flush':
      flushBatch().then(() => sendResponse({ success: true }));
      return true; // 비동기

    case 'collector:toggle':
      // 활성 탭의 content script에 전달
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: message.enabled ? 'auto:start' : 'auto:stop'
          }).catch(() => {});
        }
      });
      // 설정 저장
      chrome.storage.local.set({ autoCollect: message.enabled });
      sendResponse({ success: true });
      break;
  }
  return true;
});

// ============ 초기화 ============
loadStats();
console.log('[Threads수집기] 백그라운드 서비스 워커 시작됨');
