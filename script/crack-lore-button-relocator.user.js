// ==UserScript==
// @name         📌 로어 인젝터 버튼 헤더 고정
// @namespace    https://crack.wrtn.ai/
// @version      1.0.0
// @description  로어 인젝터가 폴백으로 만든 떠다니는 버튼을 크랙 헤더 버튼 줄로 옮긴다. 인젝터 코드는 수정하지 않으므로 인젝터가 자동 업데이트돼도 유지된다.
// @author       Gia
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var LORE_BTN_ID = 'lore-inj-entry-button';
    var CONTROL_SELECTOR = 'button,a,[role="button"]';

    // 로어 인젝터가 지원하는 채팅 주소 형태
    var CHAT_PATH_PATTERNS = [
        /\/stories\/[a-f0-9]+\/episodes\/[a-f0-9]+/i,
        /\/characters\/[a-f0-9]+\/chats\/[a-f0-9]+/i,
        /\/u\/[a-f0-9]+\/c\/[a-f0-9]+/i
    ];

    // 인젝터가 폴백 버튼에 넣는 인라인 스타일. 헤더로 옮길 때 이 항목들만 걷어낸다.
    var FALLBACK_ONLY_PROPS = ['position', 'right', 'bottom', 'z-index', 'box-shadow', 'backdrop-filter', '-webkit-backdrop-filter'];
    var FALLBACK_STYLE = 'position:fixed;right:12px;bottom:calc(76px + env(safe-area-inset-bottom, 0px));' +
                         'z-index:2147483646;height:34px;min-width:52px;margin:0;' +
                         'box-shadow:0 4px 14px rgba(0,0,0,.35);backdrop-filter:blur(8px)';

    // 헤더 위치는 기기마다 다르다. 데스크톱은 상단바 아래라 top:56 부근이고
    // 모바일은 상단바가 없어 top:6까지 올라온다.
    var HEADER_BAND_TOP = -8;
    var HEADER_BAND_BOTTOM = 124;

    // 우리가 옮긴 버튼. 리렌더로 DOM에서 떨어져 나가면 이 참조로 되살린다.
    var movedBtn = null;

    function isChatPath() {
        for (var i = 0; i < CHAT_PATH_PATTERNS.length; i++) {
            if (CHAT_PATH_PATTERNS[i].test(location.pathname)) return true;
        }
        return false;
    }

    function isVisibleEl(el) {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function firstVisibleChild(el) {
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) {
            if (isVisibleEl(kids[i])) return kids[i];
        }
        return null;
    }

    // ===== 헤더 앵커 탐색 (요약 스크립트에서 검증된 3단 방식) =====

    // 1순위: 확인된 헤더 우측 버튼 묶음 선택자
    function findAnchorBySelector() {
        var selectors = [
            '.absolute.z-\\[5\\] .flex.gap-3.items-center',
            '.group\\/header .flex.gap-3.items-center'
        ];
        for (var i = 0; i < selectors.length; i++) {
            try {
                var found = document.querySelectorAll(selectors[i]);
                for (var j = 0; j < found.length; j++) {
                    if (isVisibleEl(found[j])) return { host:found[j], before:firstVisibleChild(found[j]) };
                }
            } catch (e) {}
        }
        return null;
    }

    // 2순위: 상단 바(justify-between)의 마지막 버튼 묶음
    function findAnchorByStructure() {
        var bars;
        try { bars = document.querySelectorAll('[class*="z-[5]"][class*="justify-between"]'); }
        catch (e) { return null; }
        for (var i = 0; i < bars.length; i++) {
            var bar = bars[i];
            if (!isVisibleEl(bar)) continue;
            var barRect = bar.getBoundingClientRect();
            if (barRect.top > 140 || barRect.height > 96) continue;
            var kids = bar.children;
            for (var k = kids.length - 1; k >= 0; k--) {
                if (!isVisibleEl(kids[k])) continue;
                if (!kids[k].querySelector(CONTROL_SELECTOR)) continue;
                return { host:kids[k], before:firstVisibleChild(kids[k]) };
            }
        }
        return null;
    }

    // 3순위: 화면 좌표로 추정. 폭 상한은 "전체 폭 헤더 바"만 걸러내는 용도라 넉넉히 잡는다.
    function findAnchorByGeometry() {
        var vw = window.innerWidth;
        var controls = [];
        var all = document.querySelectorAll(CONTROL_SELECTOR);
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === LORE_BTN_ID) continue;
            if (all[i].classList.contains('crack-ext-header-ai-btn')) continue;
            if (!isVisibleEl(all[i])) continue;
            var r = all[i].getBoundingClientRect();
            if (r.top < HEADER_BAND_TOP || r.bottom > HEADER_BAND_BOTTOM || r.right < vw * 0.5) continue;
            controls.push(all[i]);
        }
        controls.sort(function(a, b) {
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
                    return { host:node, before:firstVisibleChild(node) };
                }
                node = node.parentElement;
            }
        }
        return null;
    }

    function findHeaderAnchor() {
        return findAnchorBySelector() || findAnchorByStructure() || findAnchorByGeometry();
    }

    // ===== 스타일 전환 =====

    function isFallbackStyled(btn) {
        return btn.style.position === 'fixed';
    }

    function stripFallbackStyle(btn) {
        // position/right/bottom 등은 폴백에서만 쓰이므로 통째로 제거하면 원래 모습으로 돌아온다.
        for (var i = 0; i < FALLBACK_ONLY_PROPS.length; i++) btn.style.removeProperty(FALLBACK_ONLY_PROPS[i]);
        // height/min-width/margin은 원본에도 있으므로 원본 값으로 되돌린다.
        btn.style.height = '32px';
        btn.style.minWidth = '0';
        btn.style.margin = '0';
        btn.style.flex = '0 0 auto';
    }

    function applyFallbackStyle(btn) {
        btn.style.cssText += ';' + FALLBACK_STYLE;
    }

    function mount(anchor, btn) {
        var before = anchor.before;
        if (before && before !== btn && before.parentElement === anchor.host) anchor.host.insertBefore(btn, before);
        else anchor.host.appendChild(btn);
    }

    // ===== 본체 =====

    function relocate() {
        if (!isChatPath()) return;

        var btn = document.getElementById(LORE_BTN_ID);
        // 리렌더로 헤더가 통째로 날아가면 우리가 옮긴 버튼도 함께 사라진다.
        // 인젝터는 버튼을 다시 만들지 않으므로(id 검사로 조기 반환) 참조로 되살린다.
        if (!btn && movedBtn && !movedBtn.isConnected) btn = movedBtn;
        if (!btn) return;

        var anchor = findHeaderAnchor();

        if (!anchor) {
            // 헤더를 못 찾았는데 버튼이 떨어져 있으면 최소한 폴백 상태로라도 되살린다.
            if (!btn.isConnected) {
                applyFallbackStyle(btn);
                document.body.appendChild(btn);
            }
            return;
        }

        if (btn.parentElement === anchor.host) return; // 이미 제자리

        if (isFallbackStyled(btn)) stripFallbackStyle(btn);
        mount(anchor, btn);
        movedBtn = btn;
    }

    function start() {
        var scheduled = false;
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(function () {
                scheduled = false;
                try { relocate(); } catch (e) {}
            });
        }

        new MutationObserver(schedule).observe(document.body, { childList:true, subtree:true });
        window.addEventListener('popstate', schedule);
        window.addEventListener('hashchange', schedule);
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);
        schedule();
        // 인젝터 초기화가 늦을 수 있으므로 주기적으로도 확인한다.
        setInterval(schedule, 1500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
