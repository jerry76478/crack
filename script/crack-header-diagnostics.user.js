// ==UserScript==
// @name         🔎 크랙 헤더 주입 진단 (모바일)
// @namespace    https://crack.wrtn.ai/
// @version      1.0.0
// @description  모바일에서 뷰포트 크기와 헤더 앵커 판정을 화면에 직접 표시한다. 확인이 끝나면 삭제해도 되는 임시 도구.
// @downloadURL  https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-header-diagnostics.user.js
// @updateURL    https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-header-diagnostics.user.js
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var CTRL = 'button,a,[role="button"]';
    var bubble = null;
    var panel = null;
    var output = null;

    function vis(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        var cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function box(el) {
        var b = el.getBoundingClientRect();
        return 'top:' + Math.round(b.top) + ' bottom:' + Math.round(b.bottom) +
               ' left:' + Math.round(b.left) + ' right:' + Math.round(b.right) +
               ' w:' + Math.round(b.width) + ' h:' + Math.round(b.height);
    }

    function cls(el) {
        if (!el) return '(없음)';
        return String(el.className || el.tagName).slice(0, 70);
    }

    function firstVisible(list) {
        for (var i = 0; i < list.length; i++) if (vis(list[i])) return list[i];
        return null;
    }

    // 크랙 헤더 우측 버튼 묶음 찾기 (요약 스크립트 1·2순위와 동일)
    function findCluster() {
        var sels = ['.absolute.z-\\[5\\] .flex.gap-3.items-center', '.group\\/header .flex.gap-3.items-center'];
        for (var i = 0; i < sels.length; i++) {
            try {
                var hit = firstVisible(document.querySelectorAll(sels[i]));
                if (hit) return { el: hit, via: '선택자' };
            } catch (e) {}
        }
        try {
            var bars = document.querySelectorAll('[class*="z-[5]"][class*="justify-between"]');
            for (var b = 0; b < bars.length; b++) {
                if (!vis(bars[b])) continue;
                var br = bars[b].getBoundingClientRect();
                if (br.top > 140 || br.height > 96) continue;
                var kids = bars[b].children;
                for (var k = kids.length - 1; k >= 0; k--) {
                    if (vis(kids[k]) && kids[k].querySelector(CTRL)) return { el: kids[k], via: '구조' };
                }
            }
        } catch (e) {}
        return null;
    }

    function report() {
        var vw = window.innerWidth, vh = window.innerHeight;
        var L = [];

        L.push('■ 뷰포트  ' + vw + ' x ' + vh);
        L.push('  DPR ' + window.devicePixelRatio + ' · screen ' + screen.width + 'x' + screen.height);
        if (window.visualViewport) {
            L.push('  visualViewport ' + Math.round(visualViewport.width) + 'x' + Math.round(visualViewport.height) +
                   ' (scale ' + (Math.round(visualViewport.scale * 100) / 100) + ')');
        }
        L.push('  orientation ' + (vw > vh ? '가로' : '세로'));
        L.push('  path ' + location.pathname.replace(/[a-f0-9]{12,}/gi, '<ID>'));
        L.push('');

        var found = findCluster();
        L.push('■ 헤더 버튼 묶음');
        if (found) {
            L.push('  O (' + found.via + ') ' + cls(found.el));
            L.push('    ' + box(found.el));
        } else {
            L.push('  X 못 찾음 — 모바일 헤더 구조가 다를 수 있음');
        }
        L.push('');

        // 로어 인젝터 findModernHeaderTarget 조건 재현
        var minLeft = Math.max(260, Math.floor(0.35 * vw));
        var maxW = Math.min(620, 0.5 * vw);
        var minRight = 0.55 * vw;
        L.push('■ 로어 인젝터 2단 조건');
        L.push('  컨트롤: top 48~125, left ≥ ' + minLeft);
        L.push('  컨테이너: h 28~72, w ≤ ' + Math.round(maxW) + ', right ≥ ' + Math.round(minRight));
        if (found) {
            var cr = found.el.getBoundingClientRect();
            var wOk = cr.width <= maxW;
            var rOk = cr.right >= minRight;
            var hOk = cr.height >= 28 && cr.height <= 72;
            L.push('  → w ' + Math.round(cr.width) + (wOk ? ' OK' : ' ✗ ' + Math.round(cr.width - maxW) + 'px 초과'));
            L.push('  → right ' + Math.round(cr.right) + (rOk ? ' OK' : ' ✗ ' + Math.round(minRight - cr.right) + 'px 부족'));
            L.push('  → h ' + Math.round(cr.height) + (hOk ? ' OK' : ' ✗ 범위 밖'));
            var all = [].slice.call(found.el.querySelectorAll(CTRL)).filter(vis);
            var pass = all.filter(function (el) {
                var r = el.getBoundingClientRect();
                return r.top >= 48 && r.top <= 125 && r.left >= minLeft && r.right <= vw + 8;
            });
            L.push('  → 묶음 안 컨트롤 ' + all.length + '개 중 조건 통과 ' + pass.length + '개');
            L.push('  판정: ' + (wOk && rOk && hOk && pass.length > 0 ? '통과' : '실패 → 3단/폴백으로 밀림'));
        }
        L.push('');

        // 3단(입력창 툴바) 후보
        var eds = [].slice.call(document.querySelectorAll('[contenteditable="true"], .ProseMirror')).filter(vis);
        L.push('■ 로어 인젝터 3단 에디터 후보: ' + eds.length + (eds.length ? '' : ' (0이면 이 단계도 실패)'));
        L.push('');

        L.push('■ 실제 버튼 상태');
        var lore = document.getElementById('lore-inj-entry-button');
        L.push('  Lore : ' + (lore
            ? (getComputedStyle(lore).position === 'fixed' ? '⚠ 폴백(떠다님)' : '✅ 부착 → ' + cls(lore.parentElement))
            : '없음(미설치/미실행)'));
        var sum = document.querySelector('.crack-ext-header-ai-btn');
        L.push('  요약 : ' + (sum
            ? (sum.classList.contains('crack-ext-floating') ? '⚠ 폴백(떠다님)' : '✅ 부착 → ' + cls(sum.parentElement))
            : '없음(미설치/미실행)'));

        return L.join('\n');
    }

    function refresh() {
        if (output) output.value = report();
    }

    function buildUi() {
        bubble = document.createElement('button');
        bubble.type = 'button';
        bubble.textContent = '🔎';
        bubble.setAttribute('aria-label', '헤더 진단 열기');
        bubble.style.cssText = [
            'position:fixed', 'left:10px', 'bottom:calc(14px + env(safe-area-inset-bottom,0px))',
            'width:38px', 'height:38px', 'border-radius:50%', 'border:1px solid rgba(0,0,0,.2)',
            'background:#fff', 'color:#222', 'font-size:17px', 'line-height:1', 'padding:0',
            'z-index:2147483647', 'box-shadow:0 3px 10px rgba(0,0,0,.25)', 'cursor:pointer'
        ].join(';');

        panel = document.createElement('div');
        panel.style.cssText = [
            'position:fixed', 'left:0', 'right:0', 'top:0', 'display:none',
            'z-index:2147483647', 'background:#14120f', 'color:#ede5d6',
            'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
            'padding:calc(8px + env(safe-area-inset-top,0px)) 10px 10px',
            'box-shadow:0 6px 24px rgba(0,0,0,.5)', 'box-sizing:border-box'
        ].join(';');

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap';
        panel.appendChild(bar);

        function mkBtn(label) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText = 'flex:1 1 auto;padding:7px 10px;border-radius:7px;border:1px solid #3b342a;background:#262119;color:#ede5d6;font-size:12px;font-weight:600;cursor:pointer';
            bar.appendChild(b);
            return b;
        }

        mkBtn('다시 측정').onclick = refresh;

        var copyBtn = mkBtn('복사');
        copyBtn.onclick = function () {
            output.select();
            var done = false;
            try { done = document.execCommand('copy'); } catch (e) {}
            if (!done && navigator.clipboard) {
                navigator.clipboard.writeText(output.value).then(function () {
                    copyBtn.textContent = '복사됨';
                    setTimeout(function () { copyBtn.textContent = '복사'; }, 1200);
                });
                return;
            }
            copyBtn.textContent = done ? '복사됨' : '길게 눌러 선택';
            setTimeout(function () { copyBtn.textContent = '복사'; }, 1500);
        };

        mkBtn('닫기').onclick = function () {
            panel.style.display = 'none';
            bubble.style.display = 'block';
        };

        output = document.createElement('textarea');
        output.readOnly = true;
        output.style.cssText = [
            'width:100%', 'height:min(46vh,340px)', 'box-sizing:border-box',
            'background:#0c0b09', 'color:#ede5d6', 'border:1px solid #3b342a',
            'border-radius:8px', 'padding:9px', 'font:inherit', 'resize:vertical',
            '-webkit-user-select:text', 'user-select:text'
        ].join(';');
        panel.appendChild(output);

        bubble.onclick = function () {
            refresh();
            panel.style.display = 'block';
            bubble.style.display = 'none';
        };

        document.body.appendChild(bubble);
        document.body.appendChild(panel);
    }

    function start() {
        buildUi();
        // 회전·주소창 접힘 등으로 뷰포트가 바뀌면 열려 있을 때만 갱신
        ['resize', 'orientationchange'].forEach(function (ev) {
            window.addEventListener(ev, function () {
                if (panel && panel.style.display === 'block') refresh();
            });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
