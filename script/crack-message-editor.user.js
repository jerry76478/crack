// ==UserScript==
// @name         ✏️ 크랙 메시지 일괄 편집
// @namespace    https://crack.wrtn.ai/
// @version      0.7.1
// @description  채팅방의 AI 답변과 내 메시지를 섹션별로 훑어보고, 원문과 나란히 비교하며 수정·찾기바꾸기·JSON 일괄적용·주입 블록 정리로 고친 뒤 저장한다. 기본값은 읽기 전용이며 저장 직전 원본을 자동 백업한다.
// @author       Gia
// @downloadURL  https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-message-editor.user.js
// @updateURL    https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-message-editor.user.js
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
    var BACKUP_MIN = 5;           // 저장 확인 시트의 「저장 직전 원본 백업 받기」 스위치 기본값 기준:
                                  // 변경이 이 건수 이상이면 켠 채로, 미만이면 끈 채로 연다(사용자가 저장마다 바꿀 수 있다).
                                  // (1로 두면 늘 켠 채로, 아주 크게 두면 늘 끈 채로 열린다)

    // 섹션 구분 — 화면 전환·JSON 내보내기 범위에 함께 쓴다.
    // 라벨이 버튼 글자로 그대로 나가므로, 다른 스크립트의 탐색 키워드를 피한다.
    // ('AI 출력물'은 모바일 유틸의 /출력/ 패턴에 걸린다. createButton() 위 주석 참고)
    var SCOPE_LABEL = { bot: 'AI 답변', user: '내 메시지', all: '전체' };
    var SCOPE_SLUG = { bot: 'ai', user: 'user', all: 'all' };

    var BTN_CLASS = 'crack-msg-ed-btn';
    var OVERLAY_CLASS = 'crack-msg-ed-overlay';
    var CONTROL_SELECTOR = 'button,a,[role="button"]';
    var SHEET_MAX = 760;          // 이 폭 미만이면 아래에서 올라오는 전체 화면 시트

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

    // 파일명용 시각 — 반드시 로컬 시간. toISOString()은 UTC라
    // 한국시간 새벽 0~9시에 내보내면 날짜가 하루 전으로 찍힌다.
    function stampLocal() {
        function p(n) { return (n < 10 ? '0' : '') + n; }
        var d = new Date();
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
               '_' + p(d.getHours()) + p(d.getMinutes());
    }

    // 파일명에 못 쓰는 문자를 걷어내고 길이를 제한한다.
    function safeFileName(s, max) {
        var t = String(s == null ? '' : s)
            .replace(/[\x00-\x1f\x7f]/g, '')          // 제어문자
            .replace(/[\\\/:*?\x22<>|]/g, ' ')        // 윈도우/맥 금지 문자 (\x22 = 큰따옴표)
            .replace(/\s+/g, ' ')
            .trim();
        if (t.length > max) t = t.slice(0, max).trim();
        return t.replace(/[. ]+$/, '');           // 윈도우는 끝의 마침표·공백을 못 쓴다
    }

    function readJsonStorage(key) {
        try {
            var raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
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

    // 방 정보 — GET {API_BASE}/{chatId} (아카이브 스크립트가 쓰는 것과 같은 엔드포인트).
    // 파일명·화면 표시에만 쓰므로 실패해도 편집에는 지장이 없다.
    // 이름은 story.name만 쓴다. character.name 폴백은 일부러 넣지 않았다.
    async function fetchChatMeta() {
        var res = await apiGet('');
        var d = (res && res.data) || {};
        return {
            storyName: (d.story && d.story.name) || '',
            characterName: (d.character && d.character.name) || '',   // 진단용으로만 들고 있는다
            plainName: d.name || ''
        };
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

    // 내려받기를 요청한다. 요청 자체가 실패하면(파일 만들기·링크 누르기) 예외를 그대로 던진다 — 저장 직전 백업은 이걸로 막는다.
    function downloadJson(obj, filename) {
        var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        try { a.click(); }
        finally {
            if (a.parentNode) a.parentNode.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }
    }

    // ============== 주입 블록 찾기 (로어 인젝터) ==============
    // 로어 인젝터가 내 메시지 앞(또는 뒤)에 붙인 참고 블록을 찾는다.
    // 블록 = 여는 문구 + 줄바꿈 + 카드 줄들 + 줄바꿈 + 닫는 문구. 사용자 글과는 빈 줄 하나로 붙는다.
    // 문구는 로어 인젝터 원본에 있는 글자 그대로다(근거와 커밋은 CHANGES.md).
    //   rest      : 여는 문구 뒤에 같은 줄 글이 이어져도 된다(안내문이 길게 이어지는 A형식).
    //               없으면 여는 문구가 그 줄 전체여야 한다(뒤 공백만 허용).
    //   closeLine : 닫는 문구도 그 줄에 혼자 있어야 한다.
    //   닫는 문구가 null이면 첫 빈 줄(글 앞) 또는 메시지 끝(글 뒤)까지, '**'면 그 경계의 줄 끝 '**'가 닫는 문구다.
    //   current   : 인젝터가 지금 붙이는 형식. 인젝터가 켜져 있으면 최근 N턴은 인젝터가 스스로 지운다.
    var INJ_FORMATS = [
        { id: 'A1', current: true, on: true, rest: true, when: '현재 기본 「참고 맥락」 (+ 4월 말~ main 기본 문구)',
          pairs: [['<ooc_lore_context>\nReference notes about established continuity that may be relevant to the current scene.', '</ooc_lore_context>'],
                  ['<ooc_lore_context>\nEstablished continuity for the current RP scene. Use these facts naturally as background.', '</ooc_lore_context>']] },
        { id: 'A2', current: true, on: true, rest: true, when: '현재 「간단 참고」',
          pairs: [['<ooc_lore_context>\nContinuity reference only; use relevant facts as background without forcing character choices or dialogue.', '</ooc_lore_context>']] },
        { id: 'A3', current: true, on: true, rest: true, when: '이스케이프된 태그(화면·복사 경로)',
          pairs: [['&lt;ooc_lore_context&gt;', '&lt;/ooc_lore_context&gt;']] },
        { id: 'B1', on: true, when: '4~6월 「System 태그」',
          pairs: [['[System: Established world/character facts for this scene. Do not repeat verbatim.]', '[/System]']] },
        { id: 'B2', on: true, when: '4~6월 「OOC (기본)」',
          pairs: [['**OOC: Reference — factual background data. Incorporate naturally, never repeat verbatim.', '**']] },
        { id: 'B3', on: true, when: '4~6월 「내레이터」',
          pairs: [['(Narrator\'s note: The following are established facts in this story.)', '(End note)']] },
        { id: 'B4', on: true, when: '4~6월 「직접 지시」',
          pairs: [['Remember these established facts and reflect them naturally:', null]] },
        { id: 'B5', on: false, closeLine: true, when: '4~6월 「최소」 — 짧고 흔한 모양이라 기본 꺼짐',
          pairs: [['/**', '**/']] },
        { id: 'C1', on: true, when: '4월 초 기본',
          pairs: [['**[OOC: Reference — factual background data. Incorporate naturally, never repeat verbatim.]**', '**[End of reference data]**']] },
        { id: 'C2', on: true, when: '4월 초 기본',
          pairs: [['**[OOC: Lore — incorporate naturally, never repeat verbatim]**', null]] },
        { id: 'C3', on: true, when: '4월 기본',
          pairs: [['**OOC: Lore — incorporate naturally, never repeat verbatim', '**']] },
        { id: 'C4', on: true, when: '4월 초 자동 추출 블록',
          pairs: [['**[OOC: Established facts — maintain consistency]**', null]] },
        { id: 'C5', on: true, when: '4월 자동 추출 블록',
          pairs: [['**OOC: Established facts — maintain consistency', '**']] },
        { id: 'C6', on: true, when: '4~6월 코어 기본값',
          pairs: [['**OOC:Lore', '**']] },
        { id: 'C7', on: false, closeLine: true, when: '6월 12일 무렵 — [기억]은 RP 제목으로도 쓰여 기본 꺼짐',
          pairs: [['[기억]', '[/기억]'], ['[Memory]', '[/Memory]']] },
        { id: 'E', on: false, when: '인젝터 기록에 없음 — 사용자가 직접 쓸 수도 있어 기본 꺼짐',
          pairs: [['<OOC>', '</OOC>']] }
    ];
    var LORE_SETTINGS_KEY = 'lore-injector-v5';          // 읽기만 한다
    var LORE_CLEANUP_KEY = 'lore-injection-cleanup-v1';  // 읽기만 한다
    var LORE_DEFAULT_TURNS = 8;

    function isLineStart(t, i) { return i === 0 || t.charCodeAt(i - 1) === 10; }

    // i부터 공백·탭 뒤에 줄바꿈이나 글 끝이 오면 true
    function isLineEnd(t, i) {
        while (i < t.length && (t[i] === ' ' || t[i] === '\t' || t[i] === '\r')) i++;
        return i >= t.length || t[i] === '\n';
    }

    // i부터 (그 줄 나머지가 공백이면 그 줄과) 뒤따르는 빈 줄을 건너뛴 위치
    function skipBlankLines(t, i) {
        for (;;) {
            var j = i;
            while (j < t.length && (t[j] === ' ' || t[j] === '\t' || t[j] === '\r')) j++;
            if (j >= t.length) return t.length;
            if (t[j] !== '\n') return i;
            i = j + 1;
        }
    }

    function openerAt(t, i, fmts) {
        if (!isLineStart(t, i)) return null;
        for (var f = 0; f < fmts.length; f++) {
            var fm = fmts[f];
            for (var p = 0; p < fm.pairs.length; p++) {
                var o = fm.pairs[p][0];
                if (t.charCodeAt(i) !== o.charCodeAt(0) || t.substr(i, o.length) !== o) continue;
                if (!fm.rest && !isLineEnd(t, i + o.length)) continue;
                return { fmt: fm, open: o, close: fm.pairs[p][1], start: i, openEnd: i + o.length };
            }
        }
        return null;
    }

    function nextOpener(t, from, fmts) {
        var i = from;
        if (!isLineStart(t, i)) { i = t.indexOf('\n', i); if (i < 0) return null; i++; }
        while (i < t.length) {
            var op = openerAt(t, i, fmts);
            if (op) return op;
            i = t.indexOf('\n', i);
            if (i < 0) return null;
            i++;
        }
        return null;
    }

    // 닫는 문구가 없거나 '**'인 형식: 여는 줄부터 첫 빈 줄 앞(또는 글 끝)까지. 끝의 공백은 뺀다.
    function edgeEnd(t, op, stop) {
        var e = t.indexOf('\n', op.openEnd);
        if (e < 0 || e > stop) e = stop;
        while (e < stop) {
            var s = e + 1, n = t.indexOf('\n', s);
            if (n < 0 || n > stop) n = stop;
            if (/^[ \t\r]*$/.test(t.slice(s, n))) break;
            e = n;
        }
        while (e > op.openEnd && /[ \t\r\n]/.test(t[e - 1])) e--;
        return e;
    }

    // 닫는 문구가 있는 형식: 다음 블록이 시작되기 전에 줄 끝(closeLine이면 단독 줄)에 오는 첫 닫는 문구
    function closerEnd(t, op, stop) {
        var c = op.close, k = op.openEnd;
        for (;;) {
            k = t.indexOf(c, k);
            if (k < 0 || k + c.length > stop) return -1;
            if ((!op.fmt.closeLine || isLineStart(t, k)) && isLineEnd(t, k + c.length)) return k + c.length;
            k += 1;
        }
    }

    // 블록 찾기. 반환: { text: 지운 결과, blocks: [{fmt,start,end,where}], issues: [{fmt,kind,start}], cut }
    //   where: 'front'(글 앞) · 'tail'(글 뒤) · 'middle'(중간 — 닫는 문구가 있을 때만 지우고 표시)
    //   kind : 'unclosed'(닫는 줄 없음) · 'uncertain'(닫는 문구 없는 형식이 중간에 있음 — 경계 불확실)
    function scanInjected(text, fmts) {
        var t = String(text == null ? '' : text);
        var cands = [], issues = [], i = 0, op;
        while ((op = nextOpener(t, i, fmts))) {
            var nx = nextOpener(t, op.openEnd, fmts);
            var stop = nx ? nx.start : t.length;
            if (op.close === null || op.close === '**') {
                var end = edgeEnd(t, op, stop);
                if (op.close === '**' && !(end - 2 >= op.openEnd && t.slice(end - 2, end) === '**')) {
                    issues.push({ fmt: op.fmt, kind: 'unclosed', start: op.start });
                    i = op.openEnd;
                    continue;
                }
                cands.push({ fmt: op.fmt, start: op.start, end: end, edge: true });
                i = end;
            } else {
                var ce = closerEnd(t, op, stop);
                if (ce < 0) {
                    issues.push({ fmt: op.fmt, kind: 'unclosed', start: op.start });
                    i = op.openEnd;
                    continue;
                }
                cands.push({ fmt: op.fmt, start: op.start, end: ce, edge: false });
                i = ce;
            }
        }

        // 글 앞: 맨 앞(빈 줄 제외)부터 빈 줄만 사이에 두고 이어진 블록들
        var p = skipBlankLines(t, 0), k;
        for (k = 0; k < cands.length && cands[k].start === p; k++) {
            cands[k].where = 'front';
            p = skipBlankLines(t, cands[k].end);
        }
        // 글 뒤: 맨 끝(공백 제외)까지 공백만 사이에 두고 이어진 블록들
        var q = t.length;
        for (var r = cands.length - 1; r >= k; r--) {
            if (/\S/.test(t.slice(cands[r].end, q))) break;
            cands[r].where = 'tail';
            q = cands[r].start;
        }
        var blocks = [];
        cands.forEach(function (c) {
            if (!c.where) {
                if (c.edge) { issues.push({ fmt: c.fmt, kind: 'uncertain', start: c.start }); return; }
                c.where = 'middle';
            }
            blocks.push(c);
        });
        issues.sort(function (a, b) { return a.start - b.start; });

        // 지울 범위: 블록과 그 뒤 빈 줄. 글 뒤 블록은 앞쪽 빈 줄(구분용)까지.
        var ranges = [], fronts = [], tails = [], cut = 0;
        blocks.forEach(function (b) {
            cut += b.end - b.start;
            if (b.where === 'front') fronts.push(b);
            else if (b.where === 'tail') tails.push(b);
            else ranges.push([b.start, skipBlankLines(t, b.end)]);
        });
        if (fronts.length) ranges.push([0, skipBlankLines(t, fronts[fronts.length - 1].end)]);
        if (tails.length) {
            var s = tails[0].start, b0 = s;
            while (b0 > 0 && /\s/.test(t[b0 - 1])) b0--;
            var nl = t.indexOf('\n', b0);
            if (nl >= 0 && nl < s) b0 = nl;       // 사용자 글 마지막 줄 끝의 공백은 남긴다
            ranges.push([b0, t.length]);
        }
        ranges.sort(function (a, b) { return a[0] - b[0]; });
        var out = '', last = 0, seams = [];
        ranges.forEach(function (rg) {
            var a = Math.max(rg[0], last);
            out += t.slice(last, a);
            seams.push(out.length);
            last = Math.max(last, rg[1]);
        });
        out += t.slice(last);
        // 이음매만 정리한다: 맨 앞 빈 줄 제거, 3줄 이상 빈 줄은 2줄로. 사용자 글 안의 줄바꿈은 그대로.
        for (var z = seams.length - 1; z >= 0; z--) out = tidySeam(out, seams[z]);
        return { text: out, blocks: blocks, issues: issues, cut: cut };
    }

    function tidySeam(out, pos) {
        var a = pos, z = pos;
        while (a > 0 && /[ \t\r\n]/.test(out[a - 1])) a--;
        var nl = out.indexOf('\n', a);
        if (a > 0) { if (nl < 0 || nl > pos) return out; a = nl; }   // 앞 줄 끝 공백은 남긴다
        while (z < out.length && /[ \t\r\n]/.test(out[z])) z++;
        if (z < out.length) { var lastNl = out.lastIndexOf('\n', z - 1); z = lastNl >= a ? lastNl + 1 : a; }
        if (a === 0) return out.slice(z);                     // 맨 앞 빈 줄
        if (z >= out.length) return out.slice(0, a);          // 맨 끝 빈 줄
        var run = out.slice(a, z), n = (run.match(/\n/g) || []).length;
        return n >= 4 ? out.slice(0, a) + '\n\n\n' + out.slice(z) : out;
    }

    // 로어 인젝터 상태 — 「찾기」를 누를 때마다 새로 읽는다(인젝터가 늦게 뜰 수 있다).
    // 켜짐 = 페이지에 인젝터가 실제로 돌고 있고(window.__LoreInj), 설정의 enabled·injectionCleanupEnabled가 참.
    // 설정에 두 값이 없으면 인젝터 기본값(참)으로 본다. localStorage 값만 있고 __LoreInj가 없으면 꺼짐.
    function loreState() {
        var li = null, live = null;
        try { li = window.__LoreInj; } catch (e) {}
        try { live = li && li.settings && li.settings.config; } catch (e) {}
        var stored = readJsonStorage(LORE_SETTINGS_KEY);
        var cfg = (live && typeof live === 'object') ? live : (stored && typeof stored === 'object' ? stored : {});
        var running = !!(li && typeof li === 'object');
        var turns = Math.max(1, parseInt(cfg.injectionCleanupTurns || LORE_DEFAULT_TURNS, 10) || LORE_DEFAULT_TURNS);
        return {
            running: running,
            on: running && cfg.enabled !== false && cfg.injectionCleanupEnabled !== false,
            turns: turns,
            version: running ? String(li.VER || li.chatBootstrapVersion || '') : '',
            config: cfg
        };
    }

    // 인젝터 설정의 커스텀 형식(D). 여는 문구가 5자 이상이고 위 목록과 다를 때만.
    function customFormat(cfg) {
        var pre = String((cfg && cfg.prefix) || '').trim();
        var suf = String((cfg && cfg.suffix) || '').trim();
        if (pre.length < 5) return null;
        var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
        var np = norm(pre);
        for (var f = 0; f < INJ_FORMATS.length; f++) {
            for (var p = 0; p < INJ_FORMATS[f].pairs.length; p++) {
                var o = norm(INJ_FORMATS[f].pairs[p][0]);
                if (np.indexOf(o) === 0 || o.indexOf(np) === 0) return null;
            }
        }
        return { id: 'D', current: true, on: true, when: '인젝터 설정의 커스텀 형식', pairs: [[pre, suf || null]] };
    }

    // 인젝터가 남긴 정리 기록(읽기만). 이 메시지의 기록이 있고 지금 본문이 기록된 결과와 같으면 기록된 원문을 돌려준다.
    function readCleanupJournal() {
        var j = readJsonStorage(LORE_CLEANUP_KEY);
        return j && Array.isArray(j.items) ? j.items.filter(function (it) { return it && typeof it === 'object'; }) : [];
    }

    function journalMatch(journal, m, chatId) {
        var cur = String(m.draft);
        for (var i = 0; i < journal.length; i++) {
            var it = journal[i];
            if (it.messageId !== m._id || typeof it.originalText !== 'string') continue;
            if (it.chatId && chatId && it.chatId !== chatId) continue;
            var fin = typeof it.finalText === 'string' ? it.finalText
                    : typeof it.injectedText === 'string'
                        ? (it.position === 'after' ? it.originalText + '\n\n' + it.injectedText : it.injectedText + '\n\n' + it.originalText)
                        : null;
            if (fin === null || it.originalText === cur) continue;
            if (fin === cur || fin.trim() === cur.trim()) return it;
        }
        return null;
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
    //  색 테마 — UI 색은 전부 여기서 나옵니다.
    //  0.7.0부터는 편집 창 「백업」 탭 아래 「화면」에서 고를 수 있습니다(localStorage에 저장).
    //  밝음/어두움은 크랙 화면(html[data-theme])을 먼저 따르고, 없으면 기기 설정을 따릅니다.
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
    var THEME_NAMES = { beige: '베이지', pink: '분홍', lilac: '연보라', mint: '민트' };
    var THEME_STORE_KEY = 'crack-msg-editor:theme';   // 설정 편의용. 기본은 베이지

    function currentThemeName() {
        var v = '';
        try { v = window.localStorage.getItem(THEME_STORE_KEY) || ''; } catch (e) {}
        return THEME_PRESETS[v] ? v : 'beige';
    }

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

    // ============== 아이콘 (한 가지 색 선 아이콘) ==============
    function icon(paths, size) {
        size = size || 18;
        return '<svg class="cme-ic" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
               'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
               paths + '</svg>';
    }
    var IC_PENCIL = '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 8.5l3 3"/>';
    var IC_CLOSE = '<path d="M6 6l12 12M18 6 6 18"/>';
    var IC_LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
    var IC_UNLOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/>';
    var IC_LOG = '<path d="M7 5h12M7 12h12M7 19h12"/><path d="M3.5 5h.01M3.5 12h.01M3.5 19h.01"/>';

    // ============== 스타일 ==============
    function buildCss() {
        var theme = THEME_PRESETS[currentThemeName()];
        var scope = '.' + OVERLAY_CLASS + ',.' + BTN_CLASS;
        var darkScope = function (pre) {
            return pre + ' .' + OVERLAY_CLASS + ',' + pre + ' .' + BTN_CLASS;
        };
        var sheet = '@media (max-width:' + (SHEET_MAX - 0.02) + 'px)';
        return [
            // ---- 색 변수: 크랙 화면 html[data-theme]를 먼저, 없으면 기기 설정 ----
            scope + '{' + themeVars(theme.light) + '}',
            darkScope('html[data-theme="dark"]') + '{' + themeVars(theme.dark) + '}',
            '@media (prefers-color-scheme: dark){' +
                darkScope('html:not([data-theme="light"]):not([data-theme="dark"])') + '{' + themeVars(theme.dark) + '}}',

            // ---- 크랙 헤더에 꽂히는 버튼 ----
            '.' + BTN_CLASS + '{display:inline-flex;align-items:center;justify-content:center;gap:5px;',
            'padding:0 8px;height:29px;border-radius:7px;background:transparent;color:var(--cme-headerBtn);',
            'font-weight:680;font-size:11.5px;border:1px solid transparent;cursor:pointer;white-space:nowrap}',
            '.' + BTN_CLASS + ':hover{background:var(--cme-changedBg);border-color:var(--cme-line)}',
            '.' + BTN_CLASS + ' .cme-ic{flex:0 0 auto}',

            // ---- 창 뼈대 (PC: 가운데 창) ----
            // 창을 덮는 바탕은 보이는 영역(visualViewport)을 따른다 — 키보드가 올라와도 창 전체가 그 위에 온다.
            '.' + OVERLAY_CLASS + '{position:fixed;left:0;right:0;top:var(--cme-vvt,0px);height:var(--cme-vvh,100%);',
            'z-index:2147483000;background:rgba(0,0,0,.5);',
            'display:flex;align-items:center;justify-content:center;padding:12px 20px;box-sizing:border-box}',
            '.cme-modal{width:1200px;max-width:96vw;height:min(90vh,100%);max-height:100%;',
            'background:var(--cme-bg);color:var(--cme-fg);',
            'border:1px solid var(--cme-line);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;',
            'box-shadow:0 24px 70px rgba(0,0,0,.3);font-size:13px;line-height:1.5;box-sizing:border-box;',
            'font-family:inherit;-webkit-text-size-adjust:100%}',
            '.cme-modal *{box-sizing:border-box}',
            '.cme-modal{position:relative}',
            '.cme-ic{display:block;flex:0 0 auto}',

            // ---- 머리줄: 제목 · 방 이름 · 닫기 ----
            '.cme-head{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 16px;min-height:52px;',
            'border-bottom:1px solid var(--cme-line2);background:var(--cme-head);flex:0 0 auto}',
            '.cme-head h3{margin:0;font-size:15px;font-weight:700;flex:0 0 auto;display:flex;align-items:center;gap:7px;',
            'color:var(--cme-fg)}',
            '.cme-head h3 .cme-ic{color:var(--cme-accent2)}',
            '.cme-room{font-size:12.5px;font-weight:650;color:var(--cme-accent2);min-width:0;',
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}',
            '.cme-iconbtn{width:40px;height:40px;flex:0 0 auto;display:grid;place-items:center;border-radius:10px;',
            'border:1px solid transparent;background:transparent;color:var(--cme-muted);cursor:pointer;padding:0}',
            '.cme-iconbtn:hover:not(:disabled){background:var(--cme-btnHover);color:var(--cme-fg)}',
            '.cme-iconbtn:disabled{opacity:.4;cursor:not-allowed}',

            // ---- 구분(AI 답변 · 내 메시지 · 전체) + 기록 ----
            '.cme-scope{display:flex;gap:8px;align-items:center;padding:8px 12px;flex:0 0 auto;',
            'background:var(--cme-head);border-bottom:1px solid var(--cme-line2)}',
            '.cme-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px;padding:2px;border-radius:10px;',
            'background:var(--cme-panel);border:1px solid var(--cme-line);flex:1 1 auto;min-width:0;max-width:520px}',
            '.cme-segb{min-height:36px;padding:3px 6px;border-radius:8px;border:0;background:transparent;',
            'color:var(--cme-muted);font-size:12.5px;font-weight:650;cursor:pointer;font-family:inherit;min-width:0;',
            'display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:wrap;line-height:1.2}',
            '.cme-segb:hover{color:var(--cme-fg)}',
            '.cme-segb.active{background:var(--cme-bg);color:var(--cme-fg);box-shadow:0 1px 3px rgba(0,0,0,.14)}',
            '.cme-segb b{font-weight:650;opacity:.6;font-variant-numeric:tabular-nums;font-size:12px}',
            '.cme-logbtn{position:relative;flex:0 0 auto}',
            '.cme-logbtn .cme-dot{position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;',
            'background:var(--cme-danger);display:none}',
            '.cme-logbtn.has-err .cme-dot{display:block}',

            // ---- 탭 4개 ----
            '.cme-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:6px 8px;flex:0 0 auto;',
            'background:var(--cme-bg);border-bottom:1px solid var(--cme-line2)}',
            '.cme-tab{min-height:40px;min-width:0;padding:4px 4px;border:0;border-radius:9px;background:transparent;',
            'color:var(--cme-muted);font-family:inherit;font-size:13px;font-weight:650;cursor:pointer;line-height:1.2;',
            'overflow-wrap:anywhere;word-break:keep-all}',
            '.cme-tab:hover{color:var(--cme-fg);background:var(--cme-btnHover)}',
            '.cme-tab.on{background:var(--cme-changedBg);color:var(--cme-accent2)}',
            '.cme-tab:focus-visible,.cme-b:focus-visible,.cme-segb:focus-visible,.cme-iconbtn:focus-visible,' +
            '.cme-line:focus-visible{outline:2px solid var(--cme-accent);outline-offset:1px}',

            // ---- 본문 ----
            '.cme-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}',
            '.cme-pane-tab{padding:10px 16px 18px}',
            '.cme-pane-tab[hidden]{display:none}',
            '.cme-sticky{position:sticky;top:0;z-index:2;background:var(--cme-bg);margin:-10px -16px 8px;',
            'padding:10px 16px 8px;border-bottom:1px solid var(--cme-line2)}',
            '.cme-card{border:1px solid var(--cme-line2);border-radius:12px;background:var(--cme-btn);padding:12px 14px;',
            'margin-bottom:12px}',
            '.cme-card h4{margin:0 0 6px;font-size:14px;font-weight:700}',
            '.cme-hint{margin:0 0 8px;color:var(--cme-muted);font-size:12.5px;line-height:1.55}',
            '.cme-row2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
            '.cme-row2>.cme-grow{flex:1 1 180px;min-width:0}',
            '.cme-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',

            // ---- 버튼 (주 버튼 · 보통 · 위험) ----
            '.cme-b{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:6px 14px;',
            'border-radius:10px;border:1px solid var(--cme-line);background:var(--cme-btn);color:var(--cme-fg);',
            'font-family:inherit;font-size:13px;font-weight:650;cursor:pointer;line-height:1.25;text-align:center;',
            '-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
            '.cme-b:hover:not(:disabled){background:var(--cme-btnHover)}',
            '.cme-b:disabled{opacity:.45;cursor:not-allowed}',
            '.cme-b.primary{background:linear-gradient(160deg,var(--cme-accent),var(--cme-accent2));',
            'color:var(--cme-accentFg);border-color:transparent}',
            '.cme-b.danger{background:transparent;color:var(--cme-danger);border-color:var(--cme-danger)}',
            '.cme-b.danger:hover:not(:disabled){background:var(--cme-invalidBg)}',
            '.cme-b[hidden]{display:none}',

            // ---- 입력 ----
            '.cme-in{min-height:40px;padding:8px 11px;border:1px solid var(--cme-line);border-radius:10px;width:100%;',
            'background:var(--cme-panel);color:var(--cme-fg);font-size:13px;font-family:inherit}',
            '.cme-in:focus,.cme-edit textarea:focus{outline:none;border-color:var(--cme-accent);',
            'box-shadow:0 0 0 3px var(--cme-changedBg)}',
            '.cme-check{display:inline-flex;align-items:center;gap:8px;min-height:36px;font-size:13px;',
            'color:var(--cme-fg);cursor:pointer;line-height:1.4}',
            '.cme-check input{width:18px;height:18px;margin:0;flex:0 0 auto;accent-color:var(--cme-accent2)}',
            '.cme-stat{font-size:12px;color:var(--cme-muted);font-variant-numeric:tabular-nums}',

            // ---- 목록 ----
            '.cme-list{display:block}',
            '.cme-row{border-bottom:1px solid var(--cme-line2);padding:8px 6px}',
            '.cme-row.changed{background:var(--cme-changedBg);border-left:3px solid var(--cme-accent);padding-left:9px}',
            '.cme-row.invalid{background:var(--cme-invalidBg);border-left:3px solid var(--cme-danger);padding-left:9px}',
            '.cme-line{display:grid;grid-template-columns:52px 44px minmax(0,1fr) 150px;gap:10px;align-items:start;',
            'cursor:pointer;border-radius:8px;min-height:36px}',
            '.cme-top{display:contents}',
            '.cme-idx{color:var(--cme-muted);font-size:12px;font-variant-numeric:tabular-nums;padding-top:2px;grid-column:1}',
            '.cme-role{font-size:12px;font-weight:700;padding:1px 7px;border-radius:999px;text-align:center;',
            'display:inline-block;grid-column:2;align-self:start;line-height:1.5}',
            '.cme-role.user{background:var(--cme-panel);color:var(--cme-muted);border:1px solid var(--cme-line2)}',
            '.cme-role.bot{background:var(--cme-changedBg);color:var(--cme-accent2)}',
            '.cme-tags{grid-column:4;grid-row:1;display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;',
            'font-size:12px;color:var(--cme-muted);font-variant-numeric:tabular-nums;padding-top:2px}',
            '.cme-body-col{grid-column:3;grid-row:1;min-width:0}',
            '.cme-text{line-height:1.6;overflow-wrap:anywhere;color:var(--cme-fg);opacity:.88;',
            'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
            '.cme-meta{font-size:12px;color:var(--cme-muted);margin-top:3px;font-variant-numeric:tabular-nums;',
            'overflow-wrap:anywhere}',
            '.cme-tag{display:inline-block;font-size:12px;font-weight:700;padding:0 7px;border-radius:999px;line-height:1.6;',
            'white-space:nowrap}',
            '.cme-tag.mod{background:var(--cme-changedBg);color:var(--cme-accent2)}',
            '.cme-tag.err{background:var(--cme-invalidBg);color:var(--cme-danger)}',
            '.cme-tag.inj{border:1px dashed var(--cme-accent2);color:var(--cme-accent2)}',
            '.cme-empty{padding:40px 10px;text-align:center;color:var(--cme-muted)}',

            // ---- 원문 | 편집 (PC 두 칸, 폰은 작은 탭) ----
            '.cme-edit{margin-top:8px;padding:10px;border:1px solid var(--cme-line2);',
            'border-radius:10px;background:var(--cme-btn)}',
            '.cme-minitabs{display:none}',
            '.cme-panes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:stretch}',
            '.cme-pane{display:flex;flex-direction:column;min-width:0}',
            '.cme-pane[data-pane="diff"]{display:none}',
            '.cme-pane-h{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px;',
            'font-size:12px;font-weight:700;color:var(--cme-muted);letter-spacing:.02em}',
            '.cme-edit textarea,.cme-orig,.cme-diffbox{width:100%;height:clamp(180px,calc(var(--cme-vvh,100vh) * .42),640px);',
            'padding:10px;border:1px solid var(--cme-line);border-radius:8px;background:var(--cme-panel);',
            'color:var(--cme-fg);font-size:13px;line-height:1.75;',
            'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            'white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;margin:0}',
            '.cme-edit textarea{resize:vertical;display:block}',
            '.cme-orig{opacity:.85}',
            '.cme-diff{background:var(--cme-mark);border-radius:3px;',
            'box-shadow:0 0 0 1px var(--cme-mark)}',
            '.cme-diff:empty{display:inline-block;width:3px;height:1.05em;vertical-align:-.18em;',
            'background:var(--cme-accent);box-shadow:none}',
            '.cme-diffbox del,.cme-cut{background:var(--cme-invalidBg);color:var(--cme-danger);text-decoration:line-through;',
            'text-decoration-thickness:1px;border-radius:3px}',
            '.cme-diffbox ins{background:var(--cme-mark);text-decoration:none;border-radius:3px}',
            '.cme-edit-bar{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}',

            // ---- 주입 블록 정리 ----
            '.cme-fmts{margin:6px 0 0;border-top:1px dashed var(--cme-line2);padding-top:6px}',
            '.cme-fmts summary{cursor:pointer;min-height:36px;display:flex;align-items:center;font-weight:650;font-size:13px}',
            '.cme-fmt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 8px;align-items:start;',
            'padding:6px 0;border-bottom:1px solid var(--cme-line2)}',
            '.cme-fmt:last-child{border-bottom:0}',
            '.cme-fmt .cme-check{grid-row:span 2}',
            '.cme-fmt code,.cme-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;',
            'overflow-wrap:anywhere;white-space:pre-wrap;color:var(--cme-fg)}',
            '.cme-fmt small{font-size:12px;color:var(--cme-muted)}',
            '.cme-fmt.is-off{opacity:.7}',
            '.cme-note{padding:8px 10px;border-radius:10px;background:var(--cme-changedBg);font-size:12.5px;',
            'line-height:1.5;margin:8px 0}',
            '.cme-note[hidden]{display:none}',
            '.cme-sum{margin-top:10px;font-size:13px;line-height:1.6}',
            '.cme-sum b{font-variant-numeric:tabular-nums}',
            '.cme-warn{color:var(--cme-danger)}',
            '.cme-inj-item{border:1px solid var(--cme-line2);border-radius:10px;padding:6px 10px;margin-top:8px;',
            'background:var(--cme-bg)}',
            '.cme-inj-item.is-applied{border-color:var(--cme-accent)}',
            '.cme-inj-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
            '.cme-inj-head .cme-check{flex:1 1 200px;min-width:0}',
            '.cme-inj-head .cme-grow{flex:1 1 200px;min-width:0;font-size:13px}',
            '.cme-inj-view{margin-top:6px;max-height:340px;overflow:auto;padding:8px 10px;border:1px solid var(--cme-line2);',
            'border-radius:8px;background:var(--cme-panel);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            'font-size:12px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}',
            '.cme-inj-view[hidden]{display:none}',
            '.cme-sub{margin:14px 0 4px;font-size:13px;font-weight:700}',
            '.cme-chiplist{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12.5px;color:var(--cme-muted);',
            'font-variant-numeric:tabular-nums}',

            // ---- 테마 ----
            '.cme-themes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;max-width:480px}',
            '.cme-theme{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px}',
            '.cme-theme .cme-sw{width:22px;height:22px;border-radius:50%;border:1px solid rgba(0,0,0,.18)}',
            '.cme-theme.on{border-color:var(--cme-accent2);box-shadow:0 0 0 2px var(--cme-changedBg)}',

            // ---- 기록 · 알림 · 아래 고정 막대 ----
            '.cme-log{flex:0 0 auto;max-height:min(40%,260px);overflow:auto;padding:8px 16px;',
            'border-top:1px solid var(--cme-line2);background:var(--cme-head);font-size:12px;',
            'line-height:1.6;color:var(--cme-muted);display:none;white-space:pre-wrap;overflow-wrap:anywhere}',
            '.cme-log.open{display:block}',
            '.cme-banner{flex:0 0 auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;',
            'border-top:1px solid var(--cme-line2);background:var(--cme-changedBg);font-size:12.5px}',
            '.cme-banner[hidden]{display:none}',
            '.cme-banner span{flex:1 1 160px;min-width:0}',
            '.cme-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 12px;',
            'padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--cme-line);',
            'background:var(--cme-head)}',
            '.cme-lock{flex:0 0 auto}',
            '.cme-lock[aria-checked="true"]{border-color:var(--cme-accent);color:var(--cme-accent2);background:var(--cme-changedBg)}',
            '.cme-status{flex:1 1 auto;min-width:0;font-size:12.5px;color:var(--cme-muted);line-height:1.35;',
            'font-variant-numeric:tabular-nums;display:flex;flex-wrap:wrap;gap:0 8px}',
            '.cme-status .bad{color:var(--cme-danger);font-weight:700}',
            '.cme-bar .cme-save{flex:0 0 auto}',

            // ---- 확인 시트 (브라우저 확인창 대신, 편집 창 안에서) ----
            '.cme-ask{position:absolute;inset:0;z-index:30;background:rgba(0,0,0,.4);display:flex;',
            'align-items:center;justify-content:center;padding:16px}',
            '.cme-ask-panel{width:min(460px,100%);max-height:100%;overflow-y:auto;overflow-x:hidden;background:var(--cme-bg);',
            'color:var(--cme-fg);border:1px solid var(--cme-line);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);',
            'padding:16px 16px 14px}',
            '.cme-ask-panel h4{margin:0 0 8px;font-size:15px;font-weight:700;line-height:1.4}',
            '.cme-ask-msg{margin:0;font-size:13.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}',
            '.cme-ask-sub{margin:6px 0 0;font-size:12.5px;color:var(--cme-muted);line-height:1.5;overflow-wrap:anywhere}',
            '.cme-ask-warn{margin:8px 0 0;font-size:12.5px;line-height:1.5;color:var(--cme-danger)}',
            '.cme-ask-sw{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;margin-top:12px;padding:8px 12px;',
            'border:1px solid var(--cme-line);border-radius:10px;background:var(--cme-btn);color:var(--cme-fg);',
            'font-family:inherit;font-size:13.5px;font-weight:650;cursor:pointer;text-align:left;line-height:1.35}',
            '.cme-ask-sw:focus-visible,.cme-ask .cme-b:focus-visible{outline:2px solid var(--cme-accent);outline-offset:1px}',
            '.cme-ask-sw .cme-knob{flex:0 0 auto;width:38px;height:22px;border-radius:999px;background:var(--cme-line);position:relative}',
            '.cme-ask-sw .cme-knob::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;',
            'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}',
            '.cme-ask-sw[aria-checked="true"] .cme-knob{background:var(--cme-accent2)}',
            '.cme-ask-sw[aria-checked="true"] .cme-knob::after{transform:translateX(16px)}',
            '.cme-ask-sw .t{flex:1 1 auto;min-width:0}',
            '.cme-ask-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}',

            // ---- 키보드가 올라와 입력 중: 구분·탭·기록을 접어 편집 칸과 저장 막대가 보이게 ----
            '.cme-modal.is-typing .cme-scope,.cme-modal.is-typing .cme-tabs,.cme-modal.is-typing .cme-log,',
            '.cme-modal.is-typing .cme-banner,.cme-modal.is-typing .cme-minitabs{display:none}',
            '.cme-modal.is-typing .cme-sticky{position:static}',
            '.cme-modal.is-typing .cme-edit textarea{height:clamp(96px,calc(var(--cme-vvh,100vh) - 260px),900px)}',

            // ---- 폰: 아래에서 올라오는 전체 화면 시트 ----
            sheet + '{',
                '.' + OVERLAY_CLASS + '{padding:0;align-items:flex-end}',
                '.cme-modal{width:100%;max-width:100%;',
                'height:calc(100% - max(8px,env(safe-area-inset-top,0px)));max-height:none;',
                'border-radius:16px 16px 0 0;border-bottom:0}',
                '.cme-head{padding-left:14px}',
                '.cme-scope{padding:6px 10px}',
                '.cme-segb{flex-direction:column;gap:0;min-height:40px}',
                '.cme-pane-tab{padding:10px 10px 16px}',
                '.cme-sticky{margin:-10px -10px 8px;padding:10px 10px 8px}',
                '.cme-b{min-height:40px}',
                '.cme-row{border:1px solid var(--cme-line2);border-radius:12px;padding:10px 12px;margin-bottom:8px;',
                'background:var(--cme-bg)}',
                '.cme-row.changed,.cme-row.invalid{padding-left:10px}',
                '.cme-line{display:block}',
                '.cme-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px}',
                '.cme-tags{justify-content:flex-start;margin-left:auto;padding-top:0}',
                '.cme-minitabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px;padding:2px;',
                'border-radius:10px;background:var(--cme-panel);border:1px solid var(--cme-line);margin-bottom:8px}',
                '.cme-minitabs .cme-segb{flex-direction:row}',
                '.cme-panes{display:block}',
                '.cme-pane,.cme-pane[data-pane="diff"]{display:none}',
                '.cme-edit[data-show="orig"] .cme-pane[data-pane="orig"],',
                '.cme-edit[data-show="edit"] .cme-pane[data-pane="edit"],',
                '.cme-edit[data-show="diff"] .cme-pane[data-pane="diff"]{display:flex}',
                '.cme-edit textarea,.cme-orig,.cme-diffbox{height:clamp(140px,calc(var(--cme-vvh,100vh) - 330px),900px)}',
                
                '.cme-bar{gap:8px;padding-left:10px;padding-right:10px}',
                '.cme-status{flex-direction:column;gap:0}',
                '.cme-ask{align-items:flex-end;padding:0}',
                '.cme-ask-panel{width:100%;border-radius:16px 16px 0 0;border-bottom:0;',
                'padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}',
                '.cme-ask-acts .cme-b{flex:1 1 0;min-height:44px}',
            '}'
        ].join('');
    }

    function injectStyles(force) {
        var s = document.getElementById('crack-msg-ed-css');
        if (s && !force) return;
        if (!s) {
            s = document.createElement('style');
            s.id = 'crack-msg-ed-css';
            document.head.appendChild(s);
        }
        s.textContent = buildCss();
    }

    // ============== 모달 ==============
    function openModal() {
        if (document.querySelector('.' + OVERLAY_CLASS)) return;

        var fmtRows = INJ_FORMATS.map(function (f) { return fmtRowHtml(f); }).join('');
        var themeBtns = Object.keys(THEME_PRESETS).map(function (k) {
            return '<button type="button" class="cme-b cme-theme" data-theme-name="' + k + '">' +
                   '<span class="cme-sw" style="background:linear-gradient(135deg,' + THEME_PRESETS[k].light.accent + ' 50%,' +
                   THEME_PRESETS[k].dark.bg + ' 50%)"></span>' + THEME_NAMES[k] + '</button>';
        }).join('');

        var overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.innerHTML =
            '<div class="cme-modal" role="dialog" aria-modal="true" aria-label="메시지 일괄 편집">' +
              '<div class="cme-head">' +
                '<h3>' + icon(IC_PENCIL, 18) + '메시지 일괄 편집</h3>' +
                '<span class="cme-room" id="cme-room"></span>' +
                '<button type="button" class="cme-iconbtn" id="cme-close" aria-label="닫기" title="닫기">' + icon(IC_CLOSE, 20) + '</button>' +
              '</div>' +
              '<div class="cme-scope">' +
                '<div class="cme-seg" id="cme-seg" role="group" aria-label="구분">' +
                  '<button type="button" class="cme-segb active" data-view="bot">AI 답변<b data-n="bot"></b></button>' +
                  '<button type="button" class="cme-segb" data-view="user">내 메시지<b data-n="user"></b></button>' +
                  '<button type="button" class="cme-segb" data-view="all">전체<b data-n="all"></b></button>' +
                '</div>' +
                '<button type="button" class="cme-b cme-logbtn" id="cme-log-btn" aria-expanded="false">' +
                  icon(IC_LOG, 16) + '<span id="cme-log-n">기록 0</span><span class="cme-dot"></span></button>' +
              '</div>' +
              '<div class="cme-tabs" role="tablist" id="cme-tabs">' +
                '<button type="button" class="cme-tab on" role="tab" data-tab="list" aria-selected="true">목록</button>' +
                '<button type="button" class="cme-tab" role="tab" data-tab="find" aria-selected="false">찾기/바꾸기</button>' +
                '<button type="button" class="cme-tab" role="tab" data-tab="strip" aria-selected="false">주입 블록 정리</button>' +
                '<button type="button" class="cme-tab" role="tab" data-tab="backup" aria-selected="false">백업</button>' +
              '</div>' +
              '<div class="cme-body" id="cme-body">' +
                // ---- 목록 ----
                '<section class="cme-pane-tab" data-tabpane="list">' +
                  '<div class="cme-sticky cme-row2">' +
                    '<input type="text" class="cme-in cme-grow" id="cme-search" placeholder="본문 검색">' +
                    '<label class="cme-check"><input type="checkbox" id="cme-changed-only"> 변경분만</label>' +
                    '<span class="cme-stat" id="cme-stat">불러오는 중…</span>' +
                  '</div>' +
                  '<div class="cme-list" id="cme-list"><div class="cme-empty">불러오는 중…</div></div>' +
                '</section>' +
                // ---- 찾기/바꾸기 ----
                '<section class="cme-pane-tab" data-tabpane="find" hidden>' +
                  '<div class="cme-card">' +
                    '<h4>찾기 / 바꾸기</h4>' +
                    '<p class="cme-hint" id="cme-find-scope"></p>' +
                    '<div class="cme-row2"><input type="text" class="cme-in cme-grow" id="cme-find" placeholder="찾을 내용"></div>' +
                    '<div class="cme-row2" style="margin-top:8px"><input type="text" class="cme-in cme-grow" id="cme-replace" placeholder="바꿀 내용"></div>' +
                    '<div class="cme-acts">' +
                      '<label class="cme-check"><input type="checkbox" id="cme-regex"> 정규식</label>' +
                      '<button type="button" class="cme-b" id="cme-preview">미리보기</button>' +
                      '<button type="button" class="cme-b" id="cme-apply" disabled>초안에 적용</button>' +
                    '</div>' +
                    '<p class="cme-hint" style="margin-top:8px"><span class="cme-stat" id="cme-find-stat"></span></p>' +
                    '<div class="cme-chiplist" id="cme-find-plan"></div>' +
                  '</div>' +
                '</section>' +
                // ---- 주입 블록 정리 ----
                '<section class="cme-pane-tab" data-tabpane="strip" hidden>' +
                  '<div class="cme-card" id="cme-inj-card">' +
                    '<h4>주입 블록 정리</h4>' +
                    '<p class="cme-hint">로어 인젝터가 내 메시지 앞·뒤에 붙인 참고 블록을 찾아 <b>초안에서만</b> 지웁니다. ' +
                      'AI 답변은 건드리지 않고, 직접 쓴 OOC는 여는 문구가 아래 목록과 글자까지 같지 않으면 대상이 아닙니다. ' +
                      '저장은 아래 「변경사항 저장」으로 합니다.</p>' +
                    '<div class="cme-note" id="cme-inj-scope" hidden></div>' +
                    '<div class="cme-note" id="cme-inj-lore" hidden>' +
                      '<div id="cme-inj-lore-text"></div>' +
                      '<label class="cme-check"><input type="checkbox" id="cme-inj-recent"> 최근 것도 지우기</label>' +
                    '</div>' +
                    '<details class="cme-fmts" id="cme-inj-fmts">' +
                      '<summary id="cme-inj-fmts-sum">알아보는 형식</summary>' +
                      '<div id="cme-inj-fmtlist">' + fmtRows + '<div id="cme-inj-d"></div></div>' +
                    '</details>' +
                    '<label class="cme-check" id="cme-inj-exact-row" hidden><input type="checkbox" id="cme-inj-exact" checked> ' +
                      '인젝터 정리 기록과 정확히 맞는 메시지는 기록된 원문으로 되돌리기 <span class="cme-stat" id="cme-inj-exact-n"></span></label>' +
                    '<div class="cme-acts">' +
                      '<button type="button" class="cme-b" id="cme-inj-scan">찾기</button>' +
                      '<button type="button" class="cme-b" id="cme-inj-apply" disabled>초안에 적용</button>' +
                    '</div>' +
                    '<div class="cme-sum" id="cme-inj-sum"></div>' +
                  '</div>' +
                  '<div id="cme-inj-list"></div>' +
                '</section>' +
                // ---- 백업 ----
                '<section class="cme-pane-tab" data-tabpane="backup" hidden>' +
                  '<div class="cme-card">' +
                    '<h4>백업</h4>' +
                    '<p class="cme-hint">내보내기는 위에서 고른 구분(AI 답변 · 내 메시지 · 전체)만 받습니다. 검색어·변경분만은 무시합니다. ' +
                      '불러오기는 초안에만 올리고, 다른 방 백업은 막습니다.</p>' +
                    '<div class="cme-acts">' +
                      '<button type="button" class="cme-b" id="cme-export" disabled>JSON 내보내기</button>' +
                      '<button type="button" class="cme-b" id="cme-import" disabled>JSON 불러오기</button>' +
                      '<input type="file" id="cme-file" accept="application/json,.json" hidden>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cme-card">' +
                    '<h4>확인 · 되돌리기</h4>' +
                    '<p class="cme-hint">읽기 검증은 불러온 메시지가 온전한지 기록에 적습니다. 전체 원복은 저장하지 않은 변경을 모두 버립니다.</p>' +
                    '<div class="cme-acts">' +
                      '<button type="button" class="cme-b" id="cme-verify" disabled>읽기 검증</button>' +
                      '<button type="button" class="cme-b danger" id="cme-reset-all" disabled>전체 원복</button>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cme-card">' +
                    '<h4>화면</h4>' +
                    '<p class="cme-hint">색 조합을 고릅니다. 밝음·어두움은 크랙 화면 설정을 따릅니다.</p>' +
                    '<div class="cme-themes" id="cme-themes">' + themeBtns + '</div>' +
                  '</div>' +
                '</section>' +
              '</div>' +
              '<div class="cme-log" id="cme-log"></div>' +
              '<div class="cme-banner" id="cme-banner" hidden><span id="cme-banner-text"></span>' +
                '<button type="button" class="cme-b" id="cme-refresh" hidden>↻ 새로고침</button></div>' +
              '<div class="cme-bar">' +
                '<button type="button" class="cme-b cme-lock" id="cme-lock" role="switch" aria-checked="false"></button>' +
                '<div class="cme-status" id="cme-status" aria-live="polite"></div>' +
                '<button type="button" class="cme-b primary cme-save" id="cme-save" disabled>변경사항 저장</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var $ = function (id) { return overlay.querySelector('#' + id); };
        var modalEl = overlay.querySelector('.cme-modal');
        var listEl = $('cme-list'), statEl = $('cme-stat'), logEl = $('cme-log'), roomEl = $('cme-room');
        var bodyEl = $('cme-body'), tabsEl = $('cme-tabs'), statusEl = $('cme-status');
        var logBtn = $('cme-log-btn'), logNEl = $('cme-log-n');
        var bannerEl = $('cme-banner'), bannerTextEl = $('cme-banner-text');
        var searchEl = $('cme-search'), changedOnlyEl = $('cme-changed-only');
        var segEl = $('cme-seg'), segBtns = segEl.querySelectorAll('.cme-segb');
        var findEl = $('cme-find'), replaceEl = $('cme-replace'), regexEl = $('cme-regex');
        var findStatEl = $('cme-find-stat'), findPlanEl = $('cme-find-plan'), findScopeEl = $('cme-find-scope');
        var previewBtn = $('cme-preview'), applyBtn = $('cme-apply');
        var exportBtn = $('cme-export'), resetAllBtn = $('cme-reset-all');
        var saveBtn = $('cme-save'), closeBtn = $('cme-close');
        var lockBtn = $('cme-lock'), verifyBtn = $('cme-verify');
        var importBtn = $('cme-import'), fileEl = $('cme-file'), refreshBtn = $('cme-refresh');
        var injScanBtn = $('cme-inj-scan'), injApplyBtn = $('cme-inj-apply'), injSumEl = $('cme-inj-sum');
        var injListEl = $('cme-inj-list'), injLoreEl = $('cme-inj-lore'), injLoreTextEl = $('cme-inj-lore-text');
        var injRecentEl = $('cme-inj-recent'), injScopeEl = $('cme-inj-scope'), injDEl = $('cme-inj-d');
        var injExactRow = $('cme-inj-exact-row'), injExactEl = $('cme-inj-exact'), injExactNEl = $('cme-inj-exact-n');
        var injFmtsSumEl = $('cme-inj-fmts-sum'), themesEl = $('cme-themes');

        var items = [];          // { _id, role, turnId, reroll, status, original, draft, index }
        var openIds = {};        // 펼쳐진 행
        var paneOf = {};         // 폰에서 펼친 행의 작은 탭 (orig | edit | diff)
        var renderLimit = RENDER_CHUNK;
        var saving = false;
        var pendingReplace = null;
        var loadStats = null;
        var locked = true;       // 기본값은 읽기 전용. 명시적으로 풀어야 쓰기가 열린다.
        var view = 'bot';        // 'bot' | 'user' | 'all' — 섹션 구분
        var tab = 'list';        // 'list' | 'find' | 'strip' | 'backup'
        var warnedUser = false;
        var chatMeta = null;     // { storyName, ... } — 못 가져오면 null
        var storyName = '';
        var logCount = 0, logErr = false;

        // 주입 블록 정리 상태
        var fmtOn = {};          // 형식 id → 켬/끔 (사용자가 바꾼 값)
        INJ_FORMATS.forEach(function (f) { fmtOn[f.id] = f.on; });
        var dFormat = null;      // 인젝터 설정의 커스텀 형식 (있을 때만)
        var injPlan = null;      // 마지막 「찾기」 결과
        var injUndo = {};        // _id → 적용 전 초안 (행마다 되돌리기)
        var injCache = {};       // _id → { draft, sig, has } — 목록의 「주입 블록」 표시용

        function log(msg, opts) {
            logEl.textContent += (logEl.textContent ? '\n' : '') + msg;
            logEl.scrollTop = logEl.scrollHeight;
            logCount++;
            if (/^\s*✗/.test(msg) && !logEl.classList.contains('open')) logErr = true;
            if (opts && opts.open) setLogOpen(true);
            updateLogBtn();
        }

        function clearLog() {
            logEl.textContent = '';
            logCount = 0;
            updateLogBtn();
        }

        function updateLogBtn() {
            logNEl.textContent = '기록 ' + nf(logCount);
            logBtn.classList.toggle('has-err', logErr);
            logBtn.title = logErr ? '새 오류가 있습니다' : '작업 기록 열기/닫기';
        }

        function setLogOpen(open) {
            logEl.classList.toggle('open', open);
            logBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) { logErr = false; logEl.scrollTop = logEl.scrollHeight; }
            updateLogBtn();
        }
        logBtn.onclick = function () { setLogOpen(!logEl.classList.contains('open')); };

        function changedItems() {
            return items.filter(function (m) { return m.draft !== m.original; });
        }

        function invalidItems() {
            return changedItems().filter(function (m) { return !String(m.draft).trim(); });
        }

        function hasUnsaved() { return changedItems().length > 0; }

        // ---------- 화면 크기 · 키보드 ----------
        // 보이는 영역(visualViewport)의 위치·높이를 창에 준다. 창이 열려 있는 동안만 듣는다.
        // 키보드: 보이는 영역만 줄거나(visualViewport) 레이아웃 높이까지 줄어드는(같은 폭에서 가장 컸던 높이의 80% 미만) 두 경우를 본다.
        var tallest = 0, tallestW = 0;
        function syncViewport() {
            var vv = window.visualViewport;
            var layoutH = document.documentElement.clientHeight || window.innerHeight || 0;
            var h = vv ? vv.height : window.innerHeight;
            var top = vv ? vv.offsetTop : 0;
            if (window.innerWidth !== tallestW) { tallestW = window.innerWidth; tallest = 0; }
            tallest = Math.max(tallest, window.innerHeight || 0);
            overlay.style.setProperty('--cme-vvh', Math.round(h) + 'px');
            overlay.style.setProperty('--cme-vvt', Math.max(0, Math.round(top)) + 'px');
            var a = document.activeElement;
            var field = !!(a && overlay.contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName) &&
                           a.type !== 'checkbox' && a.type !== 'file');
            var typing = field && (h < layoutH * 0.8 || (window.innerHeight || 0) < tallest * 0.8);
            modalEl.classList.toggle('is-typing', typing);
            if (field && a.scrollIntoView) {
                try { a.scrollIntoView({ block: 'nearest' }); } catch (e) {}
            }
        }
        var vvTarget = window.visualViewport;
        if (vvTarget) {
            vvTarget.addEventListener('resize', syncViewport);
            vvTarget.addEventListener('scroll', syncViewport);
        }
        window.addEventListener('resize', syncViewport);
        overlay.addEventListener('focusin', syncViewport);
        overlay.addEventListener('focusout', function () { setTimeout(function () { if (overlay.isConnected) syncViewport(); }, 0); });
        syncViewport();

        function teardown() {
            if (vvTarget) {
                vvTarget.removeEventListener('resize', syncViewport);
                vvTarget.removeEventListener('scroll', syncViewport);
            }
            window.removeEventListener('resize', syncViewport);
        }

        // ---------- 확인 시트 (브라우저 확인창 대신) ----------
        // opts: { title, message, sub, warn, ok, cancel, tone: 'danger', alert: 확인 버튼만,
        //         backup: { on, label, okOn, okOff, noteOn, noteOff } — 저장 확인에만 }
        // 반환: Promise<{ ok, backup }>. 시트가 이미 떠 있으면 새로 열지 않고 취소로 본다.
        var askDone = null;
        function ask(opts) {
            if (askDone) return Promise.resolve({ ok: false, backup: false });
            return new Promise(function (resolve) {
                var bk = opts.backup || null;
                var backupOn = !!(bk && bk.on);
                var before = document.activeElement;
                var layer = document.createElement('div');
                layer.className = 'cme-ask';
                layer.innerHTML =
                    '<div class="cme-ask-panel" role="alertdialog" aria-modal="true" aria-labelledby="cme-ask-title">' +
                      '<h4 id="cme-ask-title">' + escapeHtml(opts.title) + '</h4>' +
                      '<p class="cme-ask-msg">' + escapeHtml(opts.message) + '</p>' +
                      (opts.sub ? '<p class="cme-ask-sub">' + escapeHtml(opts.sub) + '</p>' : '') +
                      (opts.warn ? '<p class="cme-ask-warn">' + escapeHtml(opts.warn) + '</p>' : '') +
                      (bk ? '<button type="button" class="cme-ask-sw" role="switch" data-ask="backup" aria-checked="false">' +
                              '<span class="cme-knob" aria-hidden="true"></span><span class="t">' + escapeHtml(bk.label) + '</span></button>' +
                            '<p class="cme-ask-sub" data-role="backup-note"></p>' : '') +
                      '<div class="cme-ask-acts">' +
                        (opts.alert ? '' : '<button type="button" class="cme-b" data-ask="cancel">' + escapeHtml(opts.cancel || '취소') + '</button>') +
                        '<button type="button" class="cme-b ' + (opts.tone === 'danger' ? 'danger' : 'primary') + '" data-ask="ok"></button>' +
                      '</div>' +
                    '</div>';
                var okBtn = layer.querySelector('[data-ask="ok"]');
                var swBtn = layer.querySelector('[data-ask="backup"]');
                var noteEl = layer.querySelector('[data-role="backup-note"]');
                function sync() {
                    okBtn.textContent = bk ? (backupOn ? bk.okOn : bk.okOff) : (opts.ok || '확인');
                    if (swBtn) swBtn.setAttribute('aria-checked', backupOn ? 'true' : 'false');
                    if (noteEl) noteEl.textContent = backupOn ? bk.noteOn : bk.noteOff;
                }
                function done(ok) {
                    if (askDone !== done) return;
                    askDone = null;
                    layer.remove();
                    try { if (before && before.isConnected && before.focus) before.focus(); } catch (e) {}
                    resolve({ ok: !!ok, backup: !!ok && backupOn });
                }
                layer.addEventListener('click', function (e) {
                    if (e.target === layer) { if (!opts.alert) done(false); return; }
                    var b = e.target.closest('[data-ask]');
                    if (!b) return;
                    if (b.dataset.ask === 'backup') { backupOn = !backupOn; sync(); }
                    else done(b.dataset.ask === 'ok' || opts.alert);
                });
                askDone = done;
                sync();
                modalEl.appendChild(layer);
                try { okBtn.focus(); } catch (e) {}
            });
        }

        // 확인만 받는 시트. 문구는 0.6.3 확인창 문구 그대로 쓴다.
        function confirmSheet(title, message, ok, tone) {
            return ask({ title: title, message: message, ok: ok, tone: tone }).then(function (r) { return r.ok; });
        }

        async function close() {
            if (saving || askDone) return;
            if (hasUnsaved() && !(await confirmSheet('창 닫기', '저장하지 않은 변경이 ' + changedItems().length + '건 있습니다. 창을 닫을까요?', '닫기'))) return;
            if (saving) return;
            teardown();
            overlay.remove();
        }
        closeBtn.onclick = close;
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function onKey(e) {
            if (!overlay.isConnected) { document.removeEventListener('keydown', onKey); return; }
            if (e.key !== 'Escape') return;
            if (askDone) { e.preventDefault(); askDone(false); return; }   // 시트가 떠 있으면 시트만 취소
            if (!saving) { e.preventDefault(); close(); }
        });

        // ---------- 탭 ----------
        function setTab(name) {
            tab = name;
            var tabs = tabsEl.querySelectorAll('.cme-tab');
            for (var i = 0; i < tabs.length; i++) {
                var on = tabs[i].dataset.tab === name;
                tabs[i].classList.toggle('on', on);
                tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
            }
            var panes = bodyEl.querySelectorAll('[data-tabpane]');
            for (var j = 0; j < panes.length; j++) panes[j].hidden = panes[j].dataset.tabpane !== name;
            bodyEl.scrollTop = 0;
            if (name === 'strip') refreshInjCard();
            updateCounters();
        }
        tabsEl.addEventListener('click', function (e) {
            var b = e.target.closest('.cme-tab');
            if (b && b.dataset.tab !== tab) setTab(b.dataset.tab);
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
            if (!saving) saveBtn.textContent = '변경사항 저장';
            saveBtn.title = locked ? '읽기 전용입니다. 왼쪽 스위치로 편집을 켜세요.' :
                            bad ? '본문이 빈 항목이 있어 저장할 수 없습니다.' :
                            ch ? ch + '건을 서버에 저장합니다.' : '저장할 변경이 없습니다.';
            resetAllBtn.disabled = locked || saving || ch === 0;
            exportBtn.disabled = saving || items.length === 0;
            exportBtn.textContent = 'JSON 내보내기 (' + SCOPE_LABEL[view] + ')';
            exportBtn.title = '지금 보고 있는 섹션만 내보냅니다. 검색어·[변경분만]은 무시합니다.';
            importBtn.disabled = locked || saving || items.length === 0;
            importBtn.title = locked ? '잠금을 해제해야 불러올 수 있습니다' : '내보낸 JSON을 고쳐서 되돌려 넣습니다';
            verifyBtn.disabled = saving || !loadStats;
            previewBtn.disabled = saving;
            if (locked) applyBtn.disabled = true;
            injScanBtn.disabled = saving || items.length === 0;
            injApplyBtn.disabled = locked || saving || !injPlan || !pickedTargets().length;
            lockBtn.innerHTML = icon(locked ? IC_LOCK : IC_UNLOCK, 16) + '<span>' + (locked ? '읽기 전용' : '편집 중') + '</span>';
            lockBtn.setAttribute('aria-checked', locked ? 'false' : 'true');
            lockBtn.setAttribute('aria-label', locked ? '읽기 전용 (누르면 편집을 켭니다)' : '편집 중 (누르면 읽기 전용으로 잠급니다)');
            lockBtn.title = locked ? '클릭하면 편집·저장이 열립니다' : '클릭하면 다시 읽기 전용으로 잠급니다';
            lockBtn.disabled = saving;
            var bots = items.filter(function (m) { return m.role === 'assistant'; }).length;
            var users = items.length - bots;
            segEl.querySelector('[data-n="bot"]').textContent = nf(bots);
            segEl.querySelector('[data-n="user"]').textContent = nf(users);
            segEl.querySelector('[data-n="all"]').textContent = nf(items.length);
            statEl.textContent = '총 ' + nf(items.length) + '개' +
                (ch ? ' · 수정 ' + ch + '건' : '') + (bad ? ' · 빈 본문 ' + bad + '건' : '');
            statusEl.innerHTML = '<span>변경 ' + nf(ch) + '개</span>' +
                '<span' + (bad ? ' class="bad"' : '') + '>잘못된 것 ' + nf(bad) + '개</span>';
            findScopeEl.textContent = '대상: 「목록」 탭의 구분·검색·변경분만 조건에 맞는 메시지 ' + nf(filtered().length) + '개 (' +
                SCOPE_LABEL[view] + ')' + (locked ? ' · 읽기 전용이라 미리보기만 됩니다' : '');
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

        // 폰의 「차이」 탭: 바뀐 구간만 앞뒤 문맥과 함께 (지운 것은 취소선, 넣은 것은 형광)
        function diffHtml(orig, draft) {
            orig = String(orig); draft = String(draft);
            if (orig === draft) return '<span class="cme-stat">원문과 같습니다.</span>';
            var c = affix(orig, draft), CTX = 80;
            var head = orig.slice(Math.max(0, c.pre - CTX), c.pre);
            var tail = orig.slice(orig.length - c.suf, Math.min(orig.length, orig.length - c.suf + CTX));
            return (c.pre > CTX ? '…' : '') + escapeHtml(head) +
                   '<del>' + escapeHtml(orig.slice(c.pre, orig.length - c.suf)) + '</del>' +
                   '<ins>' + escapeHtml(draft.slice(c.pre, draft.length - c.suf)) + '</ins>' +
                   escapeHtml(tail) + (c.suf > CTX ? '…' : '');
        }

        function deltaText(m) {
            if (m.draft === m.original) return '원문과 같음';
            var d = m.draft.length - m.original.length;
            return '변경됨 · ' + nf(m.original.length) + '자 → ' + nf(m.draft.length) + '자 (' +
                   (d >= 0 ? '+' : '−') + nf(Math.abs(d)) + ')';
        }

        // ---------- 렌더 ----------
        function hasInjected(m) {
            if (m.role === 'assistant') return false;
            var sig = enabledFormats().map(function (f) { return f.id; }).join(',');
            var c = injCache[m._id];
            if (c && c.draft === m.draft && c.sig === sig) return c.has;
            var r = scanInjected(m.draft, enabledFormats());
            var has = r.blocks.length > 0;
            injCache[m._id] = { draft: m.draft, sig: sig, has: has };
            return has;
        }

        function tagsHtml(m, changed, invalid) {
            return (invalid ? '<span class="cme-tag err">빈 본문</span>' : changed ? '<span class="cme-tag mod">수정됨</span>' : '') +
                   (hasInjected(m) ? '<span class="cme-tag inj">주입 블록</span>' : '') +
                   '<span class="cme-len" data-role="rowlen">' + nf(String(m.draft).length) + '자</span>';
        }

        function rowHtml(m) {
            var changed = m.draft !== m.original;
            var invalid = changed && !String(m.draft).trim();
            var isBot = m.role === 'assistant';
            var open = !!openIds[m._id];
            var show = paneOf[m._id] || 'edit';
            var h = '<div class="cme-row' + (invalid ? ' invalid' : changed ? ' changed' : '') + '" data-id="' + m._id + '">' +
                '<div class="cme-line" data-act="toggle" role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') + '">' +
                  '<div class="cme-top">' +
                    '<span class="cme-idx">#' + m.index + '</span>' +
                    '<span class="cme-role ' + (isBot ? 'bot' : 'user') + '">' + (isBot ? 'AI' : '나') + '</span>' +
                    '<span class="cme-tags" data-role="tags">' + tagsHtml(m, changed, invalid) + '</span>' +
                  '</div>' +
                  '<div class="cme-body-col"><div class="cme-text">' + escapeHtml(preview(m.draft, 400)) + '</div>' +
                    '<div class="cme-meta">_id …' + shortId(m._id) + ' · turn …' + shortId(m.turnId) +
                    (m.reroll ? ' · reroll' : '') + (m.status && m.status !== 'done' ? ' · ' + escapeHtml(m.status) : '') +
                    '</div></div>' +
                '</div>';
            if (open) {
                h += '<div class="cme-edit" data-show="' + show + '">' +
                       '<div class="cme-minitabs" role="tablist">' +
                         ['orig', 'edit', 'diff'].map(function (k) {
                             return '<button type="button" class="cme-segb' + (show === k ? ' active' : '') + '" data-act="pane" data-pane-to="' + k + '">' +
                                    ({ orig: '원문', edit: '편집', diff: '차이' })[k] + '</button>';
                         }).join('') +
                       '</div>' +
                       '<div class="cme-panes">' +
                         '<div class="cme-pane" data-pane="orig">' +
                           '<div class="cme-pane-h">원문 (서버에 저장된 내용)' +
                             '<span class="cme-stat">' + nf(String(m.original).length) + '자</span></div>' +
                           '<div class="cme-orig" data-role="orig">' + markedHtml(m.original, m.draft) + '</div>' +
                         '</div>' +
                         '<div class="cme-pane" data-pane="edit">' +
                           '<div class="cme-pane-h">' + (changed ? '변경될 내용' : '편집') +
                             (locked ? ' · 읽기 전용' : '') +
                             '<span class="cme-stat" data-role="len">' + nf(String(m.draft).length) + '자</span></div>' +
                           '<textarea data-act="draft" spellcheck="false"' + (locked ? ' readonly' : '') + '>' +
                             escapeHtml(m.draft) + '</textarea>' +
                         '</div>' +
                         '<div class="cme-pane" data-pane="diff">' +
                           '<div class="cme-pane-h">차이 (지운 것 취소선 · 넣은 것 형광)</div>' +
                           '<div class="cme-diffbox" data-role="diff">' + diffHtml(m.original, m.draft) + '</div>' +
                         '</div>' +
                       '</div>' +
                       '<div class="cme-edit-bar">' +
                         '<button type="button" class="cme-b danger" data-act="restore"' + (locked || !changed ? ' disabled' : '') + '>이 항목 원복</button>' +
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
                html += '<div class="cme-empty"><button type="button" class="cme-b" id="cme-more">' +
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
                delete injUndo[m._id];
                render();
                return;
            }
            if (name === 'pane') {
                paneOf[m._id] = act.dataset.paneTo;
                render();
                return;
            }
            if (name === 'toggle') {
                if (openIds[m._id]) delete openIds[m._id];
                else openIds[m._id] = true;
                render();
            }
        });
        listEl.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.cme-line')) {
                e.preventDefault();
                e.target.click();
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
            var diffEl = rowEl.querySelector('[data-role="diff"]');
            if (diffEl) diffEl.innerHTML = diffHtml(m.original, m.draft);
            var tagsEl = rowEl.querySelector('[data-role="tags"]');
            if (tagsEl) tagsEl.innerHTML = tagsHtml(m, changed, invalid);
            var restoreBtn = rowEl.querySelector('[data-act="restore"]');
            if (restoreBtn) restoreBtn.disabled = !changed;
            var textEl = rowEl.querySelector('.cme-text');
            if (textEl) textEl.textContent = preview(m.draft, 400);
            updateCounters();
        });

        searchEl.addEventListener('input', function () { renderLimit = RENDER_CHUNK; render(); });
        changedOnlyEl.addEventListener('change', function () { renderLimit = RENDER_CHUNK; render(); });

        // 섹션 전환 (AI 답변 / 내 메시지 / 전체)
        segEl.addEventListener('click', function (e) {
            var b = e.target.closest('.cme-segb');
            if (!b || b.dataset.view === view) return;
            setView(b.dataset.view);
        });

        function setView(v) {
            view = v;
            for (var i = 0; i < segBtns.length; i++) segBtns[i].classList.toggle('active', segBtns[i].dataset.view === v);
            if (view === 'user' && !warnedUser) {
                warnedUser = true;
                log('내 메시지 구간입니다. 저장 방식은 AI 답변과 같지만, 이 구간에서 저장을 시험해 본 적은 아직 없습니다. ' +
                    '한 건만 먼저 고쳐서 반영되는지 확인한 뒤 나머지를 손대세요.');
            }
            renderLimit = RENDER_CHUNK;
            render();
            if (tab === 'strip') refreshInjCard();
        }

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

        // 어느 메시지가 바뀌는지 번호로 보여준다.
        // 손으로 채워 넣은 설정 블록 같은 걸 모른 채 덮어쓰는 사고를 막기 위한 것.
        function planNumbers(plan, max) {
            var nums = plan.map(function (p) { return '#' + p.m.index + '(' + p.n + ')'; });
            if (nums.length <= max) return nums.join(' ');
            return nums.slice(0, max).join(' ') + ' … 외 ' + nf(nums.length - max) + '개';
        }

        function resetFind() {
            pendingReplace = null;
            applyBtn.disabled = true;
            findStatEl.textContent = '';
            findPlanEl.textContent = '';
        }

        previewBtn.onclick = function () {
            pendingReplace = null;
            applyBtn.disabled = true;
            findPlanEl.textContent = '';
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
                plan.push({ m: m, next: next, n: n });
            });
            if (!hitMsgs) { findStatEl.textContent = '일치하는 내용이 없습니다.'; return; }
            findStatEl.textContent = '메시지 ' + hitMsgs + '개 · ' + hitCount + '곳이 바뀝니다' +
                (locked ? ' (읽기 전용 — 적용하려면 잠금 해제)' : '');
            findPlanEl.textContent = '바뀌는 메시지(괄호 안은 횟수): ' + planNumbers(plan, 60);
            log('찾기/바꾸기 미리보기 — ' + SCOPE_LABEL[view] + ' 중 메시지 ' +
                nf(hitMsgs) + '개 · ' + nf(hitCount) + '곳');
            log('   ' + planNumbers(plan, 20));
            log('   ↑ 괄호 안은 그 메시지에서 바뀌는 횟수입니다. 손대면 안 되는 번호가 없는지 확인하세요.');
            pendingReplace = plan;
            applyBtn.disabled = locked;
        };

        applyBtn.onclick = async function () {
            if (locked) return;
            if (!pendingReplace || !pendingReplace.length) return;
            var plan = pendingReplace;
            if (!(await confirmSheet('찾기/바꾸기 적용', '메시지 ' + plan.length + '개의 본문을 바꿉니다.\n\n' +
                                planNumbers(plan, 12) + '\n\n' +
                                '아직 서버에 저장되지 않으며, 저장 전까지 전체 원복이 가능합니다.\n계속할까요?', '적용'))) return;
            if (locked || pendingReplace !== plan) return;     // 시트가 떠 있는 동안 조건이 바뀌었으면 하지 않는다
            log('✓ ' + nf(pendingReplace.length) + '개 적용됨 (미저장) — ' + planNumbers(pendingReplace, 20));
            pendingReplace.forEach(function (p) { p.m.draft = p.next; });
            findStatEl.textContent = pendingReplace.length + '개 적용됨 (미저장)';
            pendingReplace = null;
            applyBtn.disabled = true;
            render();
        };

        [findEl, replaceEl].forEach(function (el) { el.addEventListener('input', resetFind); });
        regexEl.addEventListener('change', resetFind);

        // ---------- 주입 블록 정리 ----------
        function enabledFormats() {
            var list = INJ_FORMATS.filter(function (f) { return fmtOn[f.id]; });
            if (dFormat && fmtOn.D) list.push(dFormat);
            return list;
        }

        function userTargets() {
            return items.filter(function (m) { return m.role !== 'assistant'; });
        }

        function pickedTargets() {
            return injPlan ? injPlan.targets.filter(function (t) { return t.pick && !t.applied; }) : [];
        }

        // 형식 목록(체크박스)과 D 형식·정리 기록 안내를 지금 상태로 다시 그린다.
        function refreshInjCard() {
            var lore = loreState();
            var d = customFormat(lore.config);
            var dChanged = JSON.stringify(d && d.pairs) !== JSON.stringify(dFormat && dFormat.pairs);
            dFormat = d;
            if (dChanged) fmtOn.D = !!d;
            injDEl.innerHTML = fmtRowHtml(d || { id: 'D', on: false, when: '인젝터 설정의 커스텀 형식', pairs: [] }, !d);
            syncFmtChecks();
            var journal = readCleanupJournal().filter(function (it) { return !it.chatId || it.chatId === getChatId(); });
            injExactRow.hidden = !journal.length;
            injExactNEl.textContent = journal.length ? '(기록 ' + nf(journal.length) + '건)' : '';
            injScopeEl.hidden = view !== 'bot';
            injScopeEl.innerHTML = '지금은 「AI 답변」 구분입니다. 주입 블록 정리는 <b>내 메시지</b>만 대상으로 합니다(AI 답변은 건드리지 않음). ' +
                '<button type="button" class="cme-b" data-act="to-user">내 메시지 보기로</button>';
        }

        function fmtRowHtml(f, disabled) {
            var pairs = f.pairs || [];
            var openTxt = pairs.map(function (p) { return p[0]; }).join('  /  ');
            var closeTxt = pairs.map(function (p) { return p[1] === null ? '(없음 — 첫 빈 줄/메시지 끝까지)' : p[1]; }).join('  /  ');
            var body = f.id === 'D' && disabled
                ? '<small>인젝터 설정(lore-injector-v5)에 목록과 다른 커스텀 여는 문구가 없습니다.</small>'
                : '<code>' + escapeHtml(openTxt.length > 160 ? openTxt.slice(0, 160) + '…' : openTxt) + '</code>' +
                  '<small>닫는 문구 <code>' + escapeHtml(closeTxt) + '</code> · ' + escapeHtml(f.when || '') + '</small>';
            return '<div class="cme-fmt' + (f.on ? '' : ' is-off') + '" data-fmt-row="' + f.id + '">' +
                   '<label class="cme-check"><input type="checkbox" data-fmt="' + f.id + '"' + (f.on ? ' checked' : '') +
                   (disabled ? ' disabled' : '') + '> <b>' + f.id + '</b></label>' + body + '</div>';
        }

        function syncFmtChecks() {
            var boxes = overlay.querySelectorAll('input[data-fmt]');
            var on = 0, total = 0;
            for (var i = 0; i < boxes.length; i++) {
                var id = boxes[i].dataset.fmt;
                boxes[i].checked = !!fmtOn[id] && !boxes[i].disabled;
                var row = boxes[i].closest('.cme-fmt');
                if (row) row.classList.toggle('is-off', !boxes[i].checked);
                if (!boxes[i].disabled) { total++; if (boxes[i].checked) on++; }
            }
            injFmtsSumEl.textContent = '알아보는 형식 (켬 ' + on + ' / ' + total + ')';
        }

        overlay.querySelector('#cme-inj-fmtlist').addEventListener('change', function (e) {
            var b = e.target;
            if (!b.dataset || !b.dataset.fmt) return;
            fmtOn[b.dataset.fmt] = b.checked;
            syncFmtChecks();
            injCache = {};
            if (injPlan) runInjScan();
        });
        injRecentEl.addEventListener('change', function () { if (injPlan) runInjScan(); });
        injExactEl.addEventListener('change', function () { if (injPlan) runInjScan(); });
        injScopeEl.addEventListener('click', function (e) {
            if (e.target.closest('[data-act="to-user"]')) setView('user');
        });

        injScanBtn.onclick = function () { runInjScan(); };

        function runInjScan() {
            refreshInjCard();
            var lore = loreState();
            var fmts = enabledFormats();
            var fmtsOld = fmts.filter(function (f) { return !f.current; });
            var skipRecent = lore.on && !injRecentEl.checked;
            var users = userTargets();
            var recentFrom = skipRecent ? Math.max(0, users.length - lore.turns) : users.length;
            var journal = injExactEl.checked ? readCleanupJournal() : [];
            var chatId = getChatId();

            injLoreEl.hidden = !lore.on;
            injLoreTextEl.textContent = '로어 인젝터가 켜져 있어 최근 ' + lore.turns + '턴은 인젝터가 정리합니다.' +
                (lore.version ? ' (' + lore.version + ')' : '');

            var targets = [], held = [], recentSkipped = [], byFmt = {}, blocksN = 0, cutN = 0, deltaN = 0;
            var warn = { unclosed: 0, uncertain: 0, middle: 0, empty: 0 };
            users.forEach(function (m, idx) {
                var recent = idx >= recentFrom;
                var cur = String(m.draft);
                var jr = journalMatch(journal, m, chatId);
                if (jr && recent) { recentSkipped.push({ m: m, n: 1 }); return; }
                var full = scanInjected(cur, fmts);
                var res = recent ? scanInjected(cur, fmtsOld) : full;
                var skippedHere = recent ? full.blocks.filter(function (b) { return b.fmt.current; }).length : 0;
                if (skippedHere) recentSkipped.push({ m: m, n: skippedHere });
                var t;
                if (jr) {
                    var jFmt = scanInjected(String(jr.injectedText || '').trim(), INJ_FORMATS.concat(dFormat ? [dFormat] : [])).blocks;
                    t = { m: m, next: jr.originalText, blocks: [{ fmt: { id: jFmt.length ? jFmt[0].fmt.id : '기록' }, where: 'exact',
                          start: 0, end: 0 }], issues: [], cut: Math.max(0, cur.length - jr.originalText.length), exact: true };
                } else {
                    if (!res.blocks.length && !res.issues.length) return;
                    t = { m: m, next: res.text, blocks: res.blocks, issues: res.issues, cut: res.cut, exact: false };
                }
                t.src = cur;          // 찾은 때의 초안 — 적용 직전에 그대로인지 본다
                t.empty = t.blocks.length > 0 && !String(t.next).trim();
                t.middle = t.blocks.some(function (b) { return b.where === 'middle'; });
                t.issues.forEach(function (i) { warn[i.kind]++; });
                if (t.middle) warn.middle += t.blocks.filter(function (b) { return b.where === 'middle'; }).length;
                if (t.empty) { warn.empty++; held.push(t); return; }
                if (!t.blocks.length) { held.push(t); return; }
                t.pick = true;
                t.applied = false;
                targets.push(t);
                blocksN += t.blocks.length;
                cutN += t.cut;
                deltaN += cur.length - t.next.length;
                t.blocks.forEach(function (b) { byFmt[b.fmt.id] = (byFmt[b.fmt.id] || 0) + 1; });
            });
            injPlan = { targets: targets, held: held, recentSkipped: recentSkipped, byFmt: byFmt, blocks: blocksN,
                        cut: cutN, delta: deltaN, warn: warn, lore: lore, skipRecent: skipRecent };
            renderInjPlan();
            log('주입 블록 찾기 — 대상 메시지 ' + nf(targets.length) + '개 · 블록 ' + nf(blocksN) + '개 · ' + nf(cutN) + '자' +
                (Object.keys(byFmt).length ? ' · ' + fmtCounts(byFmt) : '') +
                (recentSkipped.length ? ' · 최근 턴 건너뜀 ' + recentSkipped.length + '개' : ''));
            updateCounters();
        }

        function fmtCounts(byFmt) {
            return Object.keys(byFmt).sort().map(function (k) { return k + ' ' + nf(byFmt[k]); }).join(' · ');
        }

        function injDetail(t) {
            var ids = {};
            t.blocks.forEach(function (b) { ids[b.fmt.id] = (ids[b.fmt.id] || 0) + 1; });
            var s = Object.keys(ids).map(function (k) { return k + (ids[k] > 1 ? '×' + ids[k] : ''); }).join(' + ');
            var flags = [];
            if (t.exact) flags.push('정확히 맞음(인젝터 기록)');
            if (t.middle) flags.push('중간에 있음');
            if (t.blocks.some(function (b) { return b.where === 'tail'; })) flags.push('글 뒤');
            t.issues.forEach(function (i) { flags.push(i.fmt.id + ' ' + (i.kind === 'unclosed' ? '닫는 줄 없음' : '경계 불확실')); });
            if (t.empty) flags.push('본문이 빔');
            return { fmt: s, flags: flags };
        }

        function renderInjPlan() {
            var p = injPlan;
            if (!p) { injSumEl.innerHTML = ''; injListEl.innerHTML = ''; return; }
            var w = p.warn;
            var warnBits = [];
            if (w.unclosed) warnBits.push('닫는 줄 없음 ' + w.unclosed);
            if (w.middle) warnBits.push('중간에 있음 ' + w.middle);
            if (w.uncertain) warnBits.push('경계 불확실 ' + w.uncertain);
            if (w.empty) warnBits.push('본문이 빔 ' + w.empty);
            injSumEl.innerHTML =
                '<div>대상 메시지 <b data-inj="msgs">' + nf(p.targets.length) + '</b>개 · 블록 <b data-inj="blocks">' + nf(p.blocks) +
                '</b>개 · 지워질 글자 <b data-inj="chars">' + nf(p.cut) + '</b>자' +
                (p.delta !== p.cut ? ' <span class="cme-stat">(빈 줄 포함 ' + nf(p.delta) + '자 줄어듦)</span>' : '') + '</div>' +
                '<div>형식별: <span data-inj="fmts">' + (Object.keys(p.byFmt).length ? escapeHtml(fmtCounts(p.byFmt)) : '없음') + '</span></div>' +
                '<div' + (warnBits.length ? ' class="cme-warn"' : '') + '>경고: <span data-inj="warn">' +
                (warnBits.length ? warnBits.join(' · ') : '없음') + '</span></div>' +
                (p.recentSkipped.length ? '<div>최근 ' + p.lore.turns + '턴이라 건너뜀: <span data-inj="recent">' +
                    nf(p.recentSkipped.reduce(function (a, r) { return a + r.n; }, 0)) + '</span>개 블록 (' +
                    p.recentSkipped.map(function (r) { return '#' + r.m.index; }).join(' ') + ')</div>' : '') +
                (p.targets.length ? '<div class="cme-stat">행마다 체크를 풀면 그 메시지는 빼고 적용합니다. 「비교」로 지워질 부분(취소선)을 확인하세요.' +
                    (locked ? ' 적용하려면 아래 스위치로 편집을 켜세요.' : '') + '</div>' : '');

            var h = p.targets.map(injItemHtml).join('');
            if (p.held.length) {
                h += '<div class="cme-sub">지우지 않는 메시지 (' + nf(p.held.length) + ')</div>' +
                     '<p class="cme-hint">닫는 줄이 없거나 경계가 불확실하거나, 지우면 본문이 비는 메시지입니다. 손대지 않습니다.</p>' +
                     p.held.map(injItemHtml).join('');
            }
            if (!p.targets.length && !p.held.length) h = '<div class="cme-empty">찾은 주입 블록이 없습니다.</div>';
            injListEl.innerHTML = h;
        }

        function injItemHtml(t) {
            var d = injDetail(t);
            var held = !t.blocks.length || t.empty;
            var info = '<b>#' + t.m.index + '</b> · ' + (d.fmt || '블록 없음') +
                       (t.cut ? ' · ' + nf(t.cut) + '자' : '') +
                       (d.flags.length ? ' · <span class="cme-warn">' + escapeHtml(d.flags.join(' · ')) + '</span>' : '');
            return '<div class="cme-inj-item' + (t.applied ? ' is-applied' : '') + '" data-inj-id="' + t.m._id + '"' +
                       (held ? ' data-held="1"' : '') + '>' +
                     '<div class="cme-inj-head">' +
                       (held
                           ? '<span class="cme-grow">' + info + '</span>'
                           : '<label class="cme-check"><input type="checkbox" data-act="inj-pick"' + (t.pick ? ' checked' : '') +
                             (t.applied ? ' disabled' : '') + '> <span>' + info + '</span></label>') +
                       '<button type="button" class="cme-b" data-act="inj-view" aria-expanded="false">비교</button>' +
                       (t.applied && injUndo.hasOwnProperty(t.m._id)
                           ? '<button type="button" class="cme-b danger" data-act="inj-undo"' + (locked ? ' disabled' : '') + '>되돌리기</button>' : '') +
                     '</div>' +
                     '<div class="cme-inj-view" data-role="inj-view" hidden></div>' +
                   '</div>';
        }

        // 원문 비교: 지워질 부분을 취소선으로. 정확히 맞음 모드는 앞뒤 공통부분을 뺀 가운데를 표시한다.
        function injViewHtml(t) {
            var cur = String(t.src != null ? t.src : t.m.draft);
            if (t.exact || !t.blocks.length) {
                if (!t.blocks.length) {
                    return t.issues.map(function (i) {
                        return '<div class="cme-warn">' + i.fmt.id + ' ' + (i.kind === 'unclosed' ? '닫는 줄 없음' : '경계 불확실') +
                               ' — ' + nf(i.start) + '번째 글자부터</div>';
                    }).join('') + escapeHtml(cur.slice(0, 1500)) + (cur.length > 1500 ? '…' : '');
                }
                var c = affix(cur, t.next);
                return escapeHtml(cur.slice(0, c.pre)) + '<del class="cme-cut">' + escapeHtml(cur.slice(c.pre, cur.length - c.suf)) +
                       '</del>' + escapeHtml(cur.slice(cur.length - c.suf));
            }
            var out = '', last = 0;
            t.blocks.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (b) {
                out += escapeHtml(cur.slice(last, b.start)) + '<del class="cme-cut" title="' + b.fmt.id +
                       (b.where === 'middle' ? ' · 중간에 있음' : '') + '">' + escapeHtml(cur.slice(b.start, b.end)) + '</del>';
                last = b.end;
            });
            return out + escapeHtml(cur.slice(last));
        }

        function injTarget(id) {
            if (!injPlan) return null;
            var all = injPlan.targets.concat(injPlan.held);
            for (var i = 0; i < all.length; i++) if (all[i].m._id === id) return all[i];
            return null;
        }

        injListEl.addEventListener('click', function (e) {
            var itemEl = e.target.closest('[data-inj-id]');
            if (!itemEl) return;
            var t = injTarget(itemEl.dataset.injId);
            if (!t) return;
            var act = e.target.closest('[data-act]');
            var name = act && act.dataset.act;
            if (name === 'inj-view') {
                var v = itemEl.querySelector('[data-role="inj-view"]');
                var open = v.hidden;
                if (open) v.innerHTML = injViewHtml(t);
                v.hidden = !open;
                act.setAttribute('aria-expanded', open ? 'true' : 'false');
                act.textContent = open ? '비교 닫기' : '비교';
            } else if (name === 'inj-undo') {
                if (locked || !t.applied || !injUndo.hasOwnProperty(t.m._id)) return;
                t.m.draft = injUndo[t.m._id];
                delete injUndo[t.m._id];
                t.applied = false;
                t.pick = false;
                log('주입 블록 정리 되돌림 — #' + t.m.index + ' (미저장)');
                renderInjPlan();
                render();
            }
        });
        injListEl.addEventListener('change', function (e) {
            if (!e.target.matches('[data-act="inj-pick"]')) return;
            var t = injTarget(e.target.closest('[data-inj-id]').dataset.injId);
            if (t) t.pick = e.target.checked;
            updateCounters();
        });

        injApplyBtn.onclick = async function () {
            if (locked || saving) return;
            var picks = pickedTargets();
            if (!picks.length) return;
            var nBlocks = picks.reduce(function (a, t) { return a + t.blocks.length; }, 0);
            if (!(await confirmSheet('주입 블록 정리 적용', '내 메시지 ' + picks.length + '개에서 주입 블록 ' + nBlocks + '개를 지웁니다.\n\n' +
                                picks.slice(0, 12).map(function (t) { return '#' + t.m.index; }).join(' ') +
                                (picks.length > 12 ? ' … 외 ' + (picks.length - 12) + '개' : '') + '\n\n' +
                                '초안만 바뀌고 서버에는 아직 보내지 않습니다. 행마다 되돌릴 수 있습니다.\n계속할까요?', '적용'))) return;
            if (locked || saving) return;
            picks = picks.filter(function (t) { return t.pick && !t.applied; });
            // 찾은 뒤 초안이 바뀐 메시지는 건너뛴다(찾기 결과가 낡음).
            var stale = picks.filter(function (t) { return t.src !== t.m.draft; });
            var done = 0;
            picks.forEach(function (t) {
                if (stale.indexOf(t) >= 0) return;
                injUndo[t.m._id] = t.m.draft;
                t.m.draft = t.next;
                t.applied = true;
                done++;
            });
            log('✓ 주입 블록 정리 ' + nf(done) + '개 적용됨 (미저장) — ' +
                picks.slice(0, 20).map(function (t) { return '#' + t.m.index; }).join(' ') + (picks.length > 20 ? ' …' : ''));
            if (stale.length) log('⚠ 찾은 뒤 초안이 바뀐 ' + stale.length + '개는 건너뛰었습니다. 다시 찾기를 누르세요.');
            renderInjPlan();
            render();
        };

        // ---------- 백업 / 원복 ----------
        function scopedItems(scope) {
            if (scope === 'bot') return items.filter(function (m) { return m.role === 'assistant'; });
            if (scope === 'user') return items.filter(function (m) { return m.role !== 'assistant'; });
            return items;
        }

        // 파일명: {스토리이름}_{구분}_{chatId앞6}_{로컬시각}.json
        // 이름을 못 가져오면 chatId 전체로 떨어진다 (구분할 단서가 그것뿐이므로).
        function makeFileName(label) {
            var name = safeFileName(storyName, 30);
            var id = String(getChatId() || 'chat');
            var parts = [];
            if (name) parts.push(name);
            parts.push(label);
            parts.push(name ? id.slice(0, 6) : id);
            parts.push(stampLocal());
            return parts.join('_') + '.json';
        }

        // scope를 생략하면 항상 전체. 저장 직전 자동 백업은 반드시 전체여야 한다.
        function backupPayload(tag, scope) {
            scope = scope || 'all';
            var list = scopedItems(scope);
            return {
                exportedAt: new Date().toISOString(),   // 이쪽은 UTC ISO 그대로 (기계용)
                reason: tag,
                scope: scope,
                chatId: getChatId(),
                storyName: storyName,
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
            var fname = makeFileName(SCOPE_SLUG[view]);
            downloadJson(backupPayload('manual', view), fname);
            log('JSON 내보내기 — ' + SCOPE_LABEL[view] + ' ' + nf(n) + '개' +
                (view === 'all' ? '' : ' (검색·필터와 무관하게 이 섹션 전부)'));
            log('   ' + fname);
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
                    clearLog();
                    log('✗ JSON을 읽지 못했습니다: ' + err.message, { open: true });
                    return;
                }
                applyImport(payload, f.name);
            };
            reader.onerror = function () { log('✗ 파일을 읽지 못했습니다.', { open: true }); };
            reader.readAsText(f, 'utf-8');
        };

        async function applyImport(payload, fileName) {
            clearLog();
            log('JSON 불러오기 — ' + fileName, { open: true });

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

            if (!(await confirmSheet('JSON 적용', '메시지 ' + plan.length + '건의 본문을 파일 내용으로 바꿉니다.\n\n' +
                                '아직 서버에 저장되지 않습니다.\n' +
                                '[변경분만] 체크로 확인한 뒤 [변경사항 저장]을 눌러야 반영됩니다.\n\n계속할까요?', '적용'))) {
                log('취소했습니다.');
                return;
            }
            if (locked || saving) { log('취소했습니다.'); return; }

            plan.forEach(function (p) { p.m.draft = p.next; });
            changedOnlyEl.checked = true;
            renderLimit = RENDER_CHUNK;
            render();
            log('✓ ' + nf(plan.length) + '건 적용됨 (미저장). 「목록」 탭에서 확인 후 [변경사항 저장]을 누르세요.');
        }

        // ---------- 새로고침 ----------
        refreshBtn.onclick = async function () {
            if (saving) return;
            if (hasUnsaved() && !(await confirmSheet('새로고침', '저장하지 않은 변경 ' + changedItems().length + '건이 있습니다.\n' +
                                                '새로고침하면 사라집니다. 계속할까요?', '새로고침', 'danger'))) return;
            location.reload();
        };

        // ---------- 잠금 / 읽기 검증 ----------
        lockBtn.onclick = async function () {
            if (saving) return;
            if (locked) {
                if (!(await confirmSheet('편집 허용', '편집을 허용합니다.\n\n' +
                    '이 상태에서는 본문 수정과 서버 저장이 가능해집니다.\n' +
                    '저장은 되돌리기 어려우니, 먼저 「백업」 탭의 [JSON 내보내기]로 원본을 받아두시길 권합니다.\n\n계속할까요?', '편집 허용'))) return;
                if (!locked || saving) return;
                locked = false;
                log('편집 잠금이 해제되었습니다.');
            } else {
                if (hasUnsaved() && !(await confirmSheet('읽기 전용으로 잠그기', '저장하지 않은 변경 ' + changedItems().length + '건이 있습니다.\n' +
                    '잠그면 수정할 수 없게 되지만 변경 내용은 그대로 남습니다. 계속할까요?', '잠그기'))) return;
                if (locked || saving) return;
                locked = true;
                log('읽기 전용으로 잠갔습니다.');
            }
            if (pendingReplace) applyBtn.disabled = locked;
            render();
            if (injPlan) renderInjPlan();
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
            if (!chatMeta) {
                L.push('방 이름: 조회 실패 — 파일명은 chatId만 씁니다');
            } else if (storyName) {
                L.push('방 이름: ' + JSON.stringify(storyName) + '  (story.name)');
                L.push('파일명 예: ' + makeFileName(SCOPE_SLUG[view]));
            } else {
                L.push('방 이름: story.name이 비어 있습니다 — 파일명은 chatId만 씁니다');
                var alt = [];
                if (chatMeta.characterName) alt.push('character.name = ' + JSON.stringify(chatMeta.characterName));
                if (chatMeta.plainName) alt.push('name = ' + JSON.stringify(chatMeta.plainName));
                if (alt.length) L.push('  참고 — 이 방에 있는 다른 이름: ' + alt.join(' · '));
            }
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
            L.push('섹션 분포: AI 답변 ' + nf(botN) + ' / 내 메시지 ' + nf(items.length - botN) +
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
            clearLog();
            log(L.join('\n'), { open: true });
        };

        resetAllBtn.onclick = async function () {
            if (locked) return;
            var ch = changedItems().length;
            if (!ch) return;
            if (!(await confirmSheet('전체 원복', '수정한 ' + ch + '건을 모두 원본으로 되돌릴까요?', '모두 원복', 'danger'))) return;
            if (locked || saving) return;
            items.forEach(function (m) { m.draft = m.original; });
            injUndo = {};
            if (injPlan) { injPlan.targets.forEach(function (t) { t.applied = false; }); renderInjPlan(); }
            render();
        };

        // ---------- 화면(테마) ----------
        function markTheme() {
            var cur = currentThemeName();
            var bs = themesEl.querySelectorAll('[data-theme-name]');
            for (var i = 0; i < bs.length; i++) {
                var on = bs[i].dataset.themeName === cur;
                bs[i].classList.toggle('on', on);
                bs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
            }
        }
        themesEl.addEventListener('click', function (e) {
            var b = e.target.closest('[data-theme-name]');
            if (!b) return;
            try { window.localStorage.setItem(THEME_STORE_KEY, b.dataset.themeName); } catch (err) {}
            injectStyles(true);
            markTheme();
        });
        markTheme();

        // ---------- 저장 ----------
        saveBtn.onclick = async function () {
            if (saving || askDone) return;
            if (locked) {
                await ask({ title: '읽기 전용', message: '읽기 전용 상태입니다. 아래 [읽기 전용] 스위치로 잠금을 해제하세요.', alert: true });
                return;
            }
            var targets = changedItems();
            if (!targets.length) return;
            if (invalidItems().length) {
                await ask({ title: '저장할 수 없음', message: '본문이 빈 항목이 있습니다. 먼저 채워주세요.', alert: true });
                return;
            }
            // 백업 여부는 사용자가 저장마다 고른다. 스위치 기본값만 BACKUP_MIN 기준
            // (몇 건 안 되면 끈 채로 — 매번 받으면 폴더만 늘고 정작 필요한 대량 작업 직전 백업을 찾기 어려워진다).
            var nBot = targets.filter(function (m) { return m.role === 'assistant'; }).length;
            var answer = await ask({
                title: '변경사항 저장',
                message: targets.length + '건을 서버에 저장합니다.',
                sub: 'AI 답변 ' + nBot + '건 · 내 메시지 ' + (targets.length - nBot) + '건',
                warn: '저장하면 서버의 본문이 바뀌어 되돌릴 수 없습니다.',
                backup: {
                    on: targets.length >= BACKUP_MIN,
                    label: '저장 직전 원본 백업 받기',
                    noteOn: '방 전체 원본(' + nf(items.length) + '개)을 JSON으로 먼저 내려받은 뒤 저장합니다.',
                    noteOff: '백업 파일을 만들지 않습니다.',
                    okOn: '백업 받고 저장',
                    okOff: '백업 없이 저장'
                }
            });
            if (!answer.ok || saving || locked) return;
            if (changedItems().length !== targets.length || invalidItems().length) return;   // 시트가 떠 있는 동안 바뀌었으면 하지 않는다
            var withBackup = answer.backup;

            if (withBackup) {
                // 범위는 항상 전체. 내려받기 요청이 실패하면 저장하지 않는다.
                try {
                    downloadJson(backupPayload('before-save'), makeFileName('저장전백업'));
                } catch (err) {
                    log('✗ 저장 직전 백업을 내려받지 못해 저장하지 않았습니다: ' + (err && err.message || err), { open: true });
                    await ask({ title: '저장하지 않았습니다', alert: true,
                                message: '저장 직전 원본 백업을 내려받지 못해 저장하지 않았습니다.\n' + (err && err.message || err),
                                sub: '초안은 그대로 있습니다. 다시 시도하거나, 백업 없이 저장을 고르세요.' });
                    return;
                }
            }

            saving = true;
            clearLog();
            log((withBackup ? '원본 백업을 내려받았습니다. ' : '') +
                '저장을 시작합니다… (' + targets.length + '건)', { open: true });
            updateCounters();
            closeBtn.disabled = true;

            var ok = 0, fail = 0, streak = 0;
            for (var i = 0; i < targets.length; i++) {
                var m = targets[i];
                saveBtn.textContent = '저장 중… ' + (i + 1) + '/' + targets.length;
                try {
                    await patchMessage(m._id, m.draft);
                    m.original = m.draft;   // 저장 성공분은 새 원본으로 승격
                    delete injUndo[m._id];
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
                bannerEl.hidden = false;
                bannerTextEl.textContent = '저장 ' + ok + '건' + (fail ? ' · 실패 ' + fail + '건' : '') +
                    ' — 크랙 화면에 반영하려면 기록을 확인한 뒤 새로고침하세요.';
                log('크랙 화면에 반영하려면 위 내용을 확인한 뒤 [↻ 새로고침]을 누르세요.');
            }
            if (injPlan) renderInjPlan();
            render();
        };

        // ---------- 로드 ----------
        async function load() {
            statEl.textContent = '불러오는 중…';
            listEl.innerHTML = '<div class="cme-empty">불러오는 중…</div>';
            try {
                // 방 이름은 실패해도 편집을 막지 않는다. 메시지 로딩과 같이 걸어둔다.
                var metaPromise = fetchChatMeta().catch(function () { return null; });
                var result = await fetchAllMessages(function (count, pages) {
                    statEl.textContent = nf(count) + '개 (' + pages + '페이지)…';
                });
                loadStats = result.stats;
                chatMeta = await metaPromise;
                storyName = (chatMeta && chatMeta.storyName) || '';
                if (storyName) { roomEl.textContent = storyName; roomEl.title = storyName; }
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
                log('읽기 전용 상태입니다. 「백업」 탭의 [읽기 검증]으로 수집이 온전한지 먼저 확인하세요.');
            } catch (err) {
                statEl.textContent = '실패';
                listEl.innerHTML = '<div class="cme-empty">불러오기 실패: ' + escapeHtml(err.message) + '</div>';
                log('✗ 불러오기 실패: ' + err.message);
            }
        }

        updateCounters();
        refreshInjCard();
        load();
    }

    // 테스트용 연결(테스트 페이지가 window.__CME_TEST_HOOK__를 켤 때만). 실제 크랙 화면에서는 아무것도 내놓지 않는다.
    try {
        if (window.__CME_TEST_HOOK__) {
            window.__CME__ = { scanInjected: scanInjected, INJ_FORMATS: INJ_FORMATS, customFormat: customFormat,
                               loreState: loreState, journalMatch: journalMatch };
        }
    } catch (e) {}

    // ============== 버튼 주입 ==============
    var headerWaitStartedAt = 0;
    var HEADER_WAIT_MS = 4000;

    function createButton() {
        var btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        // ★ 라벨·title에 다른 스크립트의 탐색 키워드를 넣지 말 것.
        //   모바일 유틸은 textContent/aria-label/title/data-tooltip/data-label을 한 덩어리로 묶어
        //   느슨한 정규식으로 버튼을 찾아 대신 누른다. 예전 라벨 '✏️ 출력물'이 사이드바
        //   [출력량 조절]의 2차 패턴 /출력/에 걸려서, 그 버튼이 이 편집기를 열어버렸다.
        //   피해야 할 단어: 출력 · 가이드 · 프로필 · 노트 · 보관함 · 번역기 · 이미지
        //                  메모리+편집 · 요약+편집 · AI 요약 · '메시지 옵션' · '메시지 메뉴'
        btn.innerHTML = icon(IC_PENCIL, 15) + '<span>메시지 편집</span>';
        btn.title = '메시지 본문 일괄 편집';
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
