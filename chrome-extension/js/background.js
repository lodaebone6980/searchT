/**
 * background.js - 서비스 워커 (배치 전송, 중복 관리, 통계, 스크롤 상태)
 * v2: 자동 스크롤 상태 관리 추가
 */

const API_URL = 'https://searcht-production.up.railway.app';
const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;

// 상태
let batchQueue = [];
let batchTimer = null;
let threadCache = new Set();
let stats = {
  collected: 0,
  duplicates: 0,
  errors: 0,
  sent: 0,
  lastSentAt: null,
};
let recentLogs = [];

// 스크롤 상태 (content.js에서 전파받음)
let scrollStatus = {
  active: false,
  speed: 'medium',
  totalScrolls: 0,
  stuckCount: 0,
  refreshCount: 0,
  isPaused: false,
  processedCount: 0,
};

// ============ 배치 큐 관리 ============

function addToBatch(threadData) {
  if (threadCache.has(threadData.threadId)) {
    stats.duplicates++;
    updateBadge();
    return;
  }

  threadCache.add(threadData.threadId);
  batchQueue.push(threadData);
  stats.collected++;

  addLog(threadData);

  if (batchQueue.length >= BATCH_SIZE) {
    flushBatch();
  } else {
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

      console.log(`[Threads\uC218\uC9D1\uAE30] \uBC30\uCE58 \uC804\uC1A1 \uC131\uACF5: ${result.collectedCount}\uAC1C \uC800\uC7A5, ${result.duplicateCount}\uAC1C \uC911\uBCF5`);

      saveStats();
      updateBadge();

      chrome.runtime.sendMessage({
        type: 'batch:result',
        success: true,
        collected: result.collectedCount,
        duplicates: result.duplicateCount,
      }).catch(() => {});

      return;

    } catch (error) {
      retries++;
      console.error(`[Threads\uC218\uC9D1\uAE30] \uBC30\uCE58 \uC804\uC1A1 \uC2E4\uD328 (\uC2DC\uB3C4 ${retries}/${MAX_RETRIES}):`, error);

      if (retries >= MAX_RETRIES) {
        stats.errors += threads.length;
        console.error('[Threads\uC218\uC9D1\uAE30] \uCD5C\uB300 \uC7AC\uC2DC\uB3C4 \uCD08\uACFC, \uC2A4\uB808\uB4DC \uD3D0\uAE30:', threads.length);
        saveStats();
        updateBadge();
      } else {
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
  chrome.action.setBadgeBackgroundColor({ color: scrollStatus.active ? '#3B82F6' : '#10B981' });
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
      sendResponse({ stats, recentLogs, queueSize: batchQueue.length, scrollStatus });
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
      return true;

    case 'collector:toggle':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: message.enabled ? 'auto:start' : 'auto:stop'
          }).catch(() => {});
        }
      });
      chrome.storage.local.set({ autoCollect: message.enabled });
      sendResponse({ success: true });
      break;

    // 자동 스크롤 제어 (popup → background → content)
    case 'scroll:toggle': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: message.enabled ? 'scroll:start' : 'scroll:stop',
            speed: message.speed || 'medium',
          }).catch(() => {});
        }
      });
      // 자동 수집도 같이 켜기/끄기
      if (message.enabled) {
        chrome.storage.local.set({ autoCollect: true });
      }
      sendResponse({ success: true });
      break;
    }

    case 'scroll:setSpeed': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'scroll:setSpeed',
            speed: message.speed,
          }).catch(() => {});
        }
      });
      sendResponse({ success: true });
      break;
    }

    // content.js에서 스크롤 상태 전파 받기
    case 'scroll:status':
      scrollStatus = message.data || scrollStatus;
      updateBadge();
      // 팝업에 전달
      chrome.runtime.sendMessage({
        type: 'scroll:statusUpdate',
        data: scrollStatus
      }).catch(() => {});
      sendResponse({ success: true });
      break;

    // 스크롤 최대 새로고침 초과 알림
    case 'scroll:maxRefresh':
      scrollStatus.active = false;
      chrome.runtime.sendMessage({
        type: 'scroll:stopped',
        message: message.message,
      }).catch(() => {});
      sendResponse({ success: true });
      break;
  }
  return true;
});

// ============ 초기화 ============
loadStats();
console.log('[Threads\uC218\uC9D1\uAE30] \uBC31\uADF8\uB77C\uC6B4\uB4DC \uC11C\uBE44\uC2A4 \uC6CC\uCEE4 v2 \uC2DC\uC791\uB428');
