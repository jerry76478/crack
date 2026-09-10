// ==UserScript==
// @name         ✏️ Crack Input Wrapper Popup (크랙 입력 감싸기 팝업) 모바일 대응
// @namespace    crack-input-wrapper-popup
// @version      0.1.9
// @description  크랙 채팅 입력창/수정창에서 드래그 선택한 텍스트를 따옴표·괄호·마크다운 기호로 감싸는 선택 팝업 도구입니다. 모바일 터치에서 버튼이 눌리지 않던 문제를 수정했습니다.
// @author       Assistant
// @downloadURL  https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-input-wrapper-popup.user.js
// @updateURL    https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-input-wrapper-popup.user.js
// @match        https://crack.wrtn.ai/*
// @match        https://*.crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const NS = 'ciw';
  const TOOLBAR_WRAPPER_ID = 'ciw-toolbar-wrapper';
  const TOOLBAR_BUTTON_ID = 'ciw-toolbar-button';
  const SELECTION_BAR_ID = 'ciw-selection-bar';
  const SETTINGS_ID = 'ciw-settings-overlay';
  const TOAST_ID = 'ciw-toast';

  const TOOLS_KEY = 'CrackInputWrapperPopup_Tools_v1';
  const SETTINGS_KEY = 'CrackInputWrapperPopup_Settings_v1';

  const DEFAULT_TOOLS = [
    { id: 'double', label: '쌍따옴표', icon: '“”', pre: '"', suf: '"', enabled: true },
    { id: 'single', label: '작은따옴표', icon: '‘’', pre: "'", suf: "'", enabled: true },
    { id: 'jp-double', label: '『 』', icon: '『』', pre: '『', suf: '』', enabled: true },
    { id: 'jp-single', label: '「 」', icon: '「」', pre: '「', suf: '」', enabled: true },
    { id: 'paren', label: '소괄호', icon: '()', pre: '(', suf: ')', enabled: true },
    { id: 'bold', label: '굵게', icon: '**', pre: '**', suf: '**', enabled: true },
    { id: 'strike', label: '취소선', icon: '~~', pre: '~~', suf: '~~', enabled: true },
    { id: 'codeblock', label: '코드블럭', icon: '⋮', pre: '```\n', suf: '\n```', enabled: true }
  ];

  const DEFAULT_SETTINGS = {
    showToolbarButton: true,
    showOnSelection: true,
    keepInnerSelected: false
  };

  let tools = loadTools();
  let settings = loadSettings();

  let savedRange = null;
  let savedEditor = null;
  let savedText = '';
  let hideTimer = 0;
  let scanTimer = 0;
  let routeKey = location.href;

  function isChatRoomPage() {
    const path = location.pathname || '';
    return (
      /\/stories\/[^/]+\/episodes\/[^/]+/.test(path) ||
      /\/characters\/[^/]+\/chats\/[^/]+/.test(path) ||
      /\/u\/[^/]+\/c\/[^/]+/.test(path) ||
      /\/(?:episodes|chats?)\/[a-zA-Z0-9_-]{8,}/.test(path)
    );
  }

  function safeJsonParse(text, fallback) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return fallback;
    }
  }

  function loadTools() {
    const saved = safeJsonParse(localStorage.getItem(TOOLS_KEY), null);
    if (!Array.isArray(saved) || !saved.length) return cloneTools(DEFAULT_TOOLS);

    return saved
      .filter(item => item && typeof item === 'object')
      .map((item, index) => ({
        id: String(item.id || `custom-${index}-${Date.now()}`),
        label: String(item.label || '도구'),
        icon: String(item.icon || item.label || '?').slice(0, 8),
        pre: String(item.pre ?? ''),
        suf: String(item.suf ?? ''),
        enabled: item.enabled !== false
      }));
  }

  function saveTools() {
    localStorage.setItem(TOOLS_KEY, JSON.stringify(tools));
    renderSelectionBar();
  }

  function cloneTools(list) {
    return JSON.parse(JSON.stringify(list));
  }

  function loadSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, safeJsonParse(localStorage.getItem(SETTINGS_KEY), {}) || {});
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function escapedValue(value) {
    return String(value ?? '').replace(/\n/g, '\\n');
  }

  function unescapedValue(value) {
    return String(value ?? '').replace(/\\n/g, '\n');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getSelectionBar() {
    return document.getElementById(SELECTION_BAR_ID);
  }

  function getToast() {
    let toast = document.getElementById(TOAST_ID);

    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }

    return toast;
  }

  function toast(text) {
    const el = getToast();
    el.textContent = text;
    el.dataset.show = 'true';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      el.dataset.show = 'false';
    }, 1200);
  }

  function isOwnUiNode(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement);
    return !!el?.closest?.(`#${SELECTION_BAR_ID}, #${SETTINGS_ID}, #${TOAST_ID}, #${TOOLBAR_WRAPPER_ID}`);
  }

  function closestElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function closestEditableFromNode(node) {
    const el = closestElement(node);
    if (!el) return null;

    return el.closest?.('div.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror, textarea, input[type="text"]') || null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isAllowedEditor(editor) {
    if (!editor || !editor.isConnected || !isVisible(editor)) return false;
    if (isOwnUiNode(editor)) return false;

    if (editor.matches?.('textarea, input[type="text"]')) {
      return !!editor.closest?.('[data-ciw-allow="true"]');
    }

    if (!editor.matches?.('div.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror')) return false;
    if (editor.getAttribute('contenteditable') === 'false') return false;
    if (editor.closest?.('.wrtn-markdown, [data-ciw-block="true"]')) return false;

    // 메인 채팅 입력창: 사용자가 보내준 현재 구조 기준.
    if (editor.classList.contains('__chat_input_textarea')) return true;

    // 수정창(AI 메시지 편집): 크랙은 tiptap ProseMirror 에디터를 사용.
    // __chat_input_textarea가 없고 .wrtn-markdown(본문) 밖에 위치(위 가드에서 이미 제외됨).
    // 기존 광범위 셀렉터(.fixed/form/[data-state]/[role=dialog])는 오탐만 키워 tiptap 단독으로 좁힘.
    if (editor.classList.contains('tiptap')) {
      return true;
    }

    return false;
  }

  function getSelectedRangeInfo() {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const text = sel.toString();
    if (!text || !text.trim()) return null;

    const range = sel.getRangeAt(0);
    const editorA = closestEditableFromNode(range.commonAncestorContainer);
    const editorB = closestEditableFromNode(sel.anchorNode);
    const editorC = closestEditableFromNode(sel.focusNode);
    const editor = editorA || editorB || editorC;

    if (!editor || editorB !== editorC && editorB && editorC) return null;
    if (!isAllowedEditor(editor)) return null;

    return { sel, range, editor, text };
  }

  function saveCurrentSelection() {
    const info = getSelectedRangeInfo();

    if (!info) {
      savedRange = null;
      savedEditor = null;
      savedText = '';
      return null;
    }

    savedRange = info.range.cloneRange();
    savedEditor = info.editor;
    savedText = info.text;

    return info;
  }

  function restoreSelection() {
    if (!savedRange || !savedEditor || !savedEditor.isConnected) return false;

    try {
      savedEditor.focus?.();

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);

      return true;
    } catch (_) {
      return false;
    }
  }

  function dispatchEditorInput(editor) {
    if (!editor) return;

    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: ''
      }));
    } catch (_) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function insertPlainTextFallback(text) {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return false;

    const range = sel.getRangeAt(0);
    range.deleteContents();

    const node = document.createTextNode(text);
    range.insertNode(node);

    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);

    return true;
  }

  function wrapSelection(tool) {
    if (!tool) return;

    const selectedBefore = savedText;

    if (!selectedBefore || !restoreSelection()) {
      hideSelectionBar();
      return;
    }

    const editor = savedEditor;
    const wrapped = `${tool.pre}${selectedBefore}${tool.suf}`;

    let ok = false;

    try {
      ok = document.execCommand && document.execCommand('insertText', false, wrapped);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      try {
        ok = insertPlainTextFallback(wrapped);
      } catch (_) {
        ok = false;
      }
    }

    if (ok) {
      dispatchEditorInput(editor);

      if (settings.keepInnerSelected) {
        trySelectInnerText(editor, tool.pre.length, selectedBefore.length);
      }

      hideSelectionBar();
    } else {
      toast('감싸기 실패');
    }
  }

  function trySelectInnerText(editor, prefixLen, innerLen) {
    // execCommand 이후에는 커서가 삽입문 뒤로 가는 경우가 많습니다.
    // ProseMirror 내부 상태를 과하게 건드리지 않기 위해 기본값은 꺼둔 옵션입니다.
    if (!editor || !innerLen) return;

    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;

      const current = sel.getRangeAt(0);
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let target = null;

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue && node.nodeValue.includes(savedText)) {
          target = node;
          break;
        }
      }

      if (!target) return;

      const start = target.nodeValue.indexOf(savedText);
      if (start < 0) return;

      const range = document.createRange();
      range.setStart(target, start);
      range.setEnd(target, start + innerLen);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function positionSelectionBar(info) {
    const bar = getSelectionBar();
    if (!bar || !info?.range) return;

    const rect = getRangeRect(info.range);
    if (!rect) {
      hideSelectionBar();
      return;
    }

    // 키보드가 올라온 모바일에서 layout viewport는 키보드를 포함하므로,
    // 실제 보이는 영역인 visualViewport를 우선 사용한다.
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const offX = vv ? vv.offsetLeft : 0;
    const offY = vv ? vv.offsetTop : 0;

    bar.style.display = 'flex';
    bar.style.visibility = 'hidden';

    const bw = bar.offsetWidth || 220;
    const bh = bar.offsetHeight || 36;

    // rect는 viewport 좌표. 선택 영역 위쪽에 두되 공간 없으면 아래로.
    let left = rect.left + rect.width / 2 - bw / 2;
    let top = rect.top - bh - 8;
    if (top < offY + 8) top = rect.bottom + 8;

    // 보이는 영역(visualViewport) 안으로 clamp
    left = Math.max(offX + 8, Math.min(left, offX + vw - bw - 8));
    top = Math.max(offY + 8, Math.min(top, offY + vh - bh - 8));

    // absolute 기준이므로 document 좌표로 변환(스크롤 보정 유지)
    bar.style.left = `${left + window.scrollX}px`;
    bar.style.top = `${top + window.scrollY}px`;
    bar.style.visibility = 'visible';
  }

  function getRangeRect(range) {
    if (!range) return null;

    const rects = Array.from(range.getClientRects?.() || []).filter(r => r.width || r.height);
    if (rects.length) return rects[0];

    const rect = range.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return rect;

    return null;
  }

  function showSelectionBarForCurrentSelection() {
    if (!settings.showOnSelection || !isChatRoomPage()) {
      hideSelectionBar();
      return;
    }

    const info = saveCurrentSelection();

    if (!info) {
      hideSelectionBar();
      return;
    }

    renderSelectionBar();
    positionSelectionBar(info);
  }

  function hideSelectionBar(delay = 0) {
    clearTimeout(hideTimer);

    hideTimer = setTimeout(() => {
      const bar = getSelectionBar();
      if (bar) bar.style.display = 'none';
    }, delay);
  }

  /**
   * 선택 바 버튼의 실행 시점을 묶어준다.
   *
   * 바는 눌러도 에디터가 포커스를 잃지 않도록 pointerdown/mousedown의 기본동작을 막는데,
   * 터치에서 pointerdown(과 touchstart)의 기본동작을 막으면 브라우저가 그 터치에 대한
   * 호환 마우스 이벤트를 아예 만들지 않는다. mousedown·mouseup은 물론 click까지 사라지므로
   * click만 듣고 있으면 모바일에서 버튼이 영영 반응하지 않는다.
   *
   * 그래서 실제 동작은 마우스·터치·펜을 모두 포괄하는 pointerup에 건다.
   * 데스크톱에서는 pointerup 뒤에 click이 한 번 더 오므로 그 click은 삼켜서 중복 실행을 막고,
   * PointerEvent가 없는 구형 환경만 click으로 대체한다.
   */
  function bindActivate(el, handler) {
    if (!window.PointerEvent) {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        handler();
      });
      return;
    }

    el.addEventListener('pointerup', e => {
      // 마우스는 주 버튼만 받는다. 터치·펜은 button이 0으로 온다.
      if (e.button > 0) return;

      e.preventDefault();
      e.stopPropagation();
      handler();
    });

    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  function renderSelectionBar() {
    let bar = getSelectionBar();

    if (!bar) {
      bar = document.createElement('div');
      bar.id = SELECTION_BAR_ID;
      document.body.appendChild(bar);

      // 바를 눌러도 에디터 포커스/선택이 풀리지 않도록 기본동작을 막는다.
      // touchstart는 막지 않는다. 막으면 탭 자체가 사라지고, 스크롤·확대 억제는
      // CSS의 touch-action으로 처리한다. 실행은 bindActivate의 pointerup이 담당한다.
      bar.addEventListener('mousedown', e => e.preventDefault());
      bar.addEventListener('pointerdown', e => e.preventDefault());
    }

    const enabledTools = tools.filter(tool => tool.enabled !== false);

    bar.innerHTML = '';

    enabledTools.forEach((tool, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-sel-btn`;
      btn.title = tool.label;
      btn.dataset.toolId = tool.id || '';
      btn.textContent = tool.icon || tool.label || '?';
      bindActivate(btn, () => wrapSelection(tool));
      bar.appendChild(btn);
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = `${NS}-sel-btn ${NS}-sel-settings`;
    edit.title = '감싸기 도구 설정';
    edit.textContent = '⚙';
    bindActivate(edit, () => openSettingsModal());
    bar.appendChild(edit);
  }

  function findInputRoot() {
    const editor = document.querySelector('.__chat_input_textarea.ProseMirror[contenteditable="true"], div.__chat_input_textarea[contenteditable="true"]');
    if (!editor) return null;

    return (
      editor.closest('.flex.w-full.flex-col.rounded-lg') ||
      editor.closest('form') ||
      editor.parentElement?.parentElement ||
      editor.parentElement
    );
  }

  function findToolbarLeftContainer() {
    const root = findInputRoot();
    if (!root) return null;

    return (
      root.querySelector('.flex.items-center.space-x-2') ||
      root.querySelector('[class*="space-x-2"]') ||
      root.querySelector('.flex.items-center')
    );
  }

  function nativeButtonClass(container) {
    const btn = container?.querySelector?.('button');
    if (btn?.className && typeof btn.className === 'string') return btn.className;

    return 'relative inline-flex items-center gap-1 rounded-full text-sm font-medium leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 min-w-7 border border-border bg-card text-line-gray-1 hover:bg-secondary p-0 size-7 justify-center';
  }

  function ensureToolbarButton() {
    if (!settings.showToolbarButton || !isChatRoomPage()) {
      document.getElementById(TOOLBAR_WRAPPER_ID)?.remove();
      return;
    }

    const container = findToolbarLeftContainer();
    if (!container) return;

    let wrapper = document.getElementById(TOOLBAR_WRAPPER_ID);

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = TOOLBAR_WRAPPER_ID;
      wrapper.setAttribute('data-crack-native-toolbar-addon', 'input-wrapper');
      wrapper.style.display = 'flex';
    }

    let btn = wrapper.querySelector(`#${TOOLBAR_BUTTON_ID}`);

    if (!btn) {
      btn = document.createElement('button');
      btn.id = TOOLBAR_BUTTON_ID;
      btn.type = 'button';
      btn.title = '입력 감싸기 도구 설정';
      btn.setAttribute('aria-label', '입력 감싸기 도구 설정');
      btn.innerHTML = '<span class="ciw-toolbar-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7.5 7.5 4 12l3.5 4.5M16.5 7.5 20 12l-3.5 4.5M10 18l4-12"/></svg></span>';
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsModal();
      });
      wrapper.appendChild(btn);
    }

    btn.className = nativeButtonClass(container);
    btn.classList.add('ciw-native-toolbar-btn');

    if (wrapper.parentElement !== container) {
      container.insertBefore(wrapper, container.firstChild);
    }
  }

  function removeUiOutsideChat() {
    if (isChatRoomPage()) return false;

    document.getElementById(TOOLBAR_WRAPPER_ID)?.remove();
    hideSelectionBar();

    const modal = document.getElementById(SETTINGS_ID);
    if (modal) modal.remove();

    savedRange = null;
    savedEditor = null;
    savedText = '';

    return true;
  }

  function openSettingsModal() {
    let overlay = document.getElementById(SETTINGS_ID);
    if (overlay) return;

    const draft = cloneTools(tools);

    overlay = document.createElement('div');
    overlay.id = SETTINGS_ID;

    overlay.innerHTML = `
      <div class="ciw-modal">
        <div class="ciw-modal-head">
          <div class="ciw-modal-title">
            <strong>✍️ 입력 감싸기 도구</strong>
            <span>드래그한 텍스트를 기호로 감쌉니다</span>
          </div>
          <button type="button" class="ciw-close" data-ciw-action="close">✕</button>
        </div>

        <div class="ciw-options">
          <label class="ciw-chip"><input type="checkbox" id="ciw-opt-toolbar"> 채팅창 툴바 버튼</label>
          <label class="ciw-chip"><input type="checkbox" id="ciw-opt-selection"> 드래그 선택 팝업</label>
          <label class="ciw-chip"><input type="checkbox" id="ciw-opt-keep-selected"> 감싼 뒤 내부 텍스트 다시 선택</label>
        </div>

        <div class="ciw-tool-head">
          <span>도구 목록</span>
          <button type="button" class="ciw-small-btn" data-ciw-action="add">＋ 추가</button>
        </div>

        <div class="ciw-col-head">
          <span>표시</span><span>이름</span><span>아이콘</span><span>앞 기호</span><span>뒤 기호</span><span></span>
        </div>

        <div class="ciw-tool-list" id="ciw-tool-list"></div>

        <div class="ciw-modal-foot">
          <button type="button" class="ciw-text-btn" data-ciw-action="reset">기본값으로 되돌리기</button>
          <div class="ciw-foot-actions">
            <button type="button" class="ciw-sec-btn" data-ciw-action="close">취소</button>
            <button type="button" class="ciw-main-btn" data-ciw-action="save">저장</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const optToolbar = overlay.querySelector('#ciw-opt-toolbar');
    const optSelection = overlay.querySelector('#ciw-opt-selection');
    const optKeepSelected = overlay.querySelector('#ciw-opt-keep-selected');

    optToolbar.checked = settings.showToolbarButton !== false;
    optSelection.checked = settings.showOnSelection !== false;
    optKeepSelected.checked = settings.keepInnerSelected === true;

    function renderToolRows() {
      const list = overlay.querySelector('#ciw-tool-list');
      list.innerHTML = '';

      draft.forEach((tool, index) => {
        const row = document.createElement('div');
        row.className = 'ciw-tool-row';
        row.dataset.index = String(index);

        row.innerHTML = `
          <label class="ciw-enable" title="팝업에 표시">
            <input type="checkbox" class="ciw-enabled" ${tool.enabled !== false ? 'checked' : ''}>
          </label>
          <input class="ciw-label" type="text" value="${escapeHtml(tool.label)}" placeholder="이름">
          <input class="ciw-icon" type="text" value="${escapeHtml(tool.icon)}" placeholder="아이콘">
          <input class="ciw-pre" type="text" value="${escapeHtml(escapedValue(tool.pre))}" placeholder="앞">
          <input class="ciw-suf" type="text" value="${escapeHtml(escapedValue(tool.suf))}" placeholder="뒤">
          <div class="ciw-row-actions">
            <button type="button" data-row-action="up" title="위로">↑</button>
            <button type="button" data-row-action="down" title="아래로">↓</button>
            <button type="button" data-row-action="delete" title="삭제">×</button>
          </div>
        `;

        list.appendChild(row);
      });
    }

    function syncDraftFromInputs() {
      overlay.querySelectorAll('.ciw-tool-row').forEach(row => {
        const index = Number(row.dataset.index);
        const tool = draft[index];
        if (!tool) return;

        tool.enabled = row.querySelector('.ciw-enabled')?.checked !== false;
        tool.label = row.querySelector('.ciw-label')?.value || '도구';
        tool.icon = row.querySelector('.ciw-icon')?.value || tool.label.slice(0, 2);
        tool.pre = unescapedValue(row.querySelector('.ciw-pre')?.value || '');
        tool.suf = unescapedValue(row.querySelector('.ciw-suf')?.value || '');
      });
    }

    renderToolRows();

    overlay.addEventListener('click', e => {
      const action = e.target?.closest?.('[data-ciw-action]')?.dataset?.ciwAction;
      const rowAction = e.target?.closest?.('[data-row-action]')?.dataset?.rowAction;

      if (rowAction) {
        e.preventDefault();
        const row = e.target.closest('.ciw-tool-row');
        const index = Number(row?.dataset.index);
        if (!Number.isFinite(index)) return;

        syncDraftFromInputs();

        if (rowAction === 'up' && index > 0) {
          [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]];
          renderToolRows();
        } else if (rowAction === 'down' && index < draft.length - 1) {
          [draft[index + 1], draft[index]] = [draft[index], draft[index + 1]];
          renderToolRows();
        } else if (rowAction === 'delete') {
          draft.splice(index, 1);
          renderToolRows();
        }
        return;
      }

      if (!action) return;

      e.preventDefault();

      if (action === 'close') {
        overlay.remove();
        return;
      }

      if (action === 'add') {
        syncDraftFromInputs();
        draft.push({
          id: `custom-${Date.now()}`,
          label: '새 도구',
          icon: '＋',
          pre: '',
          suf: '',
          enabled: true
        });
        renderToolRows();
        return;
      }

      if (action === 'reset') {
        draft.splice(0, draft.length, ...cloneTools(DEFAULT_TOOLS));
        renderToolRows();
        return;
      }

      if (action === 'save') {
        syncDraftFromInputs();

        tools = draft
          .filter(tool => tool.pre || tool.suf || tool.label || tool.icon)
          .map((tool, index) => ({
            id: tool.id || `tool-${index}-${Date.now()}`,
            label: String(tool.label || '도구'),
            icon: String(tool.icon || tool.label || '?').slice(0, 8),
            pre: String(tool.pre ?? ''),
            suf: String(tool.suf ?? ''),
            enabled: tool.enabled !== false
          }));

        settings.showToolbarButton = optToolbar.checked;
        settings.showOnSelection = optSelection.checked;
        settings.keepInnerSelected = optKeepSelected.checked;

        saveTools();
        saveSettings();
        ensureToolbarButton();
        overlay.remove();
        toast('저장했어');
      }
    });

    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function handleSelectionEvent() {
    clearTimeout(handleSelectionEvent._timer);
    handleSelectionEvent._timer = setTimeout(showSelectionBarForCurrentSelection, 80);
  }

  function handleRouteChange() {
    if (routeKey === location.href) return;

    routeKey = location.href;
    savedRange = null;
    savedEditor = null;
    savedText = '';

    hideSelectionBar();
    setTimeout(ensureToolbarButton, 250);
    setTimeout(ensureToolbarButton, 900);
  }

  function installEventListeners() {
    document.addEventListener('selectionchange', () => {
      if (isOwnUiNode(document.activeElement)) return;
      handleSelectionEvent();
    }, true);

    document.addEventListener('mouseup', handleSelectionEvent, true);
    document.addEventListener('keyup', event => {
      if (event.key === 'Escape') {
        hideSelectionBar();
        return;
      }
      handleSelectionEvent();
    }, true);
    document.addEventListener('touchend', () => {
      setTimeout(handleSelectionEvent, 80);
    }, true);

    document.addEventListener('mousedown', event => {
      const bar = getSelectionBar();
      if (!bar || bar.style.display === 'none') return;

      // bar 자체(버튼/설정) 클릭은 유지 — savedRange 복원으로 감싸기 동작.
      if (isOwnUiNode(event.target)) return;

      // 그 외 어디든(에디터 내부 재클릭 포함) 누르면 기존 선택을 즉시 해제.
      // 선택을 안 지우면 80ms 뒤 handleSelectionEvent가 bar를 되살려 '깜빡임 + 미해제'가 생김.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();

      bar.style.display = 'none';
    }, true);

    document.addEventListener('keydown', event => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      const editor = closestEditableFromNode(document.activeElement);
      if (!isAllowedEditor(editor)) return;

      const idx = shortcutIndexFromEvent(event);
      if (idx < 0) return;

      const enabled = tools.filter(tool => tool.enabled !== false);
      const tool = enabled[idx];
      if (!tool) return;

      const info = saveCurrentSelection();
      if (!info) return;

      event.preventDefault();
      event.stopPropagation();
      wrapSelection(tool);
    }, true);
  }

  function shortcutIndexFromEvent(event) {
    const key = event.key;
    const code = event.code;

    if (code === 'Backquote' || key === '`' || key === '~') return 0;
    if (/^Digit\d$/.test(code)) {
      const n = Number(code.replace('Digit', ''));
      return n === 0 ? 10 : n;
    }
    if (/^\d$/.test(key)) {
      const n = Number(key);
      return n === 0 ? 10 : n;
    }

    return -1;
  }

  function installObserver() {
    const observer = new MutationObserver(mutations => {
      let shouldScan = false;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;

        for (const node of mutation.addedNodes || []) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const el = node;
          if (
            el.matches?.('.__chat_input_textarea, div.ProseMirror[contenteditable="true"]') ||
            el.querySelector?.('.__chat_input_textarea, div.ProseMirror[contenteditable="true"], .flex.items-center.space-x-2')
          ) {
            shouldScan = true;
            break;
          }
        }

        if (shouldScan) break;
      }

      handleRouteChange();

      if (shouldScan) {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
          removeUiOutsideChat();
          ensureToolbarButton();
        }, 120);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    setInterval(() => {
      handleRouteChange();
      if (!removeUiOutsideChat()) ensureToolbarButton();
    }, 1500);
  }

  function injectStyles() {
    const css = `
      #${SELECTION_BAR_ID} {
        position: absolute;
        display: none;
        align-items: center;
        gap: 4px;
        padding: 5px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(34,34,38,.92), rgba(20,20,23,.90));
        color: #fff;
        box-shadow: 0 10px 28px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.08);
        z-index: 2147483643 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(14px) saturate(1.15);
        -webkit-backdrop-filter: blur(14px) saturate(1.15);
        /* 더블탭 확대로 인한 탭 지연을 없앤다. 가로 스크롤(모바일 media query)은 살려둔다. */
        touch-action: manipulation;
        /* 바 자체를 길게 눌러 텍스트가 선택되거나 OS 콜아웃이 뜨는 것을 막는다. */
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }

      .${NS}-sel-btn {
        min-width: 30px;
        height: 30px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: transparent;
        color: rgba(255,255,255,.92);
        font: 800 13px/1 ui-serif, "Times New Roman", "Noto Serif KR", serif;
        letter-spacing: -.03em;
        cursor: pointer;
        white-space: nowrap;
        transition: background .12s ease, border-color .12s ease, transform .12s ease, color .12s ease;
      }

      .${NS}-sel-btn[data-tool-id="bold"],
      .${NS}-sel-btn[data-tool-id="strike"],
      .${NS}-sel-btn[data-tool-id="codeblock"] {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        letter-spacing: -.05em;
      }

      .${NS}-sel-btn[data-tool-id="paren"] {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 800;
      }

      .${NS}-sel-btn:hover {
        background: rgba(255,255,255,.10);
        border-color: rgba(255,255,255,.10);
        color: #fff;
      }

      .${NS}-sel-btn:active {
        transform: scale(.94);
      }

      .${NS}-sel-settings {
        min-width: 30px;
        margin-left: 2px;
        color: rgba(255,255,255,.62);
        border-left: 1px solid rgba(255,255,255,.12);
        border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
      }

      #${TOOLBAR_WRAPPER_ID} {
        display: flex;
        align-items: center;
      }

      #${TOOLBAR_BUTTON_ID} .ciw-toolbar-icon {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }

      #${TOOLBAR_BUTTON_ID} .ciw-toolbar-icon svg {
        width: 16px;
        height: 16px;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.35;
        stroke-linecap: round;
        stroke-linejoin: round;
      }



      #${SETTINGS_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647 !important;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.48);
        backdrop-filter: blur(2px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif;
      }

      .ciw-modal {
        width: min(680px, calc(100vw - 28px));
        max-height: min(760px, calc(100vh - 28px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 18px;
        background: #1c1c21;
        color: #f2f2f5;
        box-shadow: 0 24px 64px rgba(0,0,0,.5);
      }

      .ciw-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px 14px;
      }

      .ciw-modal-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
      }

      .ciw-modal-title strong { font-size: 15px; letter-spacing: -.01em; }

      .ciw-modal-title span {
        font-size: 11.5px;
        color: rgba(255,255,255,.42);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ciw-close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 8px;
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.64);
        font-size: 15px;
        cursor: pointer;
        transition: background .12s, color .12s;
      }

      .ciw-close:hover { background: rgba(255,255,255,.12); color: #fff; }

      .ciw-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 18px 16px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      .ciw-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 7px 12px 7px 9px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 999px;
        background: rgba(255,255,255,.03);
        font-size: 12px;
        color: rgba(255,255,255,.64);
        cursor: pointer;
        user-select: none;
        transition: all .14s;
      }

      .ciw-chip input[type="checkbox"] {
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        width: 15px;
        height: 15px;
        border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,.28);
        background: transparent;
        cursor: pointer;
        transition: all .14s;
        flex: none;
      }

      .ciw-chip input[type="checkbox"]:checked {
        border-color: #ffa600;
        background: #ffa600 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 13l4 4 10-10' fill='none' stroke='%23111' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/9px no-repeat;
      }

      .ciw-chip:has(input:checked) {
        border-color: rgba(255,166,0,.5);
        background: rgba(255,166,0,.14);
        color: #f2f2f5;
      }

      .ciw-tool-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px 0;
        font-size: 13px;
        font-weight: 700;
      }

      .ciw-small-btn {
        border: 1px dashed rgba(255,166,0,.45);
        border-radius: 8px;
        background: transparent;
        color: #ffa600;
        padding: 6px 11px;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        transition: background .12s;
      }

      .ciw-small-btn:hover { background: rgba(255,166,0,.14); }

      .ciw-col-head {
        display: grid;
        grid-template-columns: 28px minmax(90px, .9fr) 56px minmax(78px, 1fr) minmax(78px, 1fr) 76px;
        gap: 8px;
        padding: 12px 26px 6px;
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: .06em;
        color: rgba(255,255,255,.42);
        text-transform: uppercase;
      }

      .ciw-tool-list {
        flex: 1;
        overflow: auto;
        padding: 0 18px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ciw-tool-row {
        display: grid;
        grid-template-columns: 28px minmax(90px, .9fr) 56px minmax(78px, 1fr) minmax(78px, 1fr) 76px;
        gap: 8px;
        align-items: center;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: rgba(255,255,255,.028);
        transition: background .12s, border-color .12s, opacity .12s;
      }

      .ciw-tool-row:hover {
        background: rgba(255,255,255,.05);
        border-color: rgba(255,255,255,.08);
      }

      .ciw-tool-row:has(.ciw-enabled:not(:checked)) { opacity: .45; }

      .ciw-enable {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ciw-enabled {
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        width: 17px;
        height: 17px;
        border-radius: 5px;
        border: 1.5px solid rgba(255,255,255,.25);
        background: transparent;
        cursor: pointer;
        transition: all .13s;
      }

      .ciw-enabled:checked {
        border-color: #ffa600;
        background: #ffa600 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 13l4 4 10-10' fill='none' stroke='%23111' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/10px no-repeat;
      }

      .ciw-tool-row input[type="text"] {
        min-width: 0;
        height: 30px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: rgba(0,0,0,.22);
        color: #fff;
        padding: 0 9px;
        font-size: 12.5px;
        outline: none;
        transition: border-color .12s, background .12s;
      }

      .ciw-tool-row input[type="text"]:hover { border-color: rgba(255,255,255,.08); }

      .ciw-tool-row input[type="text"]:focus {
        border-color: rgba(255,166,0,.65);
        background: rgba(0,0,0,.32);
      }

      .ciw-tool-row .ciw-icon { text-align: center; }

      .ciw-tool-row .ciw-pre,
      .ciw-tool-row .ciw-suf {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: #ffd28a;
      }

      .ciw-row-actions {
        display: flex;
        gap: 3px;
        justify-content: flex-end;
      }

      .ciw-row-actions button {
        width: 23px;
        height: 25px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: rgba(255,255,255,.42);
        font-size: 12px;
        cursor: pointer;
        transition: background .12s, color .12s;
      }

      .ciw-row-actions button:hover {
        background: rgba(255,255,255,.1);
        color: #fff;
      }

      .ciw-row-actions [data-row-action="delete"]:hover {
        background: rgba(255,105,97,.16);
        color: #ff6961;
      }

      .ciw-modal-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 13px 18px;
        border-top: 1px solid rgba(255,255,255,.08);
        background: rgba(0,0,0,.14);
      }

      .ciw-foot-actions { display: flex; gap: 8px; }

      .ciw-text-btn {
        border: 0;
        background: transparent;
        color: rgba(255,255,255,.42);
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 8px 4px;
        cursor: pointer;
        transition: color .12s;
      }

      .ciw-text-btn:hover { color: #ff6961; }

      .ciw-sec-btn {
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 9px;
        background: transparent;
        color: rgba(255,255,255,.64);
        padding: 9px 15px;
        font: 700 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        transition: all .12s;
      }

      .ciw-sec-btn:hover { background: rgba(255,255,255,.06); color: #fff; }

      .ciw-main-btn {
        border: 0;
        border-radius: 9px;
        background: #ffa600;
        color: #16130a;
        padding: 9px 18px;
        font: 800 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(255,166,0,.25);
        transition: filter .12s, transform .1s;
      }

      .ciw-main-btn:hover { filter: brightness(1.08); }
      .ciw-main-btn:active { transform: scale(.97); }

      #${TOAST_ID} {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%) translateY(8px);
        z-index: 2147483647 !important;
        opacity: 0;
        pointer-events: none;
        transition: .16s ease;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(20,20,22,.94);
        color: #fff;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,.3);
      }

      #${TOAST_ID}[data-show="true"] {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      @media (max-width: 640px) {
        .ciw-modal {
          width: calc(100vw - 16px);
          max-height: calc(100vh - 16px);
        }

        .ciw-col-head { display: none; }

        .ciw-tool-row {
          grid-template-columns: 24px 1fr 50px;
          row-gap: 6px;
        }

        .ciw-tool-row .ciw-pre,
        .ciw-tool-row .ciw-suf { grid-column: span 1; }

        .ciw-row-actions {
          grid-column: 1 / -1;
          justify-content: flex-end;
        }

        #${SELECTION_BAR_ID} {
          max-width: calc(100vw - 16px);
          overflow-x: auto;
        }
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
  }

  function init() {
    injectStyles();
    renderSelectionBar();
    installEventListeners();
    installObserver();

    setTimeout(ensureToolbarButton, 250);
    setTimeout(ensureToolbarButton, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
