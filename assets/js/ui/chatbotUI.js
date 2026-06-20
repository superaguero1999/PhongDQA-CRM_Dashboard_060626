const ChatbotUI = (() => {
  'use strict';

  const TOOL_LABELS = {
    switch_main_tab:    'Chuyển dataset',
    switch_sub_tab:     'Chuyển tab',
    filter_product:     'Lọc sản phẩm',
    filter_month:       'Lọc tháng',
    clear_filters:      'Xoá filter',
    set_top_n:          'Đặt Top N',
    set_sort_order:     'Sắp xếp',
    set_chart_type:     'Đổi biểu đồ',
    read_current_state: 'Đọc trạng thái',
    sum_errors:         'Đọc tổng lỗi',
    sum_rate:           'Đọc TLL%',
    analyze_trend:      'Phân tích xu hướng',
    read_top_products:    'Xếp hạng sản phẩm',
    read_dashboard_groups: 'Đọc nhóm lỗi',
    _retry:             '⏳ Vui lòng chờ, hệ thống đang xử lý...',
  };

  const SUGGESTIONS = [
    'Tỷ lệ lỗi tháng gần nhất',
    'Tổng lỗi tháng này là bao nhiêu',
    'Loại lỗi nào nhiều nhất',
    'Xu hướng TLL% 3 tháng gần nhất',
    'Sản phẩm nào có TLL% cao nhất',
  ];

  let _isOpen     = false;
  let _isExpanded = true;
  let _stepCounter = 0;

  function _el(id) { return document.getElementById(id); }

  function _escHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
  }

  // ── Panel open / close ────────────────────────────────────────────────────
  function toggle() {
    _isOpen = !_isOpen;
    const panel = _el('chatbot-panel');
    const btn   = _el('chatbot-float-btn');
    if (!panel) return;
    if (_isOpen) {
      panel.classList.remove('chatbot-closed');
      panel.classList.add('chatbot-open');
      btn && btn.classList.add('chatbot-btn-active');
      _el('chatbot-input')?.focus();
    } else {
      panel.classList.remove('chatbot-open');
      panel.classList.add('chatbot-closed');
      btn && btn.classList.remove('chatbot-btn-active');
    }
  }

  // ── Icon SVG cho nút expand/collapse ─────────────────────────────────────
  const _SVG_EXPAND   = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="8,1 12,1 12,5"/>
    <line x1="7" y1="6" x2="12" y2="1"/>
    <polyline points="5,12 1,12 1,8"/>
    <line x1="6" y1="7" x2="1" y2="12"/>
  </svg>`;
  const _SVG_COLLAPSE = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="1" x2="8" y2="5"/>
    <polyline points="8,2 8,5 11,5"/>
    <line x1="1" y1="12" x2="5" y2="8"/>
    <polyline points="5,11 5,8 2,8"/>
  </svg>`;

  // ── Expand / compact toggle ───────────────────────────────────────────────
  function toggleExpand() {
    _isExpanded = !_isExpanded;
    const panel = _el('chatbot-panel');
    const btn   = _el('chatbot-expand-btn');
    if (!panel) return;
    if (_isExpanded) {
      panel.classList.add('chatbot-expanded');
      if (btn) { btn.innerHTML = _SVG_COLLAPSE; btn.title = 'Thu nhỏ'; }
    } else {
      panel.classList.remove('chatbot-expanded');
      if (btn) { btn.innerHTML = _SVG_EXPAND; btn.title = 'Phóng to'; }
    }
    const list = _el('chatbot-messages');
    setTimeout(() => { if (list) list.scrollTop = list.scrollHeight; }, 320);
  }

  // ── Message rendering ─────────────────────────────────────────────────────
  function _addMessage(role, text, steps) {
    const list = _el('chatbot-messages');
    if (!list) return null;

    const isUser = role === 'user';
    const wrap   = document.createElement('div');
    wrap.className = `chat-msg-wrap ${isUser ? 'chat-msg-wrap-user' : 'chat-msg-wrap-bot'}`;

    const stepsHtml = (steps && steps.length)
      ? `<div class="chat-steps">${steps.map(s =>
          `<div class="chat-step" id="step-${s.id}">
            <span class="chat-step-icon">○</span>
            <span class="chat-step-label">${TOOL_LABELS[s.tool] || s.tool}</span>
          </div>`).join('')}</div>`
      : '';

    wrap.innerHTML = `
      <div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-bot'}">
        ${stepsHtml}
        <div class="chat-text">${_escHtml(text)}</div>
      </div>`;

    list.appendChild(wrap);
    list.scrollTop = list.scrollHeight;
    return wrap;
  }

  function _updateStep(stepId, status) {
    const el = document.getElementById(`step-${stepId}`);
    if (!el) return;
    const icon = el.querySelector('.chat-step-icon');
    if (!icon) return;
    if (status === 'running') { icon.textContent = '⟳'; icon.style.color = '#6366F1'; }
    else if (status === 'done')  { icon.textContent = '✓'; icon.style.color = '#10B981'; }
    else if (status === 'error') { icon.textContent = '✕'; icon.style.color = '#EF4444'; }
  }

  function _setTyping(show) {
    const existing = _el('chatbot-typing');
    if (show && !existing) {
      const list = _el('chatbot-messages');
      if (!list) return;
      const div = document.createElement('div');
      div.id = 'chatbot-typing';
      div.className = 'chat-msg-wrap chat-msg-wrap-bot';
      div.innerHTML = `<div class="chat-bubble chat-bubble-bot">
        <div class="chat-typing"><span></span><span></span><span></span></div>
      </div>`;
      list.appendChild(div);
      list.scrollTop = list.scrollHeight;
    } else if (!show && existing) {
      existing.remove();
    }
  }

  // ── Suggestions chips ─────────────────────────────────────────────────────
  function _renderSuggestions() {
    const wrap = _el('chatbot-suggestions');
    if (!wrap) return;
    wrap.innerHTML = SUGGESTIONS.map(s =>
      `<button class="chat-chip" data-text="${s}">${s}</button>`
    ).join('');
    wrap.querySelectorAll('.chat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = _el('chatbot-input');
        if (inp) { inp.value = btn.dataset.text; inp.focus(); }
        _send();
      });
    });
  }

  // ── Send message ──────────────────────────────────────────────────────────
  async function _send() {
    const input = _el('chatbot-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    _addMessage('user', text);
    _setTyping(true);

    // Pending steps state
    const pendingSteps = [];
    let botMsgEl = null;

    const onActionStep = ({ tool, input: toolInput, status }) => {
      if (status === 'running') {
        const id = `s${++_stepCounter}`;
        pendingSteps.push({ id, tool, input: toolInput });

        if (!botMsgEl) {
          _setTyping(false);
          botMsgEl = _addMessage('bot', '', pendingSteps);
        } else {
          const stepsDiv = botMsgEl.querySelector('.chat-steps');
          if (stepsDiv) {
            const row = document.createElement('div');
            row.className = 'chat-step';
            row.id = `step-${id}`;
            row.innerHTML = `<span class="chat-step-icon" style="color:#6366F1">⟳</span>
                             <span class="chat-step-label">${TOOL_LABELS[tool] || tool}</span>`;
            stepsDiv.appendChild(row);
            const list = _el('chatbot-messages');
            if (list) list.scrollTop = list.scrollHeight;
          }
        }
        _updateStep(id, 'running');

      } else if (status === 'done') {
        const step = pendingSteps.findLast(s => s.tool === tool && !s._done);
        if (step) { step._done = true; _updateStep(step.id, 'done'); }
      }
    };

    const onDisambiguate = ({ candidates, resolve }) => {
      if (!botMsgEl) {
        _setTyping(false);
        botMsgEl = _addMessage('bot', '', pendingSteps);
      }
      const bubble = botMsgEl.querySelector('.chat-bubble-bot');
      if (!bubble) { resolve(candidates[0]); return; }

      const box = document.createElement('div');
      box.className = 'chat-disambiguate';
      box.innerHTML =
        `<div class="chat-disambiguate-label">Tìm thấy nhiều kết quả. Chọn model bạn muốn:</div>` +
        `<div class="chat-disambiguate-opts">${candidates.map(c =>
          `<button class="chat-disambiguate-btn" data-value="${c.replace(/"/g,'&quot;')}">${c}</button>`
        ).join('')}</div>`;
      bubble.appendChild(box);

      const msgList = _el('chatbot-messages');
      if (msgList) msgList.scrollTop = msgList.scrollHeight;

      box.querySelectorAll('.chat-disambiguate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          box.querySelectorAll('.chat-disambiguate-btn').forEach(b => {
            b.disabled = true;
            if (b.dataset.value === btn.dataset.value) b.classList.add('chat-disambiguate-selected');
            else b.style.opacity = '0.35';
          });
          const lbl = box.querySelector('.chat-disambiguate-label');
          if (lbl) lbl.textContent = `Đã chọn: ${btn.dataset.value}`;
          resolve(btn.dataset.value);
        });
      });
    };

    try {
      const res = await ChatbotService.sendMessage(text, { onActionStep, onDisambiguate });
      _setTyping(false);

      if (botMsgEl) {
        const textDiv = botMsgEl.querySelector('.chat-text');
        if (textDiv) textDiv.innerHTML = _escHtml(res.message);
      } else {
        _addMessage('bot', res.message);
      }
    } catch (err) {
      _setTyping(false);
      _addMessage('bot', `Lỗi: ${err.message}`);
    }

    const list = _el('chatbot-messages');
    if (list) list.scrollTop = list.scrollHeight;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _el('chatbot-float-btn')?.addEventListener('click', toggle);
    _el('chatbot-close-btn')?.addEventListener('click', toggle);
    _el('chatbot-expand-btn')?.addEventListener('click', toggleExpand);

    _el('chatbot-clear-btn')?.addEventListener('click', () => {
      ChatbotService.clearHistory();
      const list = _el('chatbot-messages');
      if (list) list.innerHTML = '';
      _addMessage('bot', 'Đã xoá lịch sử. Tôi có thể giúp gì cho bạn?');
    });

    _el('chatbot-send-btn')?.addEventListener('click', _send);

    const input = _el('chatbot-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
      });
      // Auto-resize textarea
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
    }

    _renderSuggestions();

    // Welcome message
    _addMessage('bot',
      'Xin chào! Tôi có thể giúp bạn điều hướng dashboard và tìm dữ liệu.\n' +
      'Bạn có thể hỏi hoặc ra lệnh bằng tiếng Việt tự nhiên.\n' +
      'Thử một trong các gợi ý bên dưới hoặc nhập câu hỏi của bạn!'
    );
  }

  return { init, toggle };
})();
