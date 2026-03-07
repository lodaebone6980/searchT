/**
 * popup.js - 팝업 UI 로직
 * v2: 자동 스크롤 제어 UI 추가
 */

document.addEventListener('DOMContentLoaded', () => {
  const scrollToggle = document.getElementById('scrollToggle');
  const btnCollect = document.getElementById('btnCollect');
  const btnFlush = document.getElementById('btnFlush');
  const btnReset = document.getElementById('btnReset');
  const speedButtons = document.querySelectorAll('.speed-btn');

  let currentSpeed = 'medium';

  // ============ 통계 업데이트 ============

  function updateUI(data) {
    if (data.stats) {
      document.getElementById('statCollected').textContent = data.stats.collected || 0;
      document.getElementById('statSent').textContent = data.stats.sent || 0;
      document.getElementById('statDupes').textContent = data.stats.duplicates || 0;
      document.getElementById('statErrors').textContent = data.stats.errors || 0;

      if (data.stats.lastSentAt) {
        const time = new Date(data.stats.lastSentAt).toLocaleTimeString('ko-KR');
        document.getElementById('lastSent').textContent = `마지막 전송: ${time}`;
      }
    }

    if (data.queueSize > 0) {
      document.getElementById('queueInfo').style.display = 'block';
      document.getElementById('queueSize').textContent = data.queueSize;
    } else {
      document.getElementById('queueInfo').style.display = 'none';
    }

    if (data.recentLogs && data.recentLogs.length > 0) {
      renderLogs(data.recentLogs);
    }

    // 스크롤 상태 업데이트
    if (data.scrollStatus) {
      updateScrollUI(data.scrollStatus);
    }
  }

  function updateScrollUI(status) {
    const scrollIcon = document.getElementById('scrollIcon');
    const scrollStatusBox = document.getElementById('scrollStatusBox');
    const scrollCount = document.getElementById('scrollCount');
    const refreshCount = document.getElementById('refreshCount');
    const scrollState = document.getElementById('scrollState');

    if (status.active) {
      scrollToggle.checked = true;
      scrollStatusBox.style.display = 'flex';

      scrollCount.textContent = status.totalScrolls || 0;
      refreshCount.textContent = status.refreshCount || 0;

      if (status.isPaused) {
        scrollIcon.textContent = '👀';
        scrollIcon.className = 'scroll-icon';
        scrollState.textContent = '읽는 중...';
        scrollState.className = 'scroll-stat-value paused';
      } else {
        scrollIcon.textContent = '🔄';
        scrollIcon.className = 'scroll-icon active';
        scrollState.textContent = '스크롤 중';
        scrollState.className = 'scroll-stat-value';
      }

      // 속도 버튼 동기화
      if (status.speed) {
        currentSpeed = status.speed;
        syncSpeedButtons(status.speed);
      }
    } else {
      if (!scrollToggle.checked) {
        scrollStatusBox.style.display = 'none';
      }
      scrollIcon.textContent = '⏸';
      scrollIcon.className = 'scroll-icon';
    }
  }

  function syncSpeedButtons(speed) {
    speedButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.speed === speed);
    });
  }

  function renderLogs(logs) {
    const logList = document.getElementById('logList');

    if (logs.length === 0) {
      logList.innerHTML = '<div class="log-empty">아직 수집된 스레드가 없습니다.</div>';
      return;
    }

    logList.innerHTML = logs.slice(0, 20).map(log => `
      <div class="log-item">
        <span class="log-time">${log.time}</span>
        <span class="log-user">@${log.username}</span>
        <span class="log-category cat-${log.category}">${getCategoryLabel(log.category)}</span>
        <span class="log-text">${escapeHtml(log.text || '')}</span>
      </div>
    `).join('');
  }

  function getCategoryLabel(cat) {
    const labels = {
      shopping: '쇼핑',
      issue: '이슈',
      personal: '퍼스널',
      uncategorized: '미분류',
    };
    return labels[cat] || cat;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============ 초기 로드 ============

  chrome.runtime.sendMessage({ type: 'stats:get' }, (response) => {
    if (response) updateUI(response);
  });

  // 현재 탭 상태 확인
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && (tab.url.includes('threads.net') || tab.url.includes('threads.com'))) {
      document.getElementById('statusText').textContent = '✅ Threads 페이지 감지됨';
      btnCollect.disabled = false;

      // content script에서 스크롤 상태도 확인
      chrome.tabs.sendMessage(tab.id, { type: 'status:get' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp) {
          scrollToggle.checked = resp.isScrolling || false;
          if (resp.isScrolling) {
            document.getElementById('scrollStatusBox').style.display = 'flex';
            syncSpeedButtons(resp.scrollSpeed || 'medium');
          }
        }
      });
    } else {
      document.getElementById('statusText').textContent = '⚠️ Threads 페이지를 열어주세요';
      btnCollect.disabled = true;
      btnCollect.style.opacity = '0.5';
      scrollToggle.disabled = true;
    }
  });

  // ============ 이벤트 핸들러 ============

  // 자동 스크롤 토글
  scrollToggle.addEventListener('change', (e) => {
    chrome.runtime.sendMessage({
      type: 'scroll:toggle',
      enabled: e.target.checked,
      speed: currentSpeed,
    });

    if (e.target.checked) {
      document.getElementById('scrollStatusBox').style.display = 'flex';
    }
  });

  // 속도 버튼 클릭
  speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentSpeed = btn.dataset.speed;
      syncSpeedButtons(currentSpeed);

      chrome.runtime.sendMessage({
        type: 'scroll:setSpeed',
        speed: currentSpeed,
      });
    });
  });

  // 수동 수집 버튼
  btnCollect.addEventListener('click', () => {
    btnCollect.textContent = '⏳ 수집 중...';
    btnCollect.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'manual:collect' }, (response) => {
          if (response) {
            btnCollect.textContent = `✓ ${response.collected}개 수집됨!`;
          } else {
            btnCollect.textContent = '⚠️ 수집 실패';
          }

          setTimeout(() => {
            btnCollect.textContent = '🔄 지금 수집하기';
            btnCollect.disabled = false;
            chrome.runtime.sendMessage({ type: 'stats:get' }, (r) => {
              if (r) updateUI(r);
            });
          }, 2000);
        });
      }
    });
  });

  // 즉시 전송 버튼
  btnFlush.addEventListener('click', () => {
    btnFlush.textContent = '⏳ 전송 중...';
    chrome.runtime.sendMessage({ type: 'batch:flush' }, () => {
      btnFlush.textContent = '✓ 전송 완료!';
      setTimeout(() => {
        btnFlush.textContent = '📤 즉시 전송';
        chrome.runtime.sendMessage({ type: 'stats:get' }, (r) => {
          if (r) updateUI(r);
        });
      }, 1500);
    });
  });

  // 초기화 버튼
  btnReset.addEventListener('click', () => {
    if (confirm('통계와 로그를 초기화하시겠습니까?')) {
      chrome.runtime.sendMessage({ type: 'stats:reset' }, () => {
        chrome.runtime.sendMessage({ type: 'stats:get' }, (r) => {
          if (r) updateUI(r);
        });
      });
    }
  });

  // ============ 실시간 업데이트 ============

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'batch:result' || message.type === 'scroll:statusUpdate') {
      chrome.runtime.sendMessage({ type: 'stats:get' }, (r) => {
        if (chrome.runtime.lastError) return;
        if (r) updateUI(r);
      });
    }

    // 자동 스크롤 중지 알림
    if (message.type === 'scroll:stopped') {
      scrollToggle.checked = false;
      showNotification(message.message || '자동 스크롤이 중지되었습니다.', 'warning');
    }
  });

  // 알림 배너 표시
  function showNotification(text, type) {
    // 기존 알림 제거
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.className = `notification ${type || 'info'}`;
    notif.textContent = text;

    const header = document.querySelector('.header');
    header.after(notif);

    setTimeout(() => notif.remove(), 5000);
  }

  // 2초마다 통계 업데이트
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'stats:get' }, (r) => {
      if (chrome.runtime.lastError) return;
      if (r) updateUI(r);
    });
  }, 2000);
});
