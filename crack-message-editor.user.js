// ==UserScript==
// @name         ✏️ 크랙 출력물 일괄 편집
// @namespace    https://crack.wrtn.ai/
// @version      0.5.1
// @description  채팅방의 AI 출력물과 내 메시지를 섹션별로 훑어보고, 원문과 나란히 비교하며 수정·찾기바꾸기·JSON 일괄적용으로 고친 뒤 저장한다. 기본값은 읽기 전용이며 저장 직전 원본을 자동 백업한다.
// @author       Gia
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============== 확정된 API 스펙 ==============
    // 목록: GET   {API_BASE}/{chatId}/messages?limit=N[&cursor=...]
    //       -> { data: { messages: [...], nextCursor: "base64" } }
    // 수정: PATCH {API_BASE}/{chatId}/messages/{_id}   body { message: "본문 전체" }
    //       ※ 부분 수정이 아니라 전체 치환. 식별자는 id/messageId가 아니라 _id.
    var API_BASE = 'https://crack-api.wrtn.ai/crack-gen/v3/chats';
    var PAGE_SIZE = 50;
    var MAX_PAGES = 400;          // 폭주 방지 (최대 2만 개)
    var SAVE_GAP_MS = 150;        // 연속 PATCH 사이 간격 (레이트 리밋 회피)
    var SAVE_ABORT_AFTER = 3;     // 연속 실패 이 횟수면 중단
    var RENDER_CHUNK = 200;       // 한 번에 그릴 행 수

    // 섹션 구분 — 화면 전환·JSON 내보내기 범위에 함께 쓴다.
    var SCOPE_LABEL = { bot: 'AI 출력물', user: '내 메시지', all: '전체' };
    var SCOPE_SLUG = { bot: 'ai', user: 'user', all: 'all' };

    var BTN_CLASS = 'crack-msg-ed-btn';
    var OVERLAY_CLASS = 'crack-msg-ed-overlay';
    var CONTROL_SELECTOR = 'button,a,[role="button"]';

    // ============== 공통 유틸 ==============
    function getChatId() {
        var m = location.pathname.match(/\/episodes\/([a-f0-9]{24})/i);
        return m ? m[1] : null;
    }

    function getToken() {
        var m = document.cookie.match(/(^| )access_token=([^;]+)/);
        return m ? m[2] : null;
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }

    function preview(text, len) {
        var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        return t.length > len ? t.slice(0, len) + '…' : t;
    }

    function shortId(id) {
        var s = String(id || '');
        return s ? s.slice(-6) : '-';
    }

    function nf(n) { return Number(n || 0).toLocaleString('ko-KR'); }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function stamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    }

    // ============== API ==============
    function authHeaders() {
        return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
    }

    function apiGet(path) {
        var token = getToken(), chatId = getChatId();
        if (!token || !chatId) return Promise.reject(new Error('인증 정보 또는 채팅 ID를 찾을 수 없습니다.'));
        return fetch(API_BASE + '/' + chatId + path, { headers: authHeaders() }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    // 본문 전체를 통째로 교체한다. 성공하면 true.
    async function patchMessage(messageId, content) {
        var token = getToken(), chatId = getChatId();
        if (!token || !chatId) throw new Error('인증 정보 없음');
        var res = await fetch(API_BASE + '/' + chatId + '/messages/' + encodeURIComponent(messageId), {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ message: content })
        });
        if (!res.ok) {
            var body = '';
            try { body = (await res.text() || '').slice(0, 200); } catch (e) {}
            throw new Error('HTTP ' + res.status + (body ? ' · ' + body : ''));
        }
        return true;
    }

    // 읽기 검증을 위해 페이지별 통계와 중복 _id를 함께 수집한다.
    async function fetchAllMessages(onProgress) {
        var all = [];
        var cursor = null;
        var seen = Object.create(null);
        var stats = { pageCounts: [], duplicates: [], startedAt: Date.now(), hitPageCap: false, endedByCursor: false };
        for (var page = 0; page < MAX_PAGES; page++) {
            var path = '/messages?limit=' + PAGE_SIZE + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
            var res = await apiGet(path);
            var data = res && res.data;
            var list = (data && data.messages) || [];
            stats.pageCounts.push(list.length);
            if (!list.length) { stats.endedByCursor = true; break; }
            for (var i = 0; i < list.length; i++) {
                var id = list[i]._id;
                if (seen[id]) stats.duplicates.push(id);
                else seen[id] = 1;
            }
            all = all.concat(list);
            if (onProgress) onProgress(all.length, page + 1);
            if (!data.nextCursor) { stats.endedByCursor = true; break; }
            cursor = data.nextCursor;
            if (page === MAX_PAGES - 1) stats.hitPageCap = true;
        }
        stats.elapsedMs = Date.now() - stats.startedAt;
        all.reverse(); // API는 최신순 → 화면은 오래된 것부터
        return { messages: all, stats: stats };
    }

    function downloadJson(obj, filename) {
        var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ============== 헤더 앵커 (검증된 3단 탐색) ==============
    var HEADER_ANCHOR_SELECTORS = [
        '.absolute.z-\\[5\\] .flex.gap-3.items-center',
        '.group\\/header .flex.gap-3.items-center'
    ];
    var HEADER_BAND_TOP = -8;
    var HEADER_BAND_BOTTOM = 124;

    function isVisibleEl(el) {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function firstVisibleChild(el) {
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) if (isVisibleEl(kids[i])) return kids[i];
        return null;
    }

    function findAnchorBySelector() {
        for (var i = 0; i < HEADER_ANCHOR_SELECTORS.length; i++) {
            try {
                var found = document.querySelectorAll(HEADER_ANCHOR_SELECTORS[i]);
                for (var j = 0; j < found.length; j++) {
                    if (isVisibleEl(found[j])) return { host: found[j], before: firstVisibleChild(found[j]) };
                }
            } catch (e) {}
        }
        return null;
    }

    function findAnchorByStructure() {
        var bars;
        try { bars = document.querySelectorAll('[class*="z-[5]"][class*="justify-between"]'); }
        catch (e) { return null; }
        for (var i = 0; i < bars.length; i++) {
            if (!isVisibleEl(bars[i])) continue;
            var br = bars[i].getBoundingClientRect();
            if (br.top > 140 || br.height > 96) continue;
            var kids = bars[i].children;
            for (var k = kids.length - 1; k >= 0; k--) {
                if (!isVisibleEl(kids[k])) continue;
                if (!kids[k].querySelector(CONTROL_SELECTOR)) continue;
                return { host: kids[k], before: firstVisibleChild(kids[k]) };
            }
        }
        return null;
    }

    function findAnchorByGeometry() {
        var vw = window.innerWidth;
        var controls = [];
        var all = document.querySelectorAll(CONTROL_SELECTOR);
        for (var i = 0; i < all.length; i++) {
            if (all[i].classList.contains(BTN_CLASS)) continue;
            if (!isVisibleEl(all[i])) continue;
            var r = all[i].getBoundingClientRect();
            if (r.top < HEADER_BAND_TOP || r.bottom > HEADER_BAND_BOTTOM || r.right < vw * 0.5) continue;
            controls.push(all[i]);
        }
        controls.sort(function (a, b) {
            var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return (ra.top - rb.top) || (rb.right - ra.right);
        });
        var maxWidth = vw * 0.9;
        for (var c = 0; c < controls.length; c++) {
            var node = controls[c].parentElement;
            while (node && node !== document.body) {
                var nr = node.getBoundingClientRect();
                if (nr.top >= HEADER_BAND_TOP - 12 && nr.bottom <= HEADER_BAND_BOTTOM + 8 &&
                    nr.height >= 24 && nr.height <= 80 &&
                    nr.width > 28 && nr.width < maxWidth && nr.right >= vw * 0.5) {
                    return { host: node, before: firstVisibleChild(node) };
                }
                node = node.parentElement;
            }
        }
        return null;
    }

    function findHeaderAnchor() {
        return findAnchorBySelector() || findAnchorByStructure() || findAnchorByGeometry();
    }

    // ============================================================
    //  색 테마 — UI 색은 전부 여기서 나옵니다. 이 두 덩어리만 고치면 됩니다.
    //  아래 THEME_PRESETS에 파스텔 분홍 등 완성된 조합을 넣어뒀으니
    //  THEME 줄에서 원하는 이름으로 바꾸기만 하면 됩니다.
    // ============================================================
    var THEME_PRESETS = {
        // 기본값 — 크랙 화면과 어울리는 따뜻한 베이지/황토
        beige: {
            light: {
                bg: '#fffbf4', fg: '#362e25', muted: '#7a6c5b', line: '#d8cab7', line2: '#e8ddce',
                head: '#f8f0e4', panel: '#f3ede2', btn: '#fbf5ea', btnHover: '#f2e8d9',
                accent: '#b67822', accent2: '#8f5b18', accentFg: '#1b150a', danger: '#b95146',
                changedBg: 'rgba(182,120,34,.10)', invalidBg: 'rgba(185,81,70,.10)',
                mark: 'rgba(182,120,34,.32)', headerBtn: '#514e49'
            },
            dark: {
                bg: '#1d1a15', fg: '#ede5d6', muted: '#a79b85', line: '#3b342a', line2: '#2e2921',
                head: '#211d17', panel: '#14120f', btn: '#262119', btnHover: '#2c2720',
                accent: '#e2a84b', accent2: '#b87f2c', accentFg: '#14120f', danger: '#d97b6c',
                changedBg: 'rgba(226,168,75,.12)', invalidBg: 'rgba(217,123,108,.14)',
                mark: 'rgba(226,168,75,.34)', headerBtn: '#c9bba5'
            }
        },
        // 파스텔 분홍
        pink: {
            light: {
                bg: '#fff8fb', fg: '#4a3540', muted: '#9d8090', line: '#f2ccdb', line2: '#f9e4ec',
                head: '#fdeff5', panel: '#fbf2f6', btn: '#fdf5f9', btnHover: '#f9e7f0',
                accent: '#eda3c0', accent2: '#cf7396', accentFg: '#41202e', danger: '#cf5570',
                changedBg: 'rgba(237,163,192,.18)', invalidBg: 'rgba(207,85,112,.12)',
                mark: 'rgba(237,163,192,.45)', headerBtn: '#6d5460'
            },
            dark: {
                bg: '#1e161b', fg: '#f3e2ea', muted: '#b294a3', line: '#3d2f37', line2: '#2f242b',
                head: '#241a20', panel: '#150f13', btn: '#291e25', btnHover: '#31242c',
                accent: '#f0a9c5', accent2: '#c9789a', accentFg: '#1a1014', danger: '#e0808f',
                changedBg: 'rgba(240,169,197,.14)', invalidBg: 'rgba(224,128,143,.15)',
                mark: 'rgba(240,169,197,.34)', headerBtn: '#c9aab8'
            }
        },
        // 파스텔 연보라
        lilac: {
            light: {
                bg: '#fbf9ff', fg: '#3c3550', muted: '#877ea3', line: '#d6cdf0', line2: '#e8e2f8',
                head: '#f3effd', panel: '#f4f1fb', btn: '#f8f5fe', btnHover: '#ece6fa',
                accent: '#a99ae8', accent2: '#7c6bc4', accentFg: '#1e1836', danger: '#c2607f',
                changedBg: 'rgba(169,154,232,.16)', invalidBg: 'rgba(194,96,127,.12)',
                mark: 'rgba(169,154,232,.42)', headerBtn: '#5b5470'
            },
            dark: {
                bg: '#191722', fg: '#e7e2f5', muted: '#9e96b8', line: '#332e44', line2: '#282437',
                head: '#1e1b2a', panel: '#111019', btn: '#232031', btnHover: '#2a2639',
                accent: '#b5a7f0', accent2: '#8a78d4', accentFg: '#14111f', danger: '#dd8199',
                changedBg: 'rgba(181,167,240,.13)', invalidBg: 'rgba(221,129,153,.14)',
                mark: 'rgba(181,167,240,.32)', headerBtn: '#b3aacb'
            }
        },
        // 파스텔 민트
        mint: {
            light: {
                bg: '#f8fdfb', fg: '#2f4740', muted: '#6f9187', line: '#c6e6da', line2: '#dcf1e9',
                head: '#eef9f5', panel: '#f0f8f5', btn: '#f6fcfa', btnHover: '#e6f5ef',
                accent: '#79c9ac', accent2: '#4e9d81', accentFg: '#122720', danger: '#c46a5e',
                changedBg: 'rgba(121,201,172,.18)', invalidBg: 'rgba(196,106,94,.12)',
                mark: 'rgba(121,201,172,.45)', headerBtn: '#4d6b61'
            },
            dark: {
                bg: '#151d1a', fg: '#dcefe8', muted: '#8aa89f', line: '#2c3b36', line2: '#232f2b',
                head: '#19221f', panel: '#0f1614', btn: '#1e2926', btnHover: '#25322e',
                accent: '#8fd9bc', accent2: '#5aab8e', accentFg: '#0f1a16', danger: '#dd8a7c',
                changedBg: 'rgba(143,217,188,.13)', invalidBg: 'rgba(221,138,124,.14)',
                mark: 'rgba(143,217,188,.32)', headerBtn: '#a5c2b8'
            }
        }
    };

    // ★ 여기만 바꾸면 색이 통째로 바뀝니다: 'beige' | 'pink' | 'lilac' | 'mint'
    var THEME = THEME_PRESETS.beige;

    var THEME_KEYS = ['bg', 'fg', 'muted', 'line', 'line2', 'head', 'panel', 'btn', 'btnHover',
                      'accent', 'accent2', 'accentFg', 'danger', 'changedBg', 'invalidBg', 'mark', 'headerBtn'];

    function themeVars(t) {
        var out = [];
        for (var i = 0; i < THEME_KEYS.length; i++) {
            var k = THEME_KEYS[i];
            out.push('--cme-' + k + ':' + t[k]);
        }
        return out.join(';');
    }

    // ============== 스타일 ==============
    function injectStyles() {
        if (document.getElementById('crack-msg-ed-css')) return;
        var s = document.createElement('style');
        s.id = 'crack-msg-ed-css';
        var scope = '.' + OVERLAY_CLASS + ',.' + BTN_CLASS;
        s.textContent = [
            // ---- 색 변수 (위 THEME에서 옴) ----
            scope + '{' + themeVars(THEME.light) + '}',
            '@media (prefers-color-scheme: dark){' + scope + '{' + themeVars(THEME.dark) + '}}',

            // ---- 크랙 헤더에 꽂히는 버튼 ----
            '.' + BTN_CLASS + '{display:inline-flex;align-items:center;justify-content:center;gap:5px;',
            'padding:0 8px;height:29px;border-radius:7px;background:transparent;color:var(--cme-headerBtn);',
            'font-weight:680;font-size:11.5px;border:1px solid transparent;cursor:pointer;white-space:nowrap}',
            '.' + BTN_CLASS + ':hover{background:var(--cme-changedBg);border-color:var(--cme-line)}',

            // ---- 모달 뼈대 ----
            '.' + OVERLAY_CLASS + '{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);',
            'display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}',
            '.cme-modal{width:1200px;max-width:96vw;height:90vh;background:var(--cme-bg);color:var(--cme-fg);',
            'border:1px solid var(--cme-line);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;',
            'box-shadow:0 24px 70px rgba(0,0,0,.3);font-size:13px;box-sizing:border-box}',
            '.cme-modal *{box-sizing:border-box}',
            '.cme-head{display:flex;align-items:center;gap:10px;padding:13px 18px;',
            'border-bottom:1px solid var(--cme-line2);background:var(--cme-head);flex:0 0 auto;flex-wrap:wrap}',
            '.cme-head h3{margin:0;font-size:15px;font-weight:700;flex:0 0 auto}',
            '.cme-stat{font-size:11.5px;color:var(--cme-muted);font-variant-numeric:tabular-nums}',
            '.cme-spacer{flex:1 1 auto}',

            // ---- 버튼 ----
            '.cme-b{padding:6px 12px;border-radius:8px;border:1px solid var(--cme-line);background:var(--cme-btn);',
            'color:var(--cme-fg);font-size:12px;font-weight:650;cursor:pointer}',
            '.cme-b:hover:not(:disabled){background:var(--cme-btnHover)}',
            '.cme-b:disabled{opacity:.45;cursor:not-allowed}',
            '.cme-b.primary{background:linear-gradient(160deg,var(--cme-accent),var(--cme-accent2));',
            'color:var(--cme-accentFg);border-color:transparent}',
            '.cme-b.danger{background:transparent;color:var(--cme-danger);border-color:var(--cme-danger)}',
            '.cme-b.danger:hover:not(:disabled){background:var(--cme-invalidBg)}',

            // ---- 도구 바 ----
            '.cme-tools{display:flex;gap:8px;align-items:center;padding:9px 18px;',
            'border-bottom:1px solid var(--cme-line2);background:var(--cme-head);flex:0 0 auto;flex-wrap:wrap}',
            '.cme-tools input[type=text]{padding:7px 10px;border:1px solid var(--cme-line);border-radius:8px;',
            'background:var(--cme-panel);color:var(--cme-fg);font-size:12px;font-family:inherit}',
            '.cme-tools label{display:inline-flex;align-items:center;gap:5px;font-size:12px;',
            'color:var(--cme-muted);white-space:nowrap}',
            '.cme-search{flex:1 1 200px;min-width:140px}',
            '.cme-find{flex:1 1 150px;min-width:110px}',
            '.cme-seg{display:inline-flex;gap:2px;padding:2px;border-radius:9px;',
            'background:var(--cme-panel);border:1px solid var(--cme-line);flex:0 0 auto}',
            '.cme-segb{padding:5px 11px;border-radius:7px;border:0;background:transparent;',
            'color:var(--cme-muted);font-size:12px;font-weight:650;cursor:pointer;',
            'font-family:inherit;white-space:nowrap}',
            '.cme-segb:hover{color:var(--cme-fg)}',
            '.cme-segb.active{background:var(--cme-bg);color:var(--cme-fg);box-shadow:0 1px 3px rgba(0,0,0,.14)}',
            '.cme-segb b{margin-left:5px;font-weight:650;opacity:.55;font-variant-numeric:tabular-nums}',

            // ---- 목록 ----
            '.cme-list{flex:1 1 auto;overflow-y:auto;padding:8px 18px 18px}',
            '.cme-row{border-bottom:1px solid var(--cme-line2);padding:8px 6px}',
            '.cme-row.changed{background:var(--cme-changedBg);border-left:3px solid var(--cme-accent);padding-left:9px}',
            '.cme-row.invalid{background:var(--cme-invalidBg);border-left:3px solid var(--cme-danger);padding-left:9px}',
            '.cme-line{display:grid;grid-template-columns:46px 60px 1fr 108px;gap:10px;align-items:start;cursor:pointer}',
            '.cme-idx{color:var(--cme-muted);font-size:11px;font-variant-numeric:tabular-nums;padding-top:2px}',
            '.cme-role{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;text-align:center;display:block}',
            '.cme-role.user{background:var(--cme-panel);color:var(--cme-muted);border:1px solid var(--cme-line2)}',
            '.cme-role.bot{background:var(--cme-changedBg);color:var(--cme-accent2)}',
            '.cme-text{line-height:1.6;word-break:break-word;color:var(--cme-fg);opacity:.88}',
            '.cme-meta{font-size:10px;color:var(--cme-muted);margin-top:3px;font-variant-numeric:tabular-nums}',
            '.cme-right{font-size:11px;color:var(--cme-muted);text-align:right;',
            'font-variant-numeric:tabular-nums;padding-top:2px}',
            '.cme-tag{display:inline-block;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px}',
            '.cme-tag.mod{background:var(--cme-changedBg);color:var(--cme-accent2)}',
            '.cme-tag.err{background:var(--cme-invalidBg);color:var(--cme-danger)}',

            // ---- 원문 | 편집 2단 ----
            '.cme-edit{margin-top:8px;padding:10px;border:1px solid var(--cme-line2);',
            'border-radius:10px;background:var(--cme-btn)}',
            '.cme-panes{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch}',
            '@media (max-width:980px){.cme-panes{grid-template-columns:1fr}}',
            '.cme-pane{display:flex;flex-direction:column;min-width:0}',
            '.cme-pane-h{display:flex;gap:6px;align-items:baseline;margin-bottom:4px;',
            'font-size:10.5px;font-weight:700;color:var(--cme-muted);letter-spacing:.02em}',
            '.cme-edit textarea,.cme-orig{width:100%;height:300px;padding:10px;',
            'border:1px solid var(--cme-line);border-radius:8px;background:var(--cme-panel);',
            'color:var(--cme-fg);font-size:12.5px;line-height:1.75;',
            'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            'white-space:pre-wrap;word-break:break-word;overflow:auto;margin:0}',
            '.cme-edit textarea{resize:vertical}',
            '.cme-orig{opacity:.85}',
            '.cme-diff{background:var(--cme-mark);border-radius:3px;',
            'box-shadow:0 0 0 1px var(--cme-mark)}',
            '.cme-diff:empty{display:inline-block;width:3px;height:1.05em;vertical-align:-.18em;',
            'background:var(--cme-accent);box-shadow:none}',
            '.cme-edit-bar{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}',

            // ---- 기타 ----
            '.cme-empty{padding:50px 10px;text-align:center;color:var(--cme-muted)}',
            '.cme-log{flex:0 0 auto;max-height:150px;overflow:auto;padding:8px 18px;',
            'border-top:1px solid var(--cme-line2);background:var(--cme-head);font-size:11px;',
            'line-height:1.6;color:var(--cme-muted);display:none;white-space:pre-wrap}',
            '.cme-log.open{display:block}'
        ].join('');
        document.head.appendChild(s);
    }

    // ============== 모달 ==============
    function openModal() {
        if (document.querySelector('.' + OVERLAY_CLASS)) return;

        var overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.innerHTML =
            '<div class="cme-modal">' +
              '<div class="cme-head">' +
                '<h3>✏️ 출력물 일괄 편집</h3>' +
                '<span class="cme-stat" id="cme-stat">불러오는 중…</span>' +
                '<span class="cme-spacer"></span>' +
                '<button class="cme-b" id="cme-verify" disabled>읽기 검증</button>' +
                '<button class="cme-b" id="cme-export" disabled>JSON 내보내기</button>' +
                // 라벨은 updateCounters()에서 현재 섹션 이름을 붙여 다시 씁니다.
                '<button class="cme-b" id="cme-import" disabled>JSON 불러오기</button>' +
                '<input type="file" id="cme-file" accept="application/json,.json" hidden>' +
                '<button class="cme-b" id="cme-lock">🔒 읽기 전용</button>' +
                '<button class="cme-b danger" id="cme-reset-all" disabled>전체 원복</button>' +
                '<button class="cme-b primary" id="cme-save" disabled>변경사항 저장</button>' +
                '<button class="cme-b" id="cme-refresh" hidden>↻ 새로고침</button>' +
                '<button class="cme-b" id="cme-close">닫기</button>' +
              '</div>' +
              '<div class="cme-tools">' +
                '<div class="cme-seg" id="cme-seg">' +
                  '<button class="cme-segb active" data-view="bot">AI 출력물<b data-n="bot"></b></button>' +
                  '<button class="cme-segb" data-view="user">내 메시지<b data-n="user"></b></button>' +
                  '<button class="cme-segb" data-view="all">전체<b data-n="all"></b></button>' +
                '</div>' +
                '<input type="text" class="cme-search" id="cme-search" placeholder="본문 검색">' +
                '<label><input type="checkbox" id="cme-changed-only"> 변경분만</label>' +
              '</div>' +
              '<div class="cme-tools">' +
                '<input type="text" class="cme-find" id="cme-find" placeholder="찾을 내용">' +
                '<input type="text" class="cme-find" id="cme-replace" placeholder="바꿀 내용">' +
                '<label><input type="checkbox" id="cme-regex"> 정규식</label>' +
                '<button class="cme-b" id="cme-preview">미리보기</button>' +
                '<button class="cme-b" id="cme-apply" disabled>적용</button>' +
                '<span class="cme-stat" id="cme-find-stat"></span>' +
              '</div>' +
              '<div class="cme-list" id="cme-list"><div class="cme-empty">불러오는 중…</div></div>' +
              '<div class="cme-log" id="cme-log"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        var $ = function (id) { return overlay.querySelector('#' + id); };
        var listEl = $('cme-list'), statEl = $('cme-stat'), logEl = $('cme-log');
        var searchEl = $('cme-search'), changedOnlyEl = $('cme-changed-only');
        var segEl = $('cme-seg'), segBtns = segEl.querySelectorAll('.cme-segb');
        var findEl = $('cme-find'), replaceEl = $('cme-replace'), regexEl = $('cme-regex');
        var findStatEl = $('cme-find-stat');
        var previewBtn = $('cme-preview'), applyBtn = $('cme-apply');
        var exportBtn = $('cme-export'), resetAllBtn = $('cme-reset-all');
        var saveBtn = $('cme-save'), closeBtn = $('cme-close');
        var lockBtn = $('cme-lock'), verifyBtn = $('cme-verify');
        var importBtn = $('cme-import'), fileEl = $('cme-file'), refreshBtn = $('cme-refresh');

        var items = [];          // { _id, role, turnId, reroll, status, original, draft, index }
        var openIds = {};        // 펼쳐진 행
        var renderLimit = RENDER_CHUNK;
        var saving = false;
        var pendingReplace = null;
        var loadStats = null;
        var locked = true;       // 기본값은 읽기 전용. 명시적으로 풀어야 쓰기가 열린다.
        var view = 'bot';        // 'bot' | 'user' | 'all' — 섹션 구분
        var warnedUser = false;

        function log(msg) {
            logEl.classList.add('open');
            logEl.textContent += (logEl.textContent ? '\n' : '') + msg;
            logEl.scrollTop = logEl.scrollHeight;
        }

        function changedItems() {
            return items.filter(function (m) { return m.draft !== m.original; });
        }

        function invalidItems() {
            return changedItems().filter(function (m) { return !String(m.draft).trim(); });
        }

        function hasUnsaved() { return changedItems().length > 0; }

        async function close() {
            if (saving) return;
            if (hasUnsaved() && !window.confirm('저장하지 않은 변경이 ' + changedItems().length + '건 있습니다. 창을 닫을까요?')) return;
            overlay.remove();
        }
        closeBtn.onclick = close;
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function onKey(e) {
            if (!overlay.isConnected) { document.removeEventListener('keydown', onKey); return; }
            if (e.key === 'Escape' && !saving) { e.preventDefault(); close(); }
        });

        // ---------- 필터 ----------
        function filtered() {
            var q = searchEl.value.trim().toLowerCase();
            var changedOnly = changedOnlyEl.checked;
            return items.filter(function (m) {
                var isBot = m.role === 'assistant';
                if (view === 'bot' && !isBot) return false;
                if (view === 'user' && isBot) return false;
                if (changedOnly && m.draft === m.original) return false;
                if (!q) return true;
                return String(m.draft).toLowerCase().indexOf(q) >= 0 ||
                       String(m.original).toLowerCase().indexOf(q) >= 0;
            });
        }

        function updateCounters() {
            var ch = changedItems().length;
            var bad = invalidItems().length;
            saveBtn.disabled = locked || saving || ch === 0 || bad > 0;
            saveBtn.textContent = saving ? '저장 중…' : (ch ? '변경사항 저장 (' + ch + ')' : '변경사항 저장');
            resetAllBtn.disabled = locked || saving || ch === 0;
            exportBtn.disabled = saving || items.length === 0;
            exportBtn.textContent = 'JSON 내보내기 (' + SCOPE_LABEL[view] + ')';
            exportBtn.title = '지금 보고 있는 섹션만 내보냅니다. 검색어·[변경분만]은 무시합니다.';
            importBtn.disabled = locked || saving || items.length === 0;
            importBtn.title = locked ? '잠금을 해제해야 불러올 수 있습니다' : '내보낸 JSON을 고쳐서 되돌려 넣습니다';
            verifyBtn.disabled = saving || !loadStats;
            previewBtn.disabled = saving;
            if (locked) applyBtn.disabled = true;
            lockBtn.textContent = locked ? '🔒 읽기 전용' : '🔓 편집 가능';
            lockBtn.title = locked ? '클릭하면 편집·저장이 열립니다' : '클릭하면 다시 읽기 전용으로 잠급니다';
            var bots = items.filter(function (m) { return m.role === 'assistant'; }).length;
            var users = items.length - bots;
            segEl.querySelector('[data-n="bot"]').textContent = nf(bots);
            segEl.querySelector('[data-n="user"]').textContent = nf(users);
            segEl.querySelector('[data-n="all"]').textContent = nf(items.length);
            statEl.textContent = '총 ' + nf(items.length) + '개' +
                (ch ? ' · 수정 ' + ch + '건' : '') + (bad ? ' · 빈 본문 ' + bad + '건' : '');
        }

        // ---------- 원문 ↔ 편집 비교 ----------
        // 앞뒤로 같은 부분을 잘라내고 가운데 달라진 구간만 형광 표시한다.
        function affix(a, b) {
            var n = Math.min(a.length, b.length), p = 0;
            while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
            var s = 0;
            while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
            return { pre: p, suf: s };
        }

        function markedHtml(text, other) {
            text = String(text); other = String(other);
            if (text === other) return escapeHtml(text);
            var c = affix(text, other);
            var mid = text.slice(c.pre, text.length - c.suf);
            return escapeHtml(text.slice(0, c.pre)) +
                   '<span class="cme-diff">' + escapeHtml(mid) + '</span>' +
                   escapeHtml(text.slice(text.length - c.suf));
        }

        function deltaText(m) {
            if (m.draft === m.original) return '원문과 같음';
            var d = m.draft.length - m.original.length;
            return '변경됨 · ' + nf(m.original.length) + '자 → ' + nf(m.draft.length) + '자 (' +
                   (d >= 0 ? '+' : '−') + nf(Math.abs(d)) + ')';
        }

        // ---------- 렌더 ----------
        function rowHtml(m) {
            var changed = m.draft !== m.original;
            var invalid = changed && !String(m.draft).trim();
            var isBot = m.role === 'assistant';
            var open = !!openIds[m._id];
            var h = '<div class="cme-row' + (invalid ? ' invalid' : changed ? ' changed' : '') + '" data-id="' + m._id + '">' +
                '<div class="cme-line" data-act="toggle">' +
                  '<div class="cme-idx">#' + m.index + '</div>' +
                  '<div><span class="cme-role ' + (isBot ? 'bot' : 'user') + '">' + (isBot ? 'AI' : '나') + '</span></div>' +
                  '<div><div class="cme-text">' + escapeHtml(preview(m.draft, 200)) + '</div>' +
                    '<div class="cme-meta">_id …' + shortId(m._id) + ' · turn …' + shortId(m.turnId) +
                    (m.reroll ? ' · reroll' : '') + (m.status && m.status !== 'done' ? ' · ' + escapeHtml(m.status) : '') +
                    '</div></div>' +
                  '<div class="cme-right">' + nf(String(m.draft).length) + '자' +
                    (invalid ? '<span class="cme-tag err">빈 본문</span>' : changed ? '<span class="cme-tag mod">수정</span>' : '') +
                  '</div>' +
                '</div>';
            if (open) {
                h += '<div class="cme-edit">' +
                       '<div class="cme-panes">' +
                         '<div class="cme-pane">' +
                           '<div class="cme-pane-h">원문 (서버에 저장된 내용)' +
                             '<span class="cme-stat">' + nf(String(m.original).length) + '자</span></div>' +
                           '<div class="cme-orig" data-role="orig">' + markedHtml(m.original, m.draft) + '</div>' +
                         '</div>' +
                         '<div class="cme-pane">' +
                           '<div class="cme-pane-h">' + (changed ? '변경될 내용' : '편집') +
                             (locked ? ' · 읽기 전용' : '') +
                             '<span class="cme-stat" data-role="len">' + nf(String(m.draft).length) + '자</span></div>' +
                           '<textarea data-act="draft" spellcheck="false"' + (locked ? ' readonly' : '') + '>' +
                             escapeHtml(m.draft) + '</textarea>' +
                         '</div>' +
                       '</div>' +
                       '<div class="cme-edit-bar">' +
                         '<button class="cme-b danger" data-act="restore"' + (locked || !changed ? ' disabled' : '') + '>이 항목 원복</button>' +
                         '<span class="cme-stat" data-role="delta">' + escapeHtml(deltaText(m)) + '</span>' +
                       '</div>' +
                     '</div>';
            }
            return h + '</div>';
        }

        function render() {
            var list = filtered();
            var shown = list.slice(0, renderLimit);
            if (!list.length) {
                listEl.innerHTML = '<div class="cme-empty">' +
                    (items.length ? '조건에 맞는 메시지가 없습니다.' : '메시지가 없습니다.') + '</div>';
                updateCounters();
                return;
            }
            var html = shown.map(rowHtml).join('');
            if (list.length > shown.length) {
                html += '<div class="cme-empty"><button class="cme-b" id="cme-more">' +
                        nf(list.length - shown.length) + '개 더 보기</button></div>';
            }
            listEl.innerHTML = html;
            var more = listEl.querySelector('#cme-more');
            if (more) more.onclick = function () { renderLimit += RENDER_CHUNK; render(); };
            updateCounters();
        }

        function byId(id) {
            for (var i = 0; i < items.length; i++) if (items[i]._id === id) return items[i];
            return null;
        }

        // 행 클릭 / 버튼 (이벤트 위임)
        listEl.addEventListener('click', function (e) {
            var rowEl = e.target.closest('.cme-row');
            if (!rowEl) return;
            var m = byId(rowEl.dataset.id);
            if (!m) return;
            var act = e.target.closest('[data-act]');
            var name = act && act.dataset.act;

            if (name === 'restore') {
                if (locked) return;
                m.draft = m.original;
                render();
                return;
            }
            if (name === 'toggle') {
                if (openIds[m._id]) delete openIds[m._id];
                else openIds[m._id] = true;
                render();
            }
        });

        // textarea 입력 — 목록 전체를 다시 그리지 않고 해당 행만 갱신
        listEl.addEventListener('input', function (e) {
            var ta = e.target;
            if (!ta.matches || !ta.matches('textarea[data-act="draft"]')) return;
            if (locked) { ta.value = ta.defaultValue; return; }
            var rowEl = ta.closest('.cme-row');
            var m = byId(rowEl && rowEl.dataset.id);
            if (!m) return;
            m.draft = ta.value;                       // trim 금지 — 공백/개행도 원문의 일부
            var changed = m.draft !== m.original;
            var invalid = changed && !String(m.draft).trim();
            rowEl.classList.toggle('changed', changed && !invalid);
            rowEl.classList.toggle('invalid', invalid);
            var lenEl = rowEl.querySelector('[data-role="len"]');
            if (lenEl) lenEl.textContent = nf(m.draft.length) + '자';
            var deltaEl = rowEl.querySelector('[data-role="delta"]');
            if (deltaEl) deltaEl.textContent = deltaText(m);
            var origEl = rowEl.querySelector('[data-role="orig"]');
            if (origEl) origEl.innerHTML = markedHtml(m.original, m.draft);   // 왼쪽 형광 표시 갱신
            var restoreBtn = rowEl.querySelector('[data-act="restore"]');
            if (restoreBtn) restoreBtn.disabled = !changed;
            var textEl = rowEl.querySelector('.cme-text');
            if (textEl) textEl.textContent = preview(m.draft, 200);
            updateCounters();
        });

        searchEl.addEventListener('input', function () { renderLimit = RENDER_CHUNK; render(); });
        changedOnlyEl.addEventListener('change', function () { renderLimit = RENDER_CHUNK; render(); });

        // 섹션 전환 (AI 출력물 / 내 메시지 / 전체)
        segEl.addEventListener('click', function (e) {
            var b = e.target.closest('.cme-segb');
            if (!b || b.dataset.view === view) return;
            view = b.dataset.view;
            for (var i = 0; i < segBtns.length; i++) segBtns[i].classList.toggle('active', segBtns[i] === b);
            if (view === 'user' && !warnedUser) {
                warnedUser = true;
                log('내 메시지 구간입니다. 저장 방식은 AI 출력물과 같지만, 이 구간에서 저장을 시험해 본 적은 아직 없습니다. ' +
                    '한 건만 먼저 고쳐서 반영되는지 확인한 뒤 나머지를 손대세요.');
            }
            renderLimit = RENDER_CHUNK;
            render();
        });

        // ---------- 찾기 / 바꾸기 ----------
        function buildPattern() {
            var find = findEl.value;
            if (!find) return { error: '찾을 내용을 입력하세요.' };
            if (regexEl.checked) {
                try { return { re: new RegExp(find, 'g') }; }
                catch (err) { return { error: '정규식 오류: ' + err.message }; }
            }
            return { re: new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') };
        }

        previewBtn.onclick = function () {
            pendingReplace = null;
            applyBtn.disabled = true;
            var p = buildPattern();
            if (p.error) { findStatEl.textContent = p.error; return; }
            var replacement = replaceEl.value;
            var targets = filtered();
            var hitMsgs = 0, hitCount = 0;
            var plan = [];
            targets.forEach(function (m) {
                p.re.lastIndex = 0;
                var n = (String(m.draft).match(p.re) || []).length;
                if (!n) return;
                p.re.lastIndex = 0;
                var next = String(m.draft).replace(p.re, replacement);
                if (next === m.draft) return;
                hitMsgs++; hitCount += n;
                plan.push({ m: m, next: next });
            });
            if (!hitMsgs) { findStatEl.textContent = '일치하는 내용이 없습니다.'; return; }
            findStatEl.textContent = '메시지 ' + hitMsgs + '개 · ' + hitCount + '곳이 바뀝니다' +
                (locked ? ' (읽기 전용 — 적용하려면 잠금 해제)' : '');
            pendingReplace = plan;
            applyBtn.disabled = locked;
        };

        applyBtn.onclick = function () {
            if (locked) return;
            if (!pendingReplace || !pendingReplace.length) return;
            if (!window.confirm('메시지 ' + pendingReplace.length + '개의 본문을 바꿉니다.\n' +
                                '아직 서버에 저장되지 않으며, 저장 전까지 전체 원복이 가능합니다.\n계속할까요?')) return;
            pendingReplace.forEach(function (p) { p.m.draft = p.next; });
            findStatEl.textContent = pendingReplace.length + '개 적용됨 (미저장)';
            pendingReplace = null;
            applyBtn.disabled = true;
            render();
        };

        [findEl, replaceEl].forEach(function (el) {
            el.addEventListener('input', function () { pendingReplace = null; applyBtn.disabled = true; findStatEl.textContent = ''; });
        });
        regexEl.addEventListener('change', function () { pendingReplace = null; applyBtn.disabled = true; findStatEl.textContent = ''; });

        // ---------- 백업 / 원복 ----------
        function scopedItems(scope) {
            if (scope === 'bot') return items.filter(function (m) { return m.role === 'assistant'; });
            if (scope === 'user') return items.filter(function (m) { return m.role !== 'assistant'; });
            return items;
        }

        // scope를 생략하면 항상 전체. 저장 직전 자동 백업은 반드시 전체여야 한다.
        function backupPayload(tag, scope) {
            scope = scope || 'all';
            var list = scopedItems(scope);
            return {
                exportedAt: new Date().toISOString(),
                reason: tag,
                scope: scope,
                chatId: getChatId(),
                total: list.length,
                totalInChat: items.length,
                messages: list.map(function (m) {
                    return { _id: m._id, role: m.role, turnId: m.turnId, reroll: m.reroll, content: m.original };
                })
            };
        }

        // 내보내기 범위는 지금 보고 있는 섹션. 검색어·[변경분만]은 반영하지 않는다.
        exportBtn.onclick = function () {
            var n = scopedItems(view).length;
            if (!n) { log('내보낼 메시지가 없습니다.'); return; }
            downloadJson(backupPayload('manual', view),
                'crack-messages-' + (getChatId() || 'chat') + '-' + SCOPE_SLUG[view] + '-' + stamp() + '.json');
            log('JSON 내보내기 — ' + SCOPE_LABEL[view] + ' ' + nf(n) + '개' +
                (view === 'all' ? '' : ' (검색·필터와 무관하게 이 섹션 전부)'));
        };

        // ---------- JSON 불러오기 (일괄 적용) ----------
        // 서버에 바로 쓰지 않는다. draft에만 올리고, 확인 후 평소처럼 [변경사항 저장]을 거친다.
        importBtn.onclick = function () {
            if (locked || saving) return;
            fileEl.value = '';
            fileEl.click();
        };

        fileEl.onchange = function () {
            var f = fileEl.files && fileEl.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
                var payload;
                try { payload = JSON.parse(String(reader.result)); }
                catch (err) {
                    logEl.textContent = '';
                    log('✗ JSON을 읽지 못했습니다: ' + err.message);
                    return;
                }
                applyImport(payload, f.name);
            };
            reader.onerror = function () { log('✗ 파일을 읽지 못했습니다.'); };
            reader.readAsText(f, 'utf-8');
        };

        function applyImport(payload, fileName) {
            logEl.textContent = '';
            log('JSON 불러오기 — ' + fileName);

            var list = payload && payload.messages;
            if (!Array.isArray(list)) {
                log('✗ messages 배열이 없습니다. [JSON 내보내기]로 받은 파일인지 확인하세요.');
                return;
            }

            // ★ 방 확인 — 다른 방 백업을 덮어쓰면 복구할 수 없다. 경고가 아니라 차단.
            var cur = getChatId();
            if (!payload.chatId) {
                log('✗ 파일에 chatId가 없습니다. 어느 방의 백업인지 확인할 수 없어 중단합니다.');
                return;
            }
            if (payload.chatId !== cur) {
                log('✗ 다른 채팅방의 백업입니다. 중단했습니다.');
                log('   파일: ' + payload.chatId);
                log('   현재: ' + cur);
                return;
            }

            var seen = Object.create(null);
            var plan = [], unknown = [], samples = [];
            var dup = 0, badContent = 0, emptyContent = 0, same = 0;

            for (var i = 0; i < list.length; i++) {
                var r = list[i];
                var id = r && r._id;
                if (!id) { badContent++; continue; }
                if (seen[id]) { dup++; continue; }
                seen[id] = 1;
                var m = byId(id);
                if (!m) { unknown.push(id); continue; }
                if (typeof r.content !== 'string') { badContent++; continue; }
                if (!r.content.trim()) { emptyContent++; continue; }
                if (r.content === m.draft) { same++; continue; }
                plan.push({ m: m, next: r.content });
                if (samples.length < 5) {
                    samples.push('   #' + m.index + '  ' + nf(m.draft.length) + '자 → ' + nf(r.content.length) + '자');
                }
            }

            var missing = items.filter(function (it) { return !seen[it._id]; }).length;

            var fileScope = payload.scope || 'all';
            log('파일 구간: ' + (SCOPE_LABEL[fileScope] || fileScope) +
                ' · 파일 ' + nf(list.length) + '개 / 현재 방 ' + nf(items.length) + '개');
            log('바뀔 항목 ' + nf(plan.length) + '건 · 그대로 ' + nf(same) + '건');
            if (missing) {
                log('파일에 없는 현재 메시지 ' + nf(missing) + '건 — 손대지 않습니다.' +
                    (fileScope === 'all' ? '  ⚠ 전체 백업인데 빠진 게 있습니다.' : ' (구간이 나뉜 파일이라 정상입니다)'));
            }
            if (unknown.length) log('⚠ 이 방에 없는 _id ' + nf(unknown.length) + '건 — 무시했습니다.');
            if (dup) log('⚠ 파일 안 중복 _id ' + nf(dup) + '건 — 첫 번째만 썼습니다.');
            if (badContent) log('⚠ content가 문자열이 아닌 항목 ' + nf(badContent) + '건 — 건너뛰었습니다.');
            if (emptyContent) log('⚠ 빈 본문 ' + nf(emptyContent) + '건 — 건너뛰었습니다. (빈 본문은 저장하지 않습니다)');
            samples.forEach(function (line) { log(line); });
            if (plan.length > samples.length) log('   … 외 ' + nf(plan.length - samples.length) + '건');

            if (!plan.length) { log('바뀔 내용이 없어 아무것도 적용하지 않았습니다.'); return; }

            if (!window.confirm('메시지 ' + plan.length + '건의 본문을 파일 내용으로 바꿉니다.\n\n' +
                                '아직 서버에 저장되지 않습니다.\n' +
                                '[변경분만] 체크로 확인한 뒤 [변경사항 저장]을 눌러야 반영됩니다.\n\n계속할까요?')) {
                log('취소했습니다.');
                return;
            }

            plan.forEach(function (p) { p.m.draft = p.next; });
            changedOnlyEl.checked = true;
            renderLimit = RENDER_CHUNK;
            render();
            log('✓ ' + nf(plan.length) + '건 적용됨 (미저장). 확인 후 [변경사항 저장]을 누르세요.');
        }

        // ---------- 새로고침 ----------
        refreshBtn.onclick = function () {
            if (saving) return;
            if (hasUnsaved() && !window.confirm('저장하지 않은 변경 ' + changedItems().length + '건이 있습니다.\n' +
                                                '새로고침하면 사라집니다. 계속할까요?')) return;
            location.reload();
        };

        // ---------- 잠금 / 읽기 검증 ----------
        lockBtn.onclick = function () {
            if (saving) return;
            if (locked) {
                if (!window.confirm('편집을 허용합니다.\n\n' +
                    '이 상태에서는 본문 수정과 서버 저장이 가능해집니다.\n' +
                    '저장은 되돌리기 어려우니, 먼저 [백업 내보내기]로 원본을 받아두시길 권합니다.\n\n계속할까요?')) return;
                locked = false;
                log('편집 잠금이 해제되었습니다.');
            } else {
                if (hasUnsaved() && !window.confirm('저장하지 않은 변경 ' + changedItems().length + '건이 있습니다.\n' +
                    '잠그면 수정할 수 없게 되지만 변경 내용은 그대로 남습니다. 계속할까요?')) return;
                locked = true;
                log('읽기 전용으로 잠갔습니다.');
            }
            render();
        };

        verifyBtn.onclick = function () {
            if (!loadStats) return;
            var s = loadStats;
            var counts = s.pageCounts;
            var turns = {};
            var roles = {};
            var empty = 0, maxLen = 0, totalLen = 0;
            items.forEach(function (m) {
                if (m.turnId) turns[m.turnId] = 1;
                roles[m.role] = (roles[m.role] || 0) + 1;
                var L = String(m.original).length;
                if (!String(m.original).trim()) empty++;
                if (L > maxLen) maxLen = L;
                totalLen += L;
            });
            var turnCount = Object.keys(turns).length;
            var firstPage = counts.length ? counts[0] : 0;

            var L = [];
            L.push('──────── 읽기 검증 ────────');
            L.push('요청 페이지 크기 ' + PAGE_SIZE + ' → 실제 첫 페이지 ' + firstPage + '개' +
                   (firstPage < PAGE_SIZE ? '  ⚠ 서버가 상한을 두는 것으로 보임' : '  (정상)'));
            L.push('페이지 ' + counts.length + '회 · 개수 ' +
                   counts.slice(0, 10).join(', ') + (counts.length > 10 ? ' …' : ''));
            L.push('총 ' + nf(items.length) + '개 수집 · ' + (s.elapsedMs / 1000).toFixed(1) + '초');
            L.push('중복 _id ' + s.duplicates.length + '건' +
                   (s.duplicates.length ? '  ⚠ 페이지네이션 이상 — 수정 금지' : '  (정상)'));
            L.push('커서 정상 종료: ' + (s.endedByCursor ? '예' : '아니오') +
                   (s.hitPageCap ? '  ⚠ 페이지 상한(' + MAX_PAGES + ') 도달 — 앞부분이 누락됐을 수 있음' : ''));
            var botN = roles.assistant || 0;
            var oddRoles = Object.keys(roles).filter(function (k) { return k !== 'assistant' && k !== 'user'; });
            L.push('섹션 분포: AI 출력물 ' + nf(botN) + ' / 내 메시지 ' + nf(items.length - botN) +
                   (oddRoles.length ? '  ⚠ 예외 role: ' + oddRoles.join(', ') : ''));
            L.push('turnId 종류: ' + nf(turnCount) + '개' +
                   (turnCount === items.length ? '  (메시지마다 고유 — 대화 턴 수가 아닙니다)'
                                               : '  (일부 메시지가 turnId를 공유 — 리롤로 보입니다)'));
            L.push('본문 합계 ' + nf(totalLen) + '자 · 최장 ' + nf(maxLen) + '자 · 빈 본문 ' + empty + '개');
            if (items.length) {
                var f = items[0], l = items[items.length - 1];
                L.push('첫 메시지  #1  [' + f.role + '] ' + JSON.stringify(preview(f.original, 60)));
                L.push('끝 메시지  #' + l.index + '  [' + l.role + '] …' + JSON.stringify(String(l.original).slice(-60)));
                L.push('  ↑ 끝 메시지가 채팅 화면 맨 아래와 같은지 확인하세요.');
            }
            L.push('───────────────────────');
            logEl.textContent = '';
            log(L.join('\n'));
        };

        resetAllBtn.onclick = function () {
            if (locked) return;
            var ch = changedItems().length;
            if (!ch) return;
            if (!window.confirm('수정한 ' + ch + '건을 모두 원본으로 되돌릴까요?')) return;
            items.forEach(function (m) { m.draft = m.original; });
            render();
        };

        // ---------- 저장 ----------
        saveBtn.onclick = async function () {
            if (locked) { window.alert('읽기 전용 상태입니다. 상단 [🔒 읽기 전용] 버튼으로 잠금을 해제하세요.'); return; }
            var targets = changedItems();
            if (!targets.length || saving) return;
            if (invalidItems().length) { window.alert('본문이 빈 항목이 있습니다. 먼저 채워주세요.'); return; }
            if (!window.confirm(targets.length + '건을 서버에 저장합니다.\n' +
                                '저장 직전 원본 전체가 JSON으로 자동 다운로드됩니다.\n계속할까요?')) return;

            // 저장 전 원본 자동 백업 — 되돌릴 수 없는 작업이므로 강제한다.
            downloadJson(backupPayload('before-save'), 'crack-backup-' + (getChatId() || 'chat') + '-' + stamp() + '.json');

            saving = true;
            logEl.textContent = '';
            log('원본 백업을 내려받았습니다. 저장을 시작합니다… (' + targets.length + '건)');
            updateCounters();
            closeBtn.disabled = true;

            var ok = 0, fail = 0, streak = 0;
            for (var i = 0; i < targets.length; i++) {
                var m = targets[i];
                saveBtn.textContent = '저장 중… (' + (i + 1) + '/' + targets.length + ')';
                try {
                    await patchMessage(m._id, m.draft);
                    m.original = m.draft;   // 저장 성공분은 새 원본으로 승격
                    ok++; streak = 0;
                } catch (err) {
                    fail++; streak++;
                    log('✗ #' + m.index + ' (…' + shortId(m._id) + ') ' + err.message);
                    if (streak >= SAVE_ABORT_AFTER) {
                        log('연속 ' + streak + '회 실패로 중단했습니다. 남은 ' + (targets.length - i - 1) + '건은 저장하지 않았습니다.');
                        break;
                    }
                }
                if (i < targets.length - 1) await sleep(SAVE_GAP_MS);
            }

            saving = false;
            closeBtn.disabled = false;
            log('완료 — 성공 ' + ok + '건' + (fail ? ' / 실패 ' + fail + '건' : ''));
            if (ok) {
                // 자동 새로고침하지 않는다 — 위 로그와 실패 목록을 읽을 기회를 없애기 때문.
                refreshBtn.hidden = false;
                log('크랙 화면에 반영하려면 위 내용을 확인한 뒤 상단 [↻ 새로고침]을 누르세요.');
            }
            render();
        };

        // ---------- 로드 ----------
        async function load() {
            statEl.textContent = '불러오는 중…';
            listEl.innerHTML = '<div class="cme-empty">불러오는 중…</div>';
            try {
                var result = await fetchAllMessages(function (count, pages) {
                    statEl.textContent = nf(count) + '개 (' + pages + '페이지)…';
                });
                loadStats = result.stats;
                items = result.messages.map(function (r, i) {
                    var content = String(r.content == null ? '' : r.content);
                    return {
                        _id: r._id, role: r.role, turnId: r.turnId, reroll: r.reroll, status: r.status,
                        original: content, draft: content, index: i + 1
                    };
                });
                renderLimit = RENDER_CHUNK;
                render();
                log('불러오기 완료 — ' + nf(items.length) + '개 · ' +
                    (loadStats.elapsedMs / 1000).toFixed(1) + '초 · ' + loadStats.pageCounts.length + '페이지');
                log('읽기 전용 상태입니다. [읽기 검증]으로 수집이 온전한지 먼저 확인하세요.');
            } catch (err) {
                statEl.textContent = '실패';
                listEl.innerHTML = '<div class="cme-empty">불러오기 실패: ' + escapeHtml(err.message) + '</div>';
            }
        }

        load();
    }

    // ============== 버튼 주입 ==============
    var headerWaitStartedAt = 0;
    var HEADER_WAIT_MS = 4000;

    function createButton() {
        var btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        btn.textContent = '✏️ 출력물';
        btn.title = '채팅 출력물 일괄 편집';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openModal();
        });
        return btn;
    }

    function mount(anchor, btn) {
        var before = anchor.before;
        if (before && before !== btn && before.parentElement === anchor.host) anchor.host.insertBefore(btn, before);
        else anchor.host.appendChild(btn);
    }

    function inject() {
        injectStyles();
        if (!getChatId()) {
            var stale = document.querySelector('.' + BTN_CLASS);
            if (stale) stale.remove();
            headerWaitStartedAt = 0;
            return;
        }
        var anchor = findHeaderAnchor();
        var existing = document.querySelector('.' + BTN_CLASS);
        if (existing) {
            if (anchor && existing.parentElement !== anchor.host) mount(anchor, existing);
            return;
        }
        if (!anchor) {
            if (!headerWaitStartedAt) headerWaitStartedAt = Date.now();
            return;
        }
        mount(anchor, createButton());
    }

    function start() {
        var scheduled = false;
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(function () {
                scheduled = false;
                try { inject(); } catch (e) {}
            });
        }
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        window.addEventListener('popstate', schedule);
        ['pushState', 'replaceState'].forEach(function (name) {
            var orig = history[name];
            if (typeof orig !== 'function') return;
            history[name] = function () {
                var ret = orig.apply(this, arguments);
                headerWaitStartedAt = 0;
                schedule();
                return ret;
            };
        });
        schedule();
        setInterval(schedule, 2000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
