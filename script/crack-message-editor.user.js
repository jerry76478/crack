// ==UserScript==
// @name         ✏️ 크랙 메시지 도구
// @namespace    https://crack.wrtn.ai/
// @version      0.8.0
// @description  메시지 일괄 편집·드래그 핀셋 수정·대화록 저장을 한곳에서 쓴다. 기본값은 읽기 전용이며 일괄 저장 직전 백업 여부를 고를 수 있다. AI를 호출하지 않는다.
// @author       Gia
// @downloadURL  https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-message-editor.user.js
// @updateURL    https://raw.githubusercontent.com/jerry76478/crack/main/script/crack-message-editor.user.js
// @match        https://crack.wrtn.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function(){
'use strict';
/* 메시지 도구 연결부. 원작자 기능은 build.cjs의 검사된 연결점으로만 부른다. */
const CME = (() => {
    'use strict';
    const VERSION = '0.8.0';
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const state = { pinset: null, transcript: null, duplicates: new Set(), themes: null };
    const writes = new Set();
    async function writeLocked(chatId, msgId, fn) {
        const key=chatId+':'+msgId;
        if(writes.has(key))throw new Error('다른 도구가 이 메시지를 저장하고 있어요. 잠시 뒤 다시 해 주세요.');
        writes.add(key);try{return await fn();}finally{writes.delete(key);}
    }
    const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const route = () => {
        const p = location.pathname;
        let m = p.match(/^\/stories\/([^/]+)\/episodes\/([a-f0-9]{24})/i);
        if (m) return { chatId: m[2], storyId: m[1], kind: 'story', base: '/v3/chats/' + m[2] };
        m = p.match(/^\/(?:characters\/[^/]+\/chats|u\/[^/]+\/c)\/([a-f0-9]{24})/i);
        return m ? { chatId: m[1], storyId: '', kind: 'character', base: '/character-chats/' + m[1] } : null;
    };
    const changed = (chatId, ids, source) => document.dispatchEvent(new CustomEvent('cme:messages-changed', { detail: { chatId, ids, source } }));
    const duplicate = name => { if(state.duplicates.has(name))return; state.duplicates.add(name); document.dispatchEvent(new Event('cme:companions')); };
    function externalTranscript() {
        const row = document.querySelector('[data-crack-transcript]:not([data-cme-owned]) [role="button"]');
        if (row) duplicate('대화록');
        return row;
    }
    const notice = () => state.duplicates.size ? '따로 설치한 ' + [...state.duplicates].join('/') + '을 지워 주세요. 따로 설치한 핀셋·대화록의 기록은 이어지지 않아요. 대화록은 방마다 처음 한 번 「전체」로 저장하면 「새 턴만」을 쓸 수 있어요.' : '';
    const dark = () => {
        const t = document.body?.dataset.theme || document.documentElement.dataset.theme;
        if (t === 'dark' || t === 'light') return t === 'dark';
        return document.documentElement.classList.contains('dark') || matchMedia('(prefers-color-scheme: dark)').matches;
    };
    function palette() {
        let name = '';
        try { name = page.localStorage.getItem('crack-msg-editor:theme'); } catch {}
        return state.themes?.[name || 'crack']?.[dark() ? 'dark' : 'light'] || state.themes?.crack?.[dark() ? 'dark' : 'light'];
    }
    function syncTheme() {
        if (!document.head) { document.addEventListener('DOMContentLoaded',syncTheme,{once:true}); return; }
        const t = palette();
        if (!t) return;
        const vars = Object.entries(t).map(([k,v]) => `--cme-${k}:${v}`).join(';');
        let style = document.getElementById('cme-tools-style');
        if (!style) { style = document.createElement('style'); style.id = 'cme-tools-style'; document.head.append(style); }
        style.textContent = `:root{${vars}}
.crack-msg-ed-overlay .cme-tools-nav{display:flex;gap:8px;padding:8px 14px;background:var(--cme-head);border-bottom:1px solid var(--cme-line);flex:none}
.crack-msg-ed-overlay :is(.cme-b,.cme-segb,.cme-tab,.cme-iconbtn,.cme-check,.cme-in,.cme-fmts summary,.cme-line):not(.m3-help){min-height:44px;min-width:44px}
.crack-msg-ed-overlay .cme-tool-btn{flex:1;min-width:0;min-height:44px;border:1px solid var(--cme-line);border-radius:12px;background:var(--cme-btn);color:var(--cme-fg);font:500 14px/20px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crack-msg-ed-overlay .cme-tool-btn[aria-selected=true]{color:var(--cme-accent2);background:var(--cme-changedBg);border-color:var(--cme-accent2)}
.crack-msg-ed-overlay .cme-tools-pane{padding:12px;overflow-wrap:anywhere}
.crack-msg-ed-overlay .cme-tools-pane .cme-b{min-height:44px;min-width:44px}
.crack-msg-ed-overlay .cme-tools-notice{margin:0;padding:8px 14px;font-size:12px;line-height:18px;color:var(--cme-fg);background:var(--cme-head);overflow-wrap:anywhere;flex:none}
.crack-msg-ed-overlay[data-tool=pinset] :is(.cme-scope,.cme-tabs,.cme-foot,[data-tabpane]),.crack-msg-ed-overlay[data-tool=transcript] :is(.cme-scope,.cme-tabs,.cme-foot,[data-tabpane]){display:none!important}
.crack-msg-ed-overlay .cme-trace{border:1px solid var(--cme-line);border-radius:16px;padding:12px;margin-top:12px;min-width:0;background:var(--cme-btn)}
.crack-msg-ed-overlay .cme-trace pre{white-space:pre-wrap;overflow-wrap:anywhere;font:400 14px/23px system-ui;max-width:100%;margin:8px 0}
.crack-msg-ed-overlay .cme-trace .cme-acts{flex-wrap:wrap}
::highlight(cpn-edit){background:color-mix(in srgb,var(--cme-raw,#FF4431) 28%,transparent)}
::highlight(cpn-cut){background:var(--cme-raw)}
.cpn-badge{color:var(--cme-accent)!important;background:var(--cme-changedBg)!important;border-color:var(--cme-line)!important}
[data-cme-editor-row] [role=button]{min-height:44px;min-width:44px}
`;
        for (const host of document.querySelectorAll('#cpn-host,#cme-transcript-host')) {
            if (!host.shadowRoot) continue;
            let patch = host.shadowRoot.querySelector('style[data-cme-theme]');
            if (!patch) { patch = document.createElement('style'); patch.dataset.cmeTheme = ''; host.shadowRoot.append(patch); }
            patch.textContent = host.id === 'cpn-host' ? pinCss : transcriptCss;
        }
    }
    // These selectors cover multiple upstream control families and deliberately exclude help controls.
    const pinCss = `
.stage,.stage[data-theme=light]{--glass:var(--cme-bg);--glass-solid:var(--cme-bg);--surface:var(--cme-btn);--surface-2:var(--cme-panel);--hover:var(--cme-btnHover);--text:var(--cme-fg);--text-2:var(--cme-muted);--text-3:var(--cme-muted);--rule:var(--cme-line);--rail:var(--cme-line);--pink:var(--cme-accent);--pink-soft:var(--cme-changedBg);--on-pink:var(--cme-accentFg);--danger:var(--cme-danger)}
.stage :is(.tb button,.btn,.mini,.sw,.seg button,.toast button,.x):not(.m3-help){min-height:44px;height:auto;min-width:44px;font-size:13px;line-height:20px}
.stage .pop{max-height:calc(100vh - 20px);display:flex;flex-direction:column;max-width:calc(100vw - 20px)}
.stage .pop .bd{min-height:0;overflow:auto}.stage .hd b{min-width:0;overflow-wrap:anywhere}.stage .ft{flex-wrap:wrap}.stage .ft .grow{display:none}
.stage .seg{display:flex;flex-wrap:wrap}.stage .it .meta{flex-wrap:wrap}.stage .note{font-size:12px;color:var(--cme-muted)}
.stage .sw[aria-pressed=true] i::after{background:var(--cme-accentFg)}
.stage .pane del{background:var(--cme-invalidBg)}
`;
    const transcriptCss = `
.v,.v[data-theme=dark]{--ink:var(--cme-fg);--sub:var(--cme-muted);--mute:var(--cme-muted);--key:var(--cme-accent);--on-key:var(--cme-accentFg);--glass:var(--cme-bg);--solid:var(--cme-bg);--fill:var(--cme-btn);--line:var(--cme-line);--err:var(--cme-danger);--soft:var(--cme-changedBg);--hover:var(--cme-btnHover);--well:var(--cme-panel);--thumb:var(--cme-btn);--track:var(--cme-line);--knob:var(--cme-muted);--knob-on:var(--cme-accentFg);--err-soft:var(--cme-invalidBg)}
.v .dlg{background:var(--cme-bg);color:var(--cme-fg);max-height:calc(100vh - 20px)}
.v .card{background:var(--cme-btn)}.v .ttl p{min-width:0}.v .ttl{flex:1}.v .ft{flex-wrap:wrap}.v .msg{width:100%;flex-basis:100%;max-height:90px}
.v :is(.btn,.seg label,.tabbar label,.row,.num):not(.m3-help){min-height:44px;min-width:44px}
.v .seg label{white-space:normal;overflow-wrap:anywhere}.v .fence{flex-wrap:wrap}.v .fence .seg{width:100%}
.v .cme-keywords{display:block;margin:12px 0;width:100%;min-height:100px;resize:vertical;box-sizing:border-box;background:var(--cme-btn);color:var(--cme-fg);border:1px solid var(--cme-line);border-radius:12px;padding:12px;font:14px/23px system-ui}
.v .cme-screen-note{font-size:12px;line-height:18px;color:var(--cme-muted);overflow-wrap:anywhere}
.v .seg .thumb,.v .tabbar .thumb{background:var(--cme-changedBg)}
@media(prefers-reduced-motion:reduce){.v *{animation:none!important;transition:none!important}}
`;
    function mountEditor(overlay) {
        const modal = overlay.querySelector('.cme-modal'), body = overlay.querySelector('#cme-body');
        const nav = document.createElement('div'); nav.className = 'cme-tools-nav'; nav.setAttribute('role','tablist');
        nav.innerHTML = [['edit','편집'],['pinset','핀셋'],['transcript','로그 저장']].map(([k,t]) => `<button class="cme-tool-btn" role="tab" data-tool="${k}" aria-selected="${k==='edit'}">${t}</button>`).join('');
        modal.querySelector('.cme-head').after(nav);
        const warn = document.createElement('p'); warn.className = 'cme-tools-notice'; warn.setAttribute('aria-live','polite'); nav.after(warn);
        const pin = document.createElement('section'); pin.className = 'cme-tools-pane'; pin.hidden = true; pin.dataset.toolpane = 'pinset';
        const log = document.createElement('section'); log.className = 'cme-tools-pane'; log.hidden = true; log.dataset.toolpane = 'transcript';
        log.innerHTML = '<div class="cme-card"><h4>로그 저장</h4><p class="cme-hint">TXT · HTML · Markdown · JSON · EPUB으로 대화와 장기기억을 저장해요.</p><button type="button" class="cme-b" data-open-transcript>로그 저장 창 열기</button></div>';
        body.append(pin, log);
        log.querySelector('button').onclick = () => openTranscript();
        const refresh = () => {
            externalTranscript(); warn.textContent = notice(); warn.hidden = !warn.textContent;
            const api = state.pinset;
            if (!api) { pin.innerHTML = '<p class="cme-hint">' + escape(state.duplicates.has('핀셋') ? '따로 설치한 핀셋을 지워 주세요.' : '핀셋을 준비하고 있어요.') + '</p>'; return; }
            const records = api.records();
            pin.innerHTML = `<div class="cme-card"><h4>핀셋</h4><p class="cme-hint">메시지 글자를 드래그하면 그 자리만 고칠 수 있어요.</p><button class="cme-b" role="switch" aria-checked="${api.enabled()}" data-pin-toggle>핀셋 ${api.enabled()?'켜짐':'꺼짐'}</button></div>` + Object.entries(records).map(([id,r]) => `<article class="cme-trace" data-trace="${id}"><p class="cme-hint">…${escape(id.slice(-6))} · 수정 ${r.edits.length}건</p><pre>${escape(r.current)}</pre><div class="cme-acts"><button class="cme-b" data-trace-act="original">원래 글 보기</button><button class="cme-b" data-trace-act="trace">수정 흔적</button><button class="cme-b" data-trace-act="undo">되돌리기</button></div><pre data-original hidden>${escape(r.origin ?? r.base)}</pre><p class="cme-hint" aria-live="polite" data-result></p></article>`).join('') + (!Object.keys(records).length ? '<p class="cme-hint">이 방의 수정 흔적이 없어요.</p>' : '');
        };
        pin.addEventListener('click', async e => {
            if (e.target.closest('[data-pin-toggle]')) { state.pinset.toggle(); refresh(); return; }
            const b = e.target.closest('[data-trace-act]'), row = b?.closest('[data-trace]'); if (!row) return;
            if (b.dataset.traceAct === 'original') { const p = row.querySelector('[data-original]'); p.hidden = !p.hidden; return; }
            b.disabled = true;
            try { if (b.dataset.traceAct === 'trace') state.pinset.trace(row.dataset.trace); else { await state.pinset.undo(row.dataset.trace); refresh(); } }
            catch (error) { row.querySelector('[data-result]').textContent = error.message; }
            finally { b.disabled = false; }
        });
        nav.onclick = e => {
            const b = e.target.closest('[data-tool]'); if (!b) return;
            overlay.dataset.tool = b.dataset.tool;
            for (const t of nav.children) t.setAttribute('aria-selected', String(t === b));
            pin.hidden = b.dataset.tool !== 'pinset'; log.hidden = b.dataset.tool !== 'transcript'; refresh(); body.scrollTop = 0;
        };
        overlay.dataset.tool = 'edit'; refresh();
        const update = () => { if (overlay.isConnected) refresh(); else document.removeEventListener('cme:companions', update); };
        document.addEventListener('cme:companions', update);
        const onChange = () => { if (overlay.isConnected && overlay.dataset.tool === 'pinset') refresh(); if (!overlay.isConnected) document.removeEventListener('cme:messages-changed', onChange); };
        document.addEventListener('cme:messages-changed', onChange);
    }
    function openTranscript() {
        const external = externalTranscript();
        if (external) { external.click(); return; }
        state.transcript?.open();
    }
    function migrateKeywords(o) {
        try {
            if (!GM_getValue('cme:keywords-imported:v1', false)) {
                const s = ['crackhelper:lx:crack_rp_exporter_settings_v031','crack_rp_exporter_settings_v031'].map(key=>{
                    try { return JSON.parse(page.localStorage.getItem(key)||'null'); } catch { return null; }
                }).find(value=>value && typeof value.keywordPatterns==='string');
                if (s && typeof s.keywordPatterns === 'string' && !o.clean.keywordPatterns) {
                    o.clean.keywordPatterns = s.keywordPatterns; o.clean.removeKeywords = !!s.removeKeywords;
                    GM_setValue('options', o);
                }
                GM_setValue('cme:keywords-imported:v1', true);
            }
        } catch { /* Unavailable GM/local storage starts blank; source values are never removed. */ }
        return o;
    }
    function filterKeywords(turns, clean) {
        if (!clean?.on || !clean.removeKeywords) return turns;
        const words = String(clean.keywordPatterns || '').split('\n').map(s => s.trim()).filter(Boolean);
        const keep = m => m && !words.some(w => m.content.includes(w));
        return turns.map(t => ({ ...t, user: keep(t.user) ? t.user : null, replies: t.replies.filter(keep), alts: t.alts.filter(keep) })).filter(t => t.user || t.replies.length || t.alts.length);
    }
    // LX 1.0.10: height/count/oldest fingerprint -> 3 stable rounds -> two top re-triggers.
    // The 9/30 adapter scopes text to markdown bodies, avoiding message action/button labels.
    async function readScreen({ signal, progress, chatId }) {
        const check = () => { if (signal?.aborted) throw new DOMException('cancelled','AbortError'); if (route()?.chatId !== chatId) throw new Error('다른 방으로 옮겨져서 화면 읽기를 취소했어요.'); };
        const pause = ms => new Promise((resolve,reject) => { const t = setTimeout(() => { signal?.removeEventListener('abort', abort); try { check(); resolve(); } catch(e) { reject(e); } }, ms); const abort = () => { clearTimeout(t); reject(new DOMException('cancelled','AbortError')); }; signal?.addEventListener('abort',abort,{once:true}); });
        const groups = () => [...document.querySelectorAll('main [data-message-group-id]')].filter(e => !e.closest('.crack-msg-ed-overlay,#ch-root'));
        let scroller = groups()[0]?.parentElement;
        while (scroller && scroller !== document.body && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        if (!scroller || scroller === document.body) throw new Error('채팅 스크롤 영역을 찾지 못했어요.');
        const snap = () => { const gs = groups(); return [scroller.scrollHeight, gs.length, gs.map(g => g.dataset.messageGroupId + ':' + (g.querySelector('.wrtn-markdown,.markdown-body,.prose')?.textContent || '').length).sort().join('|')].join(':'); };
        const quiet = async (quietMs,maxMs) => { let s = snap(), stable = 0; for (let spent=0;spent<maxMs;spent+=350) { await pause(350); const n = snap(); stable = n===s ? stable+350 : 0; s=n; if (stable>=quietMs) return s; } return s; };
        const oldTop = scroller.scrollTop; let stable=0, previous=snap(), done=false;
        try {
            for (let i=0;i<240;i++) {
                check(); scroller.scrollTop=0; const current=await quiet(1400,6500);
                stable=current===previous?stable+1:0; previous=current;
                progress?.(`화면 메시지 ${groups().length}개 읽는 중…`);
                if (stable<3) continue;
                let valid=true;
                for (let round=1;round<=2;round++) {
                    scroller.scrollTop=Math.min(Math.max(scroller.clientHeight*.65,220),900); await pause(350); scroller.scrollTop=0;
                    const n=await quiet(round===2?2800:2000,round===2?7000:4500);
                    progress?.(`끝 지점 확인 ${round}/2 · 메시지 ${groups().length}개`);
                    if(n!==previous){previous=n;stable=0;valid=false;break;}
                }
                if(valid){done=true;break;}
            }
            if(!done) throw new Error('화면 기록의 끝을 확인하지 못했어요.');
            const rows=groups().map(g=>{
                let mds=[...g.querySelectorAll('.wrtn-markdown')];
                if(!mds.length)mds=[...g.querySelectorAll('.markdown-body,.prose')].filter(e=>!e.parentElement.closest('.markdown-body,.prose'));
                let role='';
                for(const e of [g,...g.querySelectorAll('[data-role],[data-message-role],[data-author-role],[data-sender-role]')]) {
                    for(const a of ['data-role','data-message-role','data-author-role','data-sender-role']) { const v=e.getAttribute(a); if(v==='user'||v==='assistant'||v==='character')role=v==='character'?'assistant':v; }
                }
                // Same semantic role hints as LX; unknown roles are refused rather than guessed by alternation.
                if(!role)role=state.pinset?.role?.(g)||'';
                if(!role){if(g.querySelector('[aria-label*="재생성"],[aria-label*="답변 비교"],#exp-reroll-btn')||/^T\s*\d+\s*\|/.test(mds[0]?.innerText||''))role='assistant';else if(g.matches('.user')||g.querySelector('.user-message')||g.firstElementChild?.matches('.border-y.border-outline_tertiary'))role='user';}
                if(!mds.length || !role) throw new Error('화면 메시지의 본문 또는 역할을 확인하지 못했어요.');
                const r=g.getBoundingClientRect();
                const text=node=>{if(node.nodeType===3)return node.textContent;if(node.nodeType!==1)return '';if(node.tagName==='BR')return '\n';let s=[...node.childNodes].map(text).join('');return /^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6]|TR)$/.test(node.tagName)?s+'\n':s;};
                const content=mds.map(md=>{const clone=md.cloneNode(true);clone.querySelectorAll('button,.cpn-badge,[role=menu],.cmu-message-badge,.cac-answer-cost,.cmi-model-slot,[data-cmu-toolbar-button]').forEach(e=>e.remove());return text(clone).trim();}).join('\n');
                return {_id:g.dataset.messageGroupId,role,content,y:r.top};
            }).sort((a,b)=>a.y-b.y);
            let parent='screen:missing'; // Never pretend this is a complete, server-numbered history.
            for(const [i,m]of rows.entries()){m.turnId='screen:'+m._id+':'+i;m.parentTurnId=parent;parent=m.turnId;delete m.y;}
            return {messages:rows.reverse(),complete:false,screen:true};
        } finally { scroller.scrollTop=oldTop; }
    }
    function placeEditorRow(open) {
        if(!route())return;
        for(const panel of document.querySelectorAll('div.bg-background.border-l')) {
            if(panel.querySelector('[data-cme-editor-row]'))continue;
            const heading=[...panel.querySelectorAll('span,p')].find(e=>!e.children.length&&e.textContent.trim()==='채팅방 설정');
            let anchor=null;
            for(let el=heading?.nextElementSibling;el&&el.querySelector?.('[role=button]');el=el.nextElementSibling)anchor=el;
            if(!anchor)anchor=[...panel.querySelectorAll('[role=button]')].find(e=>/^(키보드 단축키|요약 메모리|유저 노트)$/.test(e.textContent.trim()))?.parentElement;
            const sample=anchor?.querySelector('[role=button]');if(!sample)continue;
            const wrap=document.createElement('div');wrap.className=anchor.className;wrap.dataset.cmeEditorRow='';
            const row=document.createElement('div');row.className=sample.className;row.setAttribute('role','button');row.tabIndex=0;row.textContent='메시지 편집';
            row.onclick=e=>{e.stopPropagation();open();};row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open();}};
            wrap.append(row);anchor.after(wrap);
        }
    }
    function wirePanel(open) {
        let pending=0;
        const soon=()=>{if(!pending)pending=setTimeout(()=>{pending=0;placeEditorRow(open);externalTranscript();},600);};
        document.addEventListener('click',soon,true);page.addEventListener('popstate',soon);
        for(const ms of [0,1500,4500])setTimeout(()=>placeEditorRow(open),ms);
        const observe=()=>{new MutationObserver(syncTheme).observe(document.body,{attributes:true,attributeFilter:['data-theme']});new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});};
        if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
        page.addEventListener('storage',syncTheme);matchMedia('(prefers-color-scheme: dark)').addEventListener('change',syncTheme);
    }
    return { VERSION,page,state,route,changed,writeLocked,duplicate,externalTranscript,notice,syncTheme,mountEditor,openTranscript,migrateKeywords,filterKeywords,readScreen,wirePanel,
        setThemes(themes){state.themes=themes;syncTheme();}, pinCss,transcriptCss };
})();

if(window.__CME_TEST_HOOK__)window.__CME_TOOLS=CME;


(function () {
    'use strict';
    var VERSION = CME.VERSION;
    var pageWindow = CME.page;

    // ============== 확정된 API 스펙 ==============
    // 목록: GET   {API_BASE}/{chatId}/messages?limit=N[&cursor=...]
    //       -> { data: { messages: [...], nextCursor: "base64" } }
    // 수정: PATCH {API_BASE}/{chatId}/messages/{_id}   body { message: "본문 전체" }
    //       ※ 부분 수정이 아니라 전체 치환. 식별자는 id/messageId가 아니라 _id.
    var API_BASE = 'https://crack-api.wrtn.ai/crack-gen';
    function roomApiBase() { return API_BASE + (CME.route()?.base || ''); }
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
        return CME.route()?.chatId || null;
    }

    function getToken() {
        var m = document.cookie.match(/(^| )access_token=([^;]+)/);
        return m ? decodeURIComponent(m[2]) : null;
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
            var raw = pageWindow.localStorage.getItem(key);
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
        return fetch(roomApiBase() + path, { headers: authHeaders() }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    // 본문 전체를 통째로 교체한다. 성공하면 true.
    async function patchMessage(messageId, content) {
        var token = getToken(), chatId = getChatId();
        if (!token || !chatId) throw new Error('인증 정보 없음');
        return CME.writeLocked(chatId, messageId, async function () {
        var res = await fetch(roomApiBase() + '/messages/' + encodeURIComponent(messageId), {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ message: content })
        });
        if (!res.ok) {
            var body = '';
            try { body = (await res.text() || '').slice(0, 200); } catch (e) {}
            throw new Error('HTTP ' + res.status + (body ? ' · ' + body : ''));
        }
        CME.changed(chatId, [messageId], 'editor');
        return true;
        });
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
    // 켜짐 = 페이지에 인젝터가 실제로 돌고 있고(pageWindow.__LoreInj), 설정의 enabled·injectionCleanupEnabled가 참.
    // 설정에 두 값이 없으면 인젝터 기본값(참)으로 본다. localStorage 값만 있고 __LoreInj가 없으면 꺼짐.
    function loreState() {
        var li = null, live = null;
        try { li = pageWindow.__LoreInj; } catch (e) {}
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
            if (all[i].classList.contains(BTN_CLASS) || all[i].closest('.crack-msg-ed-overlay,[data-cme-editor-row],[data-crack-transcript],div.bg-background.border-l')) continue;
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
        crack: {
            light: { bg:'#F6F3EF',fg:'#242424',muted:'#606060',line:'#E1DCD5',line2:'#E1DCD5',head:'#FFFEFC',panel:'#F1EEE9',btn:'#FFFEFC',btnHover:'#FFF0E9',accent:'#BF3322',accent2:'#BF3322',accentFg:'#FFFFFF',danger:'#A43758',changedBg:'#FFF0E9',invalidBg:'#FFF0E9',mark:'#E8C8BD',headerBtn:'#BF3322',raw:'#FF4431' },
            dark: { bg:'#171513',fg:'#ECECEC',muted:'#BDBDBD',line:'#48413A',line2:'#48413A',head:'#24211E',panel:'#312C27',btn:'#24211E',btnHover:'#3D2922',accent:'#FF9B88',accent2:'#FF9B88',accentFg:'#1F1F1F',danger:'#F0A0B7',changedBg:'#3D2922',invalidBg:'#3D2922',mark:'#785041',headerBtn:'#FF9B88',raw:'#FF4431' }
        },
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
    CME.setThemes(THEME_PRESETS);
    var THEME_NAMES = { crack: '크랙', beige: '베이지', pink: '분홍', lilac: '연보라', mint: '민트' };
    var THEME_STORE_KEY = 'crack-msg-editor:theme';   // 설정 편의용. 기본은 베이지

    function currentThemeName() {
        var v = '';
        try { v = pageWindow.localStorage.getItem(THEME_STORE_KEY) || ''; } catch (e) {}
        return THEME_PRESETS[v] ? v : 'crack';
    }

    var THEME_KEYS = ['bg', 'fg', 'muted', 'line', 'line2', 'head', 'panel', 'btn', 'btnHover',
                      'accent', 'accent2', 'accentFg', 'danger', 'changedBg', 'invalidBg', 'mark', 'headerBtn', 'raw'];

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
            '<div class="cme-modal" role="dialog" aria-modal="true" aria-label="메시지 도구">' +
              '<div class="cme-head">' +
                '<h3>' + icon(IC_PENCIL, 18) + '메시지 도구</h3>' +
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

        CME.mountEditor(overlay);

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
            document.removeEventListener('cme:messages-changed', onMessagesChanged);
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
            return (m.serverChanged ? '<span class="cme-tag err">그사이 서버에서 바뀜</span>' : '') + (invalid ? '<span class="cme-tag err">빈 본문</span>' : changed ? '<span class="cme-tag mod">수정됨</span>' : '') +
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
            try { pageWindow.localStorage.setItem(THEME_STORE_KEY, b.dataset.themeName); } catch (err) {}
            injectStyles(true);
            CME.syncTheme();
            markTheme();
        });
        markTheme();

        var modalChatId = getChatId();
        function onMessagesChanged(e) {
            var d = e.detail || {};
            if (d.chatId !== modalChatId || d.source === 'editor') return;
            (d.ids || []).forEach(function (id) { var m = byId(id); if (m) m.serverChanged = true; });
            render();
        }
        document.addEventListener('cme:messages-changed', onMessagesChanged);
        // ---------- 저장 ----------
        saveBtn.onclick = async function () {
            if (saving || askDone) return;
            if (locked) {
                await ask({ title: '읽기 전용', message: '읽기 전용 상태입니다. 아래 [읽기 전용] 스위치로 잠금을 해제하세요.', alert: true });
                return;
            }
            if (getChatId() !== modalChatId) { await ask({ title: '저장하지 않았습니다', message: '다른 방으로 옮겨져서 저장을 취소했습니다.', alert: true }); return; }
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
            if (getChatId() !== modalChatId) return;
            if (targets.some(function(m) { return m.serverChanged; })) {
                var fresh = await fetchAllMessages();
                var remote = new Map(fresh.messages.map(function(m) { return [m._id, m.content]; }));
                var conflicts = targets.filter(function(m) { return !remote.has(m._id) || remote.get(m._id) !== m.original; });
                if (conflicts.length) {
                    await ask({ title: '그사이 서버에서 바뀜', message: '다른 도구가 고친 메시지 ' + conflicts.length + '건이 있어 저장하지 않았습니다. 초안은 그대로 있습니다. JSON 내보내기로 초안을 보관한 뒤 다시 열어 비교해 주세요.', alert: true });
                    return;
                }
                targets.forEach(function(m) { m.serverChanged = false; });
            }
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
                    if (getChatId() !== modalChatId || m.serverChanged) throw new Error('그사이 서버 또는 방이 바뀌어 저장하지 않았습니다.');
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
        CME.wirePanel(openModal);
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

function startCompanions(){


// 동작 설명과 실기기 점검표: docs/pinset-guide.md · 아이콘: Lucide (ISC)

(() => {
  'use strict';

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (pageWindow.__crackPinsetRunning) { CME.duplicate('핀셋'); return; }
  pageWindow.__crackPinsetRunning = true;

  const VERSION = '0.1.5';
  const LOG = '[핀셋]';
  const API_BASE = 'https://crack-api.wrtn.ai/crack-gen';
  const SETTINGS_KEY = 'cpn:settings:v1';
  const INDEX_KEY = 'cpn:index:v1';
  const chatKey = chatId => `cpn:chat:${chatId}`;
  const LIMITS = Object.freeze({ edits: 30, undo: 10, messages: 120, chats: 150, soft: 8000 });
  const ID_RE = /^[a-f0-9]{24}$/i;
  const MSG_URL = /\/(?:v3\/chats|character-chats)\/([a-f0-9]{24})\/messages\/([a-f0-9]{24})(?:[?#]|$)/i;

  let debug = (() => {
    try { return pageWindow.localStorage.getItem('cpn:debug') === '1'; } catch (error) { return false; }
  })();
  const log = (...args) => { if (debug) console.log(LOG, ...args); };

  class UserError extends Error {}

  // ---------- 저장 ----------

  function readValue(key, fallback) {
    try {
      const value = GM_getValue(key, fallback);
      return value && typeof value === 'object' ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeValue(key, value) {
    try { GM_setValue(key, value); } catch (error) { console.warn(LOG, 'save failed', error); }
  }

  function deleteValue(key) {
    try { GM_deleteValue(key); } catch (error) { writeValue(key, {}); }
  }

  const settings = { paint: true, ...readValue(SETTINGS_KEY, {}) };
  // 다른 탭에서 '색칠'을 바꾸면 이 탭도 따라갑니다.
  if (typeof GM_addValueChangeListener === 'function') {
    try {
      GM_addValueChangeListener(SETTINGS_KEY, (name, before, after, remote) => {
        if (!remote || !after || typeof after !== 'object') return;
        settings.paint = after.paint !== false;
        schedulePaint(0);
      });
    } catch (error) { /* 무시 */ }
  }
  const books = new Map();
  const dirty = new Map();
  const watchedKeys = new Set();

  // 저장된 기록 가운데 모양이 이상한 것(손상·다른 판)은 버립니다.
  const isRecord = r => Boolean(r && typeof r === 'object' && typeof r.base === 'string' && typeof r.current === 'string' && Array.isArray(r.edits) && (r.spans === undefined || Array.isArray(r.spans)));
  function cleanBook(records) {
    const out = {};
    if (records && typeof records === 'object' && !Array.isArray(records)) {
      for (const [id, record] of Object.entries(records)) if (ID_RE.test(id) && isRecord(record)) out[id] = record;
    }
    return out;
  }

  // 방마다 { 메시지id: { base, current, spans, edits, at } }
  // base: 처음 본 원문, current: 마지막으로 확인한 서버 원문, spans: current 안에서 바뀐 자리 [시작, 끝] (끝=시작이면 지운 자리)
  function book(chatId) {
    if (!chatId) return {};
    if (!books.has(chatId)) {
      books.set(chatId, cleanBook(readValue(chatKey(chatId), {})));
      // 다른 탭이 같은 방 기록을 바꾸면 다시 읽습니다.
      if (!watchedKeys.has(chatId) && typeof GM_addValueChangeListener === 'function') {
        watchedKeys.add(chatId);
        try {
          GM_addValueChangeListener(chatKey(chatId), (name, before, after, remote) => {
            if (!remote) return;
            books.delete(chatId);
            schedulePaint();
          });
        } catch (error) { /* 무시 */ }
      }
    }
    return books.get(chatId);
  }

  function putRecord(chatId, msgId, record) {
    const records = book(chatId);
    if (record) records[msgId] = record;
    else delete records[msgId];
    const changes = dirty.get(chatId) || new Map();
    changes.set(msgId, record || null);
    dirty.set(chatId, changes);
  }

  // 다른 탭이 그사이 저장한 기록을 지우지 않도록, 저장된 것을 다시 읽어 이 탭이 바꾼 메시지만 덮어씁니다.
  function saveBook(chatId) {
    const records = cleanBook(readValue(chatKey(chatId), {}));
    (dirty.get(chatId) || new Map()).forEach((record, msgId) => {
      if (record) records[msgId] = record;
      else delete records[msgId];
    });
    dirty.delete(chatId);
    const ids = Object.keys(records);
    if (ids.length > LIMITS.messages) {
      ids.sort((a, b) => (records[b].at || 0) - (records[a].at || 0)).slice(LIMITS.messages).forEach(id => delete records[id]);
    }
    books.set(chatId, records);
    const index = readValue(INDEX_KEY, {});
    if (Object.keys(records).length) {
      writeValue(chatKey(chatId), records);
      index[chatId] = Date.now();
    } else {
      deleteValue(chatKey(chatId));
      delete index[chatId];
    }
    const chats = Object.keys(index);
    if (chats.length > LIMITS.chats) {
      chats.sort((a, b) => index[b] - index[a]).slice(LIMITS.chats).forEach(id => {
        delete index[id];
        books.delete(id);
        deleteValue(chatKey(id));
      });
    }
    writeValue(INDEX_KEY, index);
  }

  // ---------- 크랙 API (React 내부를 못 찾을 때만 씁니다) ----------

  function here() {
    const path = location.pathname;
    let m = path.match(/^\/stories\/([^/]+)\/episodes\/([a-f0-9]{24})/i);
    if (m) return { kind: 'story', chatId: m[2] };
    m = path.match(/^\/characters\/([^/]+)\/chats\/([a-f0-9]{24})/i);
    if (m) return { kind: 'character', chatId: m[2] };
    m = path.match(/^\/u\/([^/]+)\/c\/([a-f0-9]{24})/i);
    if (m) return { kind: 'character', chatId: m[2] };
    return { kind: '', chatId: '' };
  }

  const messagePath = (h, id) => (h.kind === 'character' ? `/character-chats/${h.chatId}/messages/${id}` : `/v3/chats/${h.chatId}/messages/${id}`);

  function getCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function api(method, path, body) {
    const headers = { accept: 'application/json, text/plain, */*', platform: 'web', 'wrtn-locale': 'ko-KR' };
    const token = getCookie('access_token');
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetch(API_BASE + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
    } catch (error) {
      throw new UserError('크랙 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (error) { json = null; }
    if (!response.ok) throw new UserError(json?.message ? `크랙이 거절했어요: ${json.message}` : `크랙 서버 오류 (${response.status})`);
    return json && typeof json === 'object' && 'data' in json ? json.data : json;
  }

  // ---------- 크랙 내부 연결 (React fiber) ----------
  // 크랙 화면은 메시지 저장소(zustand)에서 그려집니다. 크랙이 쓰는 updateMessage를 그대로 부르면 새로고침 없이 바뀝니다.

  const rawEl = el => (el && el.wrappedJSObject) || el;

  function fiberOf(el) {
    for (let cur = el, depth = 0; cur && depth < 15; cur = cur.parentElement, depth += 1) {
      const raw = rawEl(cur);
      let key = null;
      try { key = Object.keys(raw).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$')); } catch (error) { key = null; }
      if (key && raw[key]) return raw[key];
    }
    return null;
  }

  function propValues(fiber) {
    const values = [];
    for (const candidate of [fiber, fiber?.alternate]) {
      if (!candidate) continue;
      for (const props of [candidate.memoizedProps, candidate.pendingProps]) {
        const value = props?.value;
        if (value && typeof value === 'object' && !values.includes(value)) values.push(value);
      }
    }
    return values;
  }

  // 화면 요소에 붙은 fiber는 처음 만들어질 때의 것이라, 위로 따라가다 보면 한 번 전 렌더의 값(alternate)을 만날 수 있습니다.
  // 맨 위(HostRoot)가 지금 화면의 것이 아니면 짝(alternate) 쪽 값을 씁니다.
  function isCurrentTree(fiber) {
    let top = fiber;
    for (let depth = 0; top.return && depth < 3000; depth += 1) top = top.return;
    const current = top.stateNode && top.stateNode.current;
    return !current || current === top;
  }
  const liveProps = fiber => ((fiber.alternate && !isCurrentTree(fiber) ? fiber.alternate : fiber).memoizedProps || fiber.memoizedProps);

  const isMapLike = value => Boolean(value && typeof value.get === 'function' && typeof value.has === 'function' && typeof value.forEach === 'function');
  const isActions = value => typeof value?.updateMessage === 'function' && typeof value.resyncMessage === 'function' && typeof value.removeMessage === 'function';
  const isChatState = value => Boolean(value && typeof value.status === 'string' && 'selectedMessageId' in value && 'chatId' in value);
  const isStore = value => {
    if (!value || typeof value.getState !== 'function' || typeof value.subscribe !== 'function') return false;
    try { return isMapLike(value.getState()?.messages); } catch (error) { return false; }
  };

  // ChatActions는 크랙이 다시 그릴 때마다 새로 만들어지므로 쓸 때마다 다시 찾습니다.
  function findBridge(anchor) {
    const h = here();
    const start = fiberOf(anchor) || fiberOf(document.querySelector('[data-message-group-id] .wrtn-markdown')) || fiberOf(document.querySelector('[data-message-group-id]'));
    const out = { fiber: Boolean(start), actions: null, state: null, store: null, mismatch: false };
    for (let fiber = start, depth = 0; fiber && depth < 500; fiber = fiber.return, depth += 1) {
      for (const value of propValues(fiber)) {
        try {
          for (const [slot, test] of [['actions', isActions], ['state', isChatState], ['store', isStore]]) {
            if (out[slot] || !test(value)) continue;
            const live = liveProps(fiber)?.value;
            out[slot] = live && test(live) ? live : value;
          }
        } catch (error) { /* 무시 */ }
      }
      if (out.actions && out.state && out.store) break;
    }
    if (out.state && h.chatId && String(out.state.chatId) !== h.chatId) {
      out.mismatch = true;
      out.actions = null;
    }
    if (out.store) watchStore(out.store);
    return out;
  }

  // 메시지 한 개의 화면 = 그룹 안의 .wrtn-markdown 전부. 캐릭터 채팅은 문단마다 말풍선(.wrtn-markdown)이 따로 있습니다.
  const groupOf = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('[data-message-group-id]') || null;
  const mdsOf = group => Array.from(group.querySelectorAll('.wrtn-markdown'));

  // 그룹이 어느 메시지인지 찾습니다. 그룹 id는 첫 메시지 id라서, 답변 비교 중이면 실제로 보이는 메시지와 다를 수 있습니다.
  // wanted가 있으면 그 id가 이 그룹에 없을 때 바로 null을 돌려줍니다(칠하기를 가볍게).
  function messageOf(group, bridge, wanted) {
    if (!group) return null;
    const groupId = group.dataset.messageGroupId;
    const mds = mdsOf(group);
    if (!mds.length) return null;
    let shown = null;
    let ids = null;
    for (let fiber = fiberOf(mds[0]), depth = 0; fiber && depth < 80; fiber = fiber.return, depth += 1) {
      const raw = fiber.memoizedProps;
      if (!raw || typeof raw !== 'object') continue;
      if (shown === null && typeof raw.content === 'string' && 'isUserMessage' in raw) shown = liveProps(fiber)?.content ?? raw.content;
      if (Array.isArray(raw.messageIds)) {
        ids = Array.from(liveProps(fiber)?.messageIds || raw.messageIds);
        break;
      }
    }
    const state = bridge?.store ? bridge.store.getState() : null;
    if (!ids && state?.messageGroups) {
      const found = Array.from(state.messageGroups).find(item => item && item[0] === groupId);
      if (found) ids = Array.from(found);
    }
    if (!ids) ids = [groupId];
    if (wanted && !ids.some(id => wanted.has(id))) return null;
    let message = null;
    if (state) {
      const candidates = ids.map(id => state.messages.get(id)).filter(item => item && typeof item.content === 'string');
      // 같은 글의 답변이 여럿이면 크랙이 고른 답변(selectedMessageId), 없으면 마지막 답변을 씁니다.
      const selectedId = bridge?.state?.selectedMessageId;
      const pick = list => list.find(item => item._id === selectedId) || list[list.length - 1] || null;
      // props 글과 정확히 같은지는 말풍선이 하나일 때만 믿습니다(말풍선이 여럿이면 props는 첫 문단뿐).
      message = shown !== null && mds.length === 1 ? pick(candidates.filter(item => item.content === shown)) : null;
      if (!message && candidates.length > 1) {
        // 문단별 말풍선이라 props가 문단 하나뿐이면, 화면 글과 가장 잘 맞는 답변을 고릅니다. 점수가 같으면 위 규칙으로 고릅니다.
        let best = -1;
        let ties = [];
        for (const item of candidates) {
          const score = coverage(item.content, mds);
          if (score > best + 1e-9) {
            best = score;
            ties = [item];
          } else if (Math.abs(score - best) <= 1e-9) ties.push(item);
        }
        message = best < 0.9 ? null : pick(ties);
      }
      if (!message && candidates.length) {
        const index = ids.indexOf(bridge.state?.selectedMessageId ?? '');
        message = state.messages.get(ids[index >= 0 ? index : ids.length - 1]) || candidates[candidates.length - 1];
      }
    }
    return {
      group,
      mds,
      groupId,
      ids,
      msgId: message?._id || (ids.length === 1 ? ids[0] : null),
      content: typeof message?.content === 'string' ? message.content : shown,
      fromStore: Boolean(message),
    };
  }

  const streamingNow = () => Boolean(document.querySelector('.wrtn-markdown .animate'));
  const nativeEditorOpen = group => Boolean(group?.querySelector('.ProseMirror:not(.__chat_input_textarea), [contenteditable="true"]:not(.__chat_input_textarea)'));
  const normalize = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');

  // ---------- 원문 ↔ 화면 글자 맞추기 ----------

  // 화면에 안 그려지는 것: 링크 정의 줄([//]: # (…), [//]: <> (…)), 이미지, 링크 주소 부분(](…)), 줄 앞 목록·인용·제목 기호.
  // HTML 주석은 크랙이 글자 그대로 보여 주므로, 화면에 '<!--'가 없을 때(다른 확프가 지운 경우)만 뺍니다.
  // 정의 줄의 제목 (…)은 다음 줄이나 여러 줄에 걸칠 수도 있습니다(빈 줄 전까지). 크랙도 이것을 숨깁니다.
  const LINK_DEF_RE = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\n?[ \t]*(?:<[^>\n]*>|[^\s<>]+)(?:[ \t]*\n?[ \t]*(?:"(?:[^"\n]|\n(?![ \t]*\n))*"|'(?:[^'\n]|\n(?![ \t]*\n))*'|\((?:[^()\n]|\n(?![ \t]*\n))*\)))?[ \t]*(?:\n|$)/gm;
  // 표의 정렬 줄(|:---|---:|)
  const TABLE_DELIM_RE = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$/gm;
  const IMAGE_RE = /!\[[^\]\n]*\]\([^)\n]*\)/g;
  const LINK_DEST_RE = /\]\([^)\n]*\)/g;
  const COMMENT_RE = /<!--[\s\S]*?-->/g;
  const BLOCK_MARK_RE = /^[ \t]*(?:>[ \t]?|(?:\d{1,9}[.)]|[-+*]|#{1,6})[ \t]+)+/gm;

  // 코드블록(``` 또는 ~~~) 안쪽 범위. 그 안의 '- '·'1. '·'[x]: …' 같은 줄은 화면에 글자 그대로 보입니다.
  // 여는 줄의 정보 문자열(```INFO)은 크랙이 코드블록 머리표로 보여 주므로 빼지 않습니다.
  function fenceRanges(src) {
    const out = [];
    let open = null;
    const re = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/gm;
    let m;
    while ((m = re.exec(src))) {
      if (!open) {
        if (m[1][0] === '`' && m[2].includes('`')) continue;
        open = { start: m.index + m[0].length, ch: m[1][0], len: m[1].length };
      } else if (m[1][0] === open.ch && m[1].length >= open.len && !m[2].trim()) {
        out.push([open.start, m.index]);
        open = null;
      }
    }
    if (open) out.push([open.start, src.length]);
    return out;
  }

  function stripHidden(src, ren) {
    const drop = new Uint8Array(src.length);
    const fences = fenceRanges(src);
    const inFence = i => fences.some(([s, e]) => i >= s && i < e);
    const res = [LINK_DEF_RE, IMAGE_RE, LINK_DEST_RE, BLOCK_MARK_RE, TABLE_DELIM_RE];
    if (!ren.includes('<!--')) res.push(COMMENT_RE);
    for (const re of res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        if (!m[0].length) {
          re.lastIndex += 1;
          continue;
        }
        if (inFence(m.index)) continue;
        // 문단에 바로 붙은 정의 줄은 문단을 끊지 못해 화면에 글자 그대로 보입니다.
        if (re === LINK_DEF_RE && ren.includes(m[0].trim())) continue;
        // 문단 바로 다음 줄의 '2. '처럼 1이 아닌 번호도 문단을 끊지 못해 글자 그대로 보입니다.
        if (re === BLOCK_MARK_RE && m.index > 0 && /^[ \t]*\d/.test(m[0]) && !/^[ \t]*0*1[.)]/.test(m[0])) {
          const prevEnd = m.index - 1;
          const prevLine = src.slice(src.lastIndexOf('\n', prevEnd - 1) + 1, prevEnd);
          if (prevLine.trim() && !/^[ \t]{0,3}(?:\d{1,9}[.)]|[-+*]|#{1,6}|`{3,}|~{3,})(?:[ \t]|$)/.test(prevLine) && !/^[ \t]*\|/.test(prevLine)) continue;
        }
        drop.fill(1, m.index, m.index + m[0].length);
      }
    }
    const keep = [];
    const parts = [];
    for (let i = 0; i < src.length; i += 1) {
      if (drop[i]) continue;
      keep.push(i);
      parts.push(src[i]);
    }
    return { text: parts.join(''), keep };
  }

  const SKIP_SEL = 'button, svg, style, script, textarea, input, select, [aria-hidden="true"], .cpn-ui';

  function renderedText(mds) {
    const nodes = [];
    let text = '';
    for (const md of mds) {
      const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          const skip = node.parentElement?.closest(SKIP_SEL);
          return skip && md.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push({ node, start: text.length });
        text += node.nodeValue;
      }
    }
    return { text, nodes };
  }

  const SYNTAX = new Set('*_~`#>|-+=[]()!\\'.split(''));
  const SPACE = /\s/;
  const LETTER = /[\p{L}\p{N}]/u;
  const entityBox = document.createElement('textarea');
  function decodeEntity(entity) {
    entityBox.innerHTML = entity;
    return entityBox.value;
  }

  // 화면 글자는 원문에서 서식 기호만 빠진 모양이라, 앞에서부터 짝을 지어 갑니다. 어긋나면 다음 몇 글자를 원문에서 찾아 다시 맞춥니다.
  // 그렇게 건너뛰면서 글자(기호가 아닌 것)를 넘긴 자리는 jumps에 표시해 두고, 그 자리를 고칠 때는 원문 창으로 넘깁니다.
  function align(src, ren) {
    const r2s = new Int32Array(ren.length).fill(-1);
    const jumps = new Uint8Array(ren.length);
    let i = 0;
    let j = 0;
    while (j < ren.length && i < src.length) {
      const a = src[i];
      const c = ren[j];
      // 문자 참조(&amp; 등)를 먼저 봅니다. '&' 한 글자만 짝지으면 'amp;'가 남거나 엉뚱한 곳으로 건너뜁니다.
      // 인라인 코드처럼 참조가 화면에도 그대로 보이면 보통 글자로 맞춥니다.
      if (a === '&') {
        const entity = /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.exec(src.slice(i, i + 12));
        if (entity && !ren.startsWith(entity[0], j) && decodeEntity(entity[0]) === c) {
          jumps[j] = 1;
          r2s[j] = i;
          i += entity[0].length;
          j += 1;
          continue;
        }
      }
      if (a === c) {
        r2s[j] = i;
        i += 1;
        j += 1;
        continue;
      }
      if (SPACE.test(c) && !SPACE.test(a) && !SYNTAX.has(a)) {
        j += 1;
        continue;
      }
      if (SYNTAX.has(a) || SPACE.test(a)) {
        if (a === '\\') jumps[j] = 1;
        i += 1;
        continue;
      }
      const probe = ren.slice(j, j + 6);
      const k = probe.length >= 2 ? src.indexOf(probe, i) : -1;
      if (k >= 0 && k - i < 600) {
        if (LETTER.test(src.slice(i, k))) jumps[j] = 1;
        i = k;
        continue;
      }
      jumps[j] = 1;
      j += 1;
    }
    return { r2s, jumps };
  }

  // 뒤에서부터 맞춘 결과. 앞에서 맞춘 자리와 다르면 숨은 글(주석 등)에 같은 말이 있어 헷갈린 것이므로 원문 창으로 넘깁니다.
  function alignBack(src, ren) {
    const rev = text => text.split('').reverse().join('');
    const { r2s } = align(rev(src), rev(ren));
    const out = new Int32Array(ren.length).fill(-1);
    for (let j = 0; j < ren.length; j += 1) {
      const s = r2s[ren.length - 1 - j];
      out[j] = s < 0 ? -1 : src.length - 1 - s;
    }
    return out;
  }

  function offsetOf(nodes, root, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const hit = nodes.find(item => item.node === container);
      if (hit) return hit.start + offset;
    }
    const before = document.createRange();
    before.setStart(root, 0);
    try { before.setEnd(container, offset); } catch (error) { return -1; }
    let pos = 0;
    for (const item of nodes) {
      if (before.intersectsNode(item.node)) pos = item.start + item.node.nodeValue.length;
      else break;
    }
    return pos;
  }

  function rangeFor(nodes, start, end) {
    const locate = (pos, isEnd) => {
      let lo = 0;
      let hi = nodes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (nodes[mid].start < pos || (!isEnd && nodes[mid].start === pos)) lo = mid;
        else hi = mid - 1;
      }
      const item = nodes[lo];
      return [item.node, Math.max(0, Math.min(item.node.nodeValue.length, pos - item.start))];
    };
    if (!nodes.length || end <= start) return null;
    const range = document.createRange();
    const [sn, so] = locate(start, false);
    const [en, eo] = locate(end, true);
    try {
      range.setStart(sn, so);
      range.setEnd(en, eo);
    } catch (error) {
      return null;
    }
    return range;
  }

  // 선택한 화면 글자 → 원문 위치. 결과의 oldText는 '보이는 글자(와 공백)'만 모은 것이고, vpos는 그 글자들의 원문 위치입니다.
  function mapSelection(mds, range, src) {
    const { text: ren, nodes } = renderedText(mds);
    let rs = offsetOf(nodes, mds[0], range.startContainer, range.startOffset);
    let re = offsetOf(nodes, mds[0], range.endContainer, range.endOffset);
    if (rs < 0 || re < 0) return { ok: false };
    if (rs > re) [rs, re] = [re, rs];
    while (rs < re && SPACE.test(ren[rs])) rs += 1;
    while (re > rs && SPACE.test(ren[re - 1])) re -= 1;
    if (rs >= re) return { ok: false };
    const stripped = stripHidden(src, ren);
    const { r2s, jumps } = align(stripped.text, ren);
    const back = alignBack(stripped.text, ren);
    const visible = new Uint8Array(src.length);
    let first = -1;
    let last = -1;
    let missing = 0;
    for (let j = rs; j < re; j += 1) {
      const s = r2s[j];
      if (jumps[j]) missing += 1;
      if (s >= 0 && !SPACE.test(ren[j]) && back[j] !== s) missing += 1;
      if (s < 0) {
        if (!SPACE.test(ren[j])) missing += 1;
        continue;
      }
      if (first >= 0 && s <= last) missing += 1;
      if (first < 0) first = s;
      last = s;
      visible[stripped.keep[s]] = 1;
    }
    const shownText = ren.slice(rs, re);
    if (first < 0) return { ok: false, shownText };
    const a = stripped.keep[first];
    const b = stripped.keep[last] + 1;
    if (missing) return { ok: false, approx: [a, b], shownText };
    const inStripped = new Uint8Array(src.length);
    stripped.keep.forEach(index => { inStripped[index] = 1; });
    let oldText = '';
    const vpos = [];
    for (let i = a; i < b; i += 1) {
      if (visible[i] || (inStripped[i] && SPACE.test(src[i]))) {
        oldText += src[i];
        vpos.push(i);
      }
    }
    return { ok: true, a, b, oldText, vpos, shownText };
  }

  // 화면 글자 중 원문과 짝이 맞은 비율. 화면이 정말 그 원문인지 판단하는 데 씁니다.
  function coverage(src, mds) {
    const { text: ren } = renderedText(mds);
    const { r2s } = align(stripHidden(src, ren).text, ren);
    let total = 0;
    let hit = 0;
    for (let j = 0; j < ren.length; j += 1) {
      if (SPACE.test(ren[j])) continue;
      total += 1;
      if (r2s[j] >= 0) hit += 1;
    }
    return total ? hit / total : 0;
  }

  // 원문 위치(spans) → 화면 Range
  function rangesFor(mds, record) {
    const { text: ren, nodes } = renderedText(mds);
    const stripped = stripHidden(record.current, ren);
    const { r2s } = align(stripped.text, ren);
    const s2r = new Int32Array(record.current.length).fill(-1);
    for (let j = 0; j < r2s.length; j += 1) if (r2s[j] >= 0) s2r[stripped.keep[r2s[j]]] = j;
    const ranges = [];
    const cuts = [];
    for (const [s, e] of record.spans || []) {
      if (e > s) {
        let runStart = -1;
        let prev = -2;
        const flush = () => {
          if (runStart >= 0) {
            const range = rangeFor(nodes, runStart, prev + 1);
            if (range) ranges.push(range);
          }
        };
        for (let i = s; i < Math.min(e, s2r.length); i += 1) {
          const j = s2r[i];
          if (j < 0) continue;
          if (j !== prev + 1) {
            flush();
            runStart = j;
          }
          prev = j;
        }
        flush();
      } else {
        // 지운 자리: 같은 줄의 뒤 글자 → 같은 줄의 앞 글자 → (그래도 없으면) 줄을 넘어서 찾습니다.
        // 줄 끝을 지웠을 때 밑줄이 다음 문단 첫 글자에 그어지지 않게 하고, 공백·줄바꿈 글자에는 긋지 않습니다.
        const cur = record.current;
        const shown = i => (s2r[i] >= 0 && !SPACE.test(ren[s2r[i]]) ? s2r[i] : -1);
        let j = -1;
        for (let i = s; i < Math.min(s2r.length, s + 40) && j < 0 && cur[i] !== '\n'; i += 1) j = shown(i);
        for (let i = s - 1; i >= Math.max(0, s - 40) && j < 0 && cur[i] !== '\n'; i -= 1) j = shown(i);
        for (let i = s; i < Math.min(s2r.length, s + 40) && j < 0; i += 1) j = shown(i);
        for (let i = s - 1; i >= Math.max(0, s - 40) && j < 0; i -= 1) j = shown(i);
        if (j >= 0) {
          const range = rangeFor(nodes, j, j + 1);
          if (range) cuts.push(range);
        }
      }
    }
    return { ranges, cuts };
  }

  // ---------- 바꿀 자리 계산 ----------

  const isDelim = ch => ch === '*' || ch === '_' || ch === '~';

  // 안전망: CommonMark 강조 규칙(process emphasis)으로 한 블록에서 짝을 못 찾아 글자로 남는 * _ 개수.
  // 고친 뒤 이 수가 늘면 화면에 별표·밑줄이 드러나는 것이므로 원문 창으로 넘깁니다.
  function emphasisLeft(s) {
    const ws = c => c === undefined || /\s/.test(c);
    const pu = c => c !== undefined && /[\p{P}\p{S}]/u.test(c);
    // 이모지 같은 서로게이트 쌍은 한 글자(코드 포인트)로 봅니다.
    const prevCp = idx => {
      if (idx <= 0) return undefined;
      const lo = s.charCodeAt(idx - 1);
      if (lo >= 0xdc00 && lo <= 0xdfff && idx >= 2) {
        const hi = s.charCodeAt(idx - 2);
        if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(idx - 2, idx);
      }
      return s[idx - 1];
    };
    const nextCp = idx => (idx >= s.length ? undefined : String.fromCodePoint(s.codePointAt(idx)));
    const D = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1])) {
        i += 2;
        continue;
      }
      if (c === '`') {
        let e = i;
        while (s[e] === '`') e += 1;
        const n = e - i;
        let k = e;
        let found = -1;
        while (k < s.length) {
          if (s[k] === '`') {
            let f = k;
            while (s[f] === '`') f += 1;
            if (f - k === n) {
              found = f;
              break;
            }
            k = f;
          } else k += 1;
        }
        i = found >= 0 ? found : e;
        continue;
      }
      if (c === '*' || c === '_') {
        let e = i;
        while (s[e] === c) e += 1;
        const p = prevCp(i);
        const n = nextCp(e);
        const L = !ws(n) && (!pu(n) || ws(p) || pu(p));
        const R = !ws(p) && (!pu(p) || ws(n) || pu(n));
        const open = c === '_' ? L && (!R || pu(p)) : L;
        const close = c === '_' ? R && (!L || pu(n)) : R;
        D.push({ c, n: e - i, len: e - i, open, close, dead: false });
        i = e;
        continue;
      }
      i += 1;
    }
    for (let ci = 0; ci < D.length; ci += 1) {
      const cl = D[ci];
      if (!cl.close || cl.dead) continue;
      while (cl.n > 0) {
        let oi = -1;
        for (let k = ci - 1; k >= 0; k -= 1) {
          const op = D[k];
          if (op.dead || op.n === 0 || op.c !== cl.c || !op.open) continue;
          if ((op.close || cl.open) && (op.len + cl.len) % 3 === 0 && !(op.len % 3 === 0 && cl.len % 3 === 0)) continue;
          oi = k;
          break;
        }
        if (oi < 0) break;
        const op = D[oi];
        const use = op.n >= 2 && cl.n >= 2 ? 2 : 1;
        op.n -= use;
        cl.n -= use;
        for (let k = oi + 1; k < ci; k += 1) D[k].dead = true;
      }
    }
    return D.reduce((sum, d) => sum + d.n, 0);
  }

  function literalDelims(text) {
    const blocks = [];
    let cur = [];
    const flush = () => {
      if (cur.length) blocks.push(cur.join('\n'));
      cur = [];
    };
    for (const raw of String(text).split('\n')) {
      if (/^[ \t]*$/.test(raw) || /^[ \t]{0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(raw) || /^[ \t]{0,3}\[[^\]\n]+\]:/.test(raw)) {
        flush();
        continue;
      }
      const m = /^[ \t]*(?:>[ \t]?|(?:\d{1,9}[.)]|[-+*]|#{1,6})[ \t]+)+/.exec(raw);
      if (m) {
        flush();
        cur.push(raw.slice(m[0].length));
      } else cur.push(raw);
    }
    flush();
    return blocks.reduce((sum, block) => sum + emphasisLeft(block), 0);
  }

  // 선택한 글(oldText)과 새 글을 앞뒤로 비교해 실제로 달라진 가운데만 원문에서 바꿉니다. 그래서 서식 기호는 대부분 제자리에 남습니다.
  // 바꾸면 서식이 깨질 수 있는 경우는 null을 돌려주고, 그때는 원문 창으로 넘깁니다.
  function planSplice(src, mapped, replacement) {
    const old = mapped.oldText;
    const vpos = mapped.vpos;
    const max = Math.min(old.length, replacement.length);
    let p = 0;
    while (p < max && old[p] === replacement[p]) p += 1;
    if (p > 0 && /[\uD800-\uDBFF]/.test(old[p - 1])) p -= 1;
    let s = 0;
    while (s < max - p && old[old.length - 1 - s] === replacement[replacement.length - 1 - s]) s += 1;
    if (s > 0 && /[\uDC00-\uDFFF]/.test(old[old.length - s])) s -= 1;
    const oldEnd = old.length - s;
    const ins = replacement.slice(p, replacement.length - s);
    let a;
    let b;
    if (oldEnd > p) {
      a = vpos[p];
      b = vpos[oldEnd - 1] + 1;
    } else {
      a = p > 0 ? vpos[p - 1] + 1 : vpos[0];
      // 줄바꿈 바로 뒤에 넣는 글은 그 줄의 목록·인용 기호 뒤에 넣습니다(- 첫째\n그리고 - 둘째 가 되지 않게).
      if (p > 0 && src[a - 1] === '\n') {
        const mark = /^[ \t]*(?:>[ \t]?|(?:\d{1,9}[.)]|[-+*]|#{1,6})[ \t]+)+/.exec(src.slice(a));
        if (mark) a += mark[0].length;
      }
      b = a;
    }
    const changed = new Set(vpos.slice(p, oldEnd));
    let kept = '';
    for (let i = a; i < b; i += 1) if (!changed.has(i)) kept += src[i];
    const removed = src.slice(a, b);
    // 바뀌는 가운데에 기울임·굵게 기호가 끼어 있으면 그 기호를 새 글 바로 뒤에 둡니다.
    // 기호 양옆이 글자일 때만 서식이 유지되므로, 공백·줄바꿈이 닿거나 다른 기호(목록·링크·이스케이프)가 끼면 원문 창으로 넘깁니다.
    // 밑줄(_)은 단어 안에서 열고 닫히지 않으므로 옮기지 않고, 기호 양옆은 둘 다 글자여야 합니다(공백·문장부호가 닿으면 서식이 풀림).
    if (kept) {
      if (!/^[*~]+$/.test(kept) || removed.includes('\n') || ins.includes('\n')) return null;
      const before = ins ? ins[ins.length - 1] : src[a - 1];
      const after = src[b];
      if (!before || !after || !LETTER.test(before) || !LETTER.test(after)) return null;
    }
    // 새 글의 앞뒤 공백이 기호 안쪽에 붙으면(*비가 오기 *) 서식이 풀립니다.
    if (/^\s/.test(ins) && isDelim(src[a - 1])) return null;
    if (/\s$/.test(ins) && !kept && isDelim(src[b])) return null;
    // 서식이 있는 문단 안에 줄바꿈을 넣으면 기울임이 풀려 별표가 보이므로 원문 창에서 합니다.
    if (ins.includes('\n')) {
      const ps = src.lastIndexOf('\n\n', a);
      const pe = src.indexOf('\n\n', b);
      if (/[*_~`]/.test(src.slice(ps < 0 ? 0 : ps, pe < 0 ? src.length : pe))) return null;
      // 새 줄의 맨 앞이 '- '·'> '·'1. '처럼 되면 목록·인용이 됩니다.
      const le = src.indexOf('\n', b);
      const tail = ins.slice(ins.lastIndexOf('\n') + 1) + src.slice(b, le < 0 ? src.length : le);
      if (/^[ \t]*(?:>|(?:\d{1,9}[.)]|[-+*]|#{1,6})(?:[ \t]|$))/.test(tail)) return null;
    }
    // 줄을 합치면 다음 줄 앞의 목록·인용·제목 기호가 글자로 남으므로 원문 창에서 합니다.
    if (removed.includes('\n')) {
      const lineAt = src.lastIndexOf('\n', b - 1) + 1;
      if (lineAt > a && /^[ \t]*(?:>|(?:\d{1,9}[.)]|[-+*]|#{1,6})[ \t])/.test(src.slice(lineAt))) return null;
    }
    if (!ins && !kept) [a, b] = tidyDelete(src, a, b);
    const next = src.slice(0, a) + ins + kept + src.slice(b);
    // 안전망 1: 짝 없는(글자로 보일) * _ 가 늘면 원문 창. 새 글에 사용자가 직접 쓴 * _ 만큼은 허용합니다(snake_case 같은 글).
    if (literalDelims(next) - literalDelims(src) > (ins.match(/[*_]/g) || []).length) return null;
    // 안전망 2: 새 글이 직접 넣은 것 말고, 줄 앞 목록·인용·제목 기호 줄이 새로 생기면 원문 창
    const BM = /^[ \t]*(?:>|(?:\d{1,9}[.)]|[-+*]|#{1,6})(?:[ \t]|$))/;
    const marks = text => text.split('\n').filter(line => BM.test(line)).length;
    const typed = ins.split('\n').slice(1).filter(line => BM.test(line)).length;
    if (marks(next) > marks(src) + typed) return null;
    return { a, b, ins, kept, next };
  }

  const isBlank = ch => ch === ' ' || ch === '\t';
  const CLOSE_NEXT = /[\s.,!?…~"'”’」』)\]]/;

  // 지운 뒤 서식이 깨지지 않게 다듬습니다.
  // 1) *글*·`코드`의 글을 통째로 지우면 남는 빈 기호 쌍(**, ****, ``)도 지웁니다.
  // 2) 닫는 기호 바로 앞(*글 *)이나 여는 기호 바로 뒤(* 글*)에 공백이 남으면 그 공백을 지웁니다.
  //    크랙에서는 이럴 때 기울임이 풀려 별표가 그대로 보이기 때문입니다. 단어 사이 공백(**철수** 학교)은 건드리지 않습니다.
  function tidyDelete(src, a, b) {
    for (let guard = 0; guard < 3; guard += 1) {
      const left = /[*_~`]+$/.exec(src.slice(Math.max(0, a - 4), a))?.[0] || '';
      const right = /^[*_~`]+/.exec(src.slice(b, b + 4))?.[0] || '';
      if (!left || !right) break;
      const ch = right[0];
      let l = 0;
      while (l < left.length && left[left.length - 1 - l] === ch) l += 1;
      let r = 0;
      while (r < right.length && right[r] === ch) r += 1;
      const k = Math.min(l, r);
      if (!k) break;
      // 짝이 아닌 기호(여는 쪽 앞이 글자, 밑줄 닫는 쪽 뒤가 글자)는 빈 쌍이 아니므로 넓히지 않습니다.
      const ls = a - left.length;
      if (ls > 0 && !/[\s\p{P}\p{S}]/u.test(src[ls - 1])) break;
      if (ch === '_' && b + right.length < src.length && !/[\s\p{P}\p{S}]/u.test(src[b + right.length])) break;
      a -= k;
      b += k;
    }
    const closerAt = i => {
      if (!isDelim(src[i])) return false;
      let j = i;
      while (isDelim(src[j])) j += 1;
      if (j >= src.length || CLOSE_NEXT.test(src[j])) return true;
      // *비가 내리기*를 처럼 닫는 기호 바로 뒤에 조사가 붙은 경우: 앞쪽에 짝 없는 여는 기호가 있을 때만 닫는 기호로 봅니다.
      if (src[i] === '_' || !LETTER.test(src[j])) return false;
      const ps = src.lastIndexOf('\n\n', i);
      const head = src.slice(ps < 0 ? 0 : ps, i);
      return ((head.match(src[i] === '*' ? /\*+/g : /~+/g) || []).length % 2) === 1;
    };
    const openerBefore = i => {
      let j = i;
      while (j > 0 && isDelim(src[j - 1])) j -= 1;
      return j < i && (j === 0 || SPACE.test(src[j - 1]));
    };
    const lineStart = a === 0 || src[a - 1] === '\n';
    if (isBlank(src[a - 1]) && (b >= src.length || src[b] === '\n' || closerAt(b))) {
      while (a > 0 && isBlank(src[a - 1])) a -= 1;
    } else if (isBlank(src[b]) && (lineStart || openerBefore(a))) {
      while (b < src.length && isBlank(src[b])) b += 1;
    } else if (isBlank(src[a - 1]) && isBlank(src[b])) {
      // 낱말을 통째로 지워 양옆 공백이 두 칸 남으면 한 칸으로 줄입니다(크랙은 공백을 그대로 보여 줘서 두 칸이 보임).
      b += 1;
    }
    return [a, b];
  }

  // ---------- 흔적 계산 ----------

  // [a, b) 자리를 newLen 글자로 바꿨을 때 이전 흔적 위치를 옮기고, 새로 바뀐 자리(repLen)를 더합니다.
  function shiftSpans(spans, a, b, newLen, repLen) {
    const delta = newLen - (b - a);
    const out = [];
    for (const [s, e] of spans || []) {
      if (e === s) {
        if (s < a) out.push([s, s]);
        else if (s > b) out.push([s + delta, s + delta]);
        continue;
      }
      if (e <= a) out.push([s, e]);
      else if (s >= b) out.push([s + delta, e + delta]);
      else {
        if (s < a) out.push([s, a]);
        if (e > b) out.push([b + delta, e + delta]);
      }
    }
    out.push(repLen > 0 ? [a, a + repLen] : [a, a]);
    out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged = [];
    for (const span of out) {
      const prev = merged[merged.length - 1];
      if (prev && prev[1] > prev[0] && span[1] > span[0] && span[0] <= prev[1]) prev[1] = Math.max(prev[1], span[1]);
      else if (prev && span[0] === span[1] && prev[1] > prev[0] && span[0] >= prev[0] && span[0] <= prev[1]) continue;
      else if (prev && prev[0] === prev[1] && span[1] > span[0] && prev[0] >= span[0] && prev[0] <= span[1]) merged[merged.length - 1] = span;
      else merged.push(span);
    }
    return merged;
  }

  // 크랙 수정창·원문 창·다른 확프의 일괄 바꾸기처럼 여러 군데가 한 번에 바뀐 것은 낱말 단위로 비교해
  // 바뀐 조각마다 따로 흔적을 남깁니다(처음 바뀐 곳~마지막 바뀐 곳을 통째로 칠하지 않게).
  // 결과: [{ a, b(옛 글 위치), oldText, newText }] (앞에서부터)
  function changeList(before, after) {
    const changes = [];
    let oldPos = 0;
    let cur = null;
    for (const [type, text] of diffParts(before, after)) {
      if (type === '=') {
        if (cur) changes.push(cur);
        cur = null;
        oldPos += text.length;
        continue;
      }
      if (!cur) cur = { a: oldPos, b: oldPos, oldText: '', newText: '' };
      if (type === '-') {
        cur.b += text.length;
        cur.oldText += text;
        oldPos += text.length;
      } else cur.newText += text;
    }
    if (cur) changes.push(cur);
    return changes;
  }

  // 뒤쪽 조각부터 옮겨야 앞쪽 조각의 옛 위치가 그대로 맞습니다.
  function applyChanges(spans, changes) {
    let out = spans || [];
    for (let i = changes.length - 1; i >= 0; i -= 1) {
      const c = changes[i];
      out = shiftSpans(out, c.a, c.b, c.newText.length, c.newText.length);
    }
    return out;
  }

  // 흔적 창에 보일 '원래 → 바뀐 글' (조각이 여럿이면 … 로 이어 붙임)
  function changeSummary(changes) {
    return { before: changes.map(c => c.oldText).filter(Boolean).join(' … '), after: changes.map(c => c.newText).filter(Boolean).join(' … ') };
  }

  // 통째로 바뀐 경우(크랙 수정창·원문 편집)는 앞뒤가 같은 부분을 빼고 가운데를 바뀐 자리로 봅니다.
  function wholeChange(before, after) {
    let p = 0;
    const max = Math.min(before.length, after.length);
    while (p < max && before[p] === after[p]) p += 1;
    // 이모지 같은 서로게이트 쌍을 반으로 자르지 않습니다.
    if (p > 0 && /[\uD800-\uDBFF]/.test(before[p - 1])) p -= 1;
    let s = 0;
    while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s += 1;
    if (s > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - s])) s -= 1;
    return { a: p, b: before.length - s, newLen: after.length - s - p, oldText: before.slice(p, before.length - s), newText: after.slice(p, after.length - s) };
  }

  // ---------- 저장 경로 ----------

  // 우리가 쓴 내용은 '크랙 수정창 기록'으로 잘못 남지 않게 잠깐 표시해 둡니다. 저장이 끝나면 2초 뒤 풀어서, 곧이어 크랙 수정창으로 고친 것은 기록되게 합니다.
  const ownWrites = new Map();
  function pruneOwn(id) {
    const entry = ownWrites.get(id);
    if (!entry) return;
    const now = Date.now();
    entry.forEach((until, key) => { if (until <= now) entry.delete(key); });
    if (!entry.size) ownWrites.delete(id);
  }
  function markOwn(id, ttl, ...contents) {
    pruneOwn(id);
    const entry = ownWrites.get(id) || new Map();
    const until = Date.now() + ttl;
    contents.forEach(content => entry.set(normalize(content), until));
    ownWrites.set(id, entry);
  }
  function settleOwn(id) {
    const entry = ownWrites.get(id);
    const until = Date.now() + 2000;
    entry?.forEach((value, key) => entry.set(key, Math.min(value, until)));
  }
  const isOwn = (id, content) => {
    pruneOwn(id);
    return (ownWrites.get(id)?.get(normalize(content)) || 0) > Date.now();
  };

  // 저장 중인 메시지. 이 동안에는 화면이 잠깐 원문으로 보여도 기록을 지우지 않습니다.
  const inFlight = new Set();
  // 크랙 내부를 못 찾아 서버에만 저장한 메시지(새로고침 전까지 화면은 옛 글)
  const reloadNeeded = new Set();
  const diagState = { lastPath: '', lastError: '', xhrHooked: false, xhrWrapped: false, fetchHooked: false, nativeCaptured: 0 };

  // 보이는 글이 하나도 남지 않으면(숨김 주석·목록 기호·폭 0 글자만 남음) 빈 메시지로 봅니다.
  function visibleLeft(text) {
    return stripHidden(String(text ?? ''), '<!--').text
      .replace(/^[ \t]*(?:>[ \t]?|(?:\d{1,9}[.)]|[-+*]|#{1,6})(?=[ \t]|$))+/gm, '')
      .replace(/[\s​-‍⁠﻿ㅤᅟᅠ]/g, '');
  }

  // 크랙과 같은 길(A1) → 저장소만 직접 고치기(A2) → API로만 고치고 새로고침 안내(C) 순서로 시도합니다.
  async function writeContent(target, next) {
    const h = here();
    if (h.chatId !== target.chatId) throw new UserError('다른 방으로 옮겨져서 취소했어요.');
    if (!normalize(next) || !visibleLeft(next)) throw new UserError('메시지를 전부 비울 수는 없어요.');
    if (inFlight.has(target.msgId)) throw new UserError('아직 앞의 수정을 저장하고 있어요.');
    // 재생성 등으로 그룹 요소가 새로 그려졌으면 지금 화면의 그룹으로 검사합니다.
    const liveGroup = target.group?.isConnected
      ? target.group
      : findGroup(target.msgId) || (target.groupId ? document.querySelector(`[data-message-group-id="${CSS.escape(target.groupId)}"]`) : null);
    const anchor = liveGroup ? mdsOf(liveGroup)[0] : null;
    const bridge = findBridge(anchor);
    if (bridge.mismatch) throw new UserError('다른 방으로 옮겨져서 취소했어요.');
    if ((bridge.state && String(bridge.state.status).toUpperCase() !== 'IDLE') || streamingNow()) throw new UserError('답변이 만들어지는 중에는 고칠 수 없어요.');
    if (nativeEditorOpen(liveGroup) || bridge.state?.isEdit) throw new UserError('크랙 수정창이 열려 있어요. 먼저 끝내거나 닫아 주세요.');
    const fresh = bridge.store?.getState().messages.get(target.msgId);
    if (fresh && fresh.content !== target.content) throw new UserError('그사이 메시지가 바뀌었어요. 다시 선택해 주세요.');
    // 편집 창을 연 사이 답변 비교 화살표나 재생성으로 보이는 답변이 바뀌었으면 거절합니다.
    const shownNow = liveGroup ? messageOf(liveGroup, bridge) : null;
    if (shownNow?.fromStore && shownNow.msgId && shownNow.msgId !== target.msgId) throw new UserError('보이는 답변이 바뀌었어요. 다시 선택해 주세요.');
    markOwn(target.msgId, 30000, next, target.content);
    inFlight.add(target.msgId);
    try {
      return await CME.writeLocked(target.chatId, target.msgId, () => sendContent(h, bridge, fresh, target, next));
    } finally {
      inFlight.delete(target.msgId);
      settleOwn(target.msgId);
    }
  }

  async function sendContent(h, bridge, fresh, target, next) {
    if (bridge.actions && fresh) {
      diagState.lastPath = 'A1';
      log('A1 updateMessage', target.msgId);
      const local = () => bridge.store.getState().messages.get(target.msgId)?.content;
      try {
        await bridge.actions.updateMessage({ _id: fresh._id, content: fresh.content }, next);
      } catch (error) {
        const why = error?.response?.data?.message || error?.body?.message;
        throw new UserError(why ? `크랙이 거절했어요: ${why}` : '크랙이 저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
      }
      // 크랙은 저장에 실패하면 오류를 밖으로 던지지 않고 저장소를 원래 글로 되돌리기도 합니다.
      if (normalize(fresh.content) !== normalize(next) && normalize(local()) === normalize(fresh.content)) throw new UserError('크랙이 저장하지 못해서 원래 글로 되돌렸어요.');
      let content = null;
      let unverified = false;
      try {
        await bridge.actions.resyncMessage(target.msgId);
        content = local() ?? null;
      } catch (error) {
        log('resync failed', error);
      }
      if (content === null) content = await api('GET', messagePath(h, target.msgId)).then(data => (typeof data?.content === 'string' ? data.content : null), () => null);
      if (content === null) {
        // 서버 확인은 못 했지만 크랙 저장소에는 새 글이 들어가 있으면, 저장된 것으로 보고 기록을 남깁니다.
        if (normalize(local()) !== normalize(next)) throw new UserError('크랙 서버에 반영되지 않았어요. 새로고침해서 확인해 주세요.');
        content = local();
        unverified = true;
      }
      if (normalize(content) !== normalize(next)) throw new UserError('크랙 서버에 반영되지 않았어요. 새로고침해서 확인해 주세요.');
      markOwn(target.msgId, 30000, content);
      return { content, reload: false, unverified };
    }

    log('direct PATCH', target.msgId);
    // 저장소가 없으면 '그사이 바뀜'을 서버에서 확인합니다.
    if (!fresh) {
      const now = await api('GET', messagePath(h, target.msgId));
      if (typeof now?.content !== 'string' || normalize(now.content) !== normalize(target.content)) throw new UserError('그사이 메시지가 바뀌었어요. 다시 선택해 주세요.');
    }
    const data = await api('PATCH', messagePath(h, target.msgId), { message: next });
    const check = await api('GET', messagePath(h, target.msgId)).catch(() => null);
    const verified = typeof check?.content === 'string';
    const content = verified ? check.content : typeof data?.content === 'string' ? data.content : next;
    if (normalize(content) !== normalize(next)) throw new UserError('크랙 서버에 반영되지 않았어요. 새로고침해서 확인해 주세요.');
    markOwn(target.msgId, 30000, content);
    const live = bridge.store?.getState();
    if (live?.messages.has(target.msgId) && typeof live.updateMessage === 'function') {
      // PATCH가 성공했으면(확인 GET만 실패했어도) 크랙 저장소에 넣어 화면을 맞춥니다. 확인 못 한 것은 알림에 적습니다.
      diagState.lastPath = 'A2';
      live.updateMessage(target.msgId, { content });
      return { content, reload: false, unverified: !verified };
    }
    diagState.lastPath = 'C';
    reloadNeeded.add(target.msgId);
    return { content, reload: true, unverified: !verified };
  }

  // 화면에서 고칠 메시지와 그 원문을 찾습니다. node는 그 메시지 그룹 안의 아무 요소나 됩니다.
  async function resolveTarget(node) {
    const h = here();
    if (!h.chatId) throw new UserError('채팅방에서만 쓸 수 있어요.');
    const group = groupOf(node);
    const bridge = findBridge(group ? mdsOf(group)[0] : null);
    if (bridge.mismatch) throw new UserError('방을 옮기는 중이에요. 잠시 뒤 다시 해 주세요.');
    const info = messageOf(group, bridge);
    if (!info) throw new UserError('이 글은 메시지가 아니라서 고칠 수 없어요.');
    let { msgId, content } = info;
    if (!info.fromStore) {
      // 크랙 내부를 못 찾았을 때: 그룹의 메시지들을 API로 읽고, 화면 글과 가장 잘 맞는 것을 고릅니다.
      // 답변 비교처럼 후보가 여럿이면 거의 똑같이 맞고 2등과 차이가 날 때만, 하나뿐이어도 화면 글과 아주 잘 맞을 때만 고칩니다.
      const ids = (msgId ? [msgId] : info.ids || [info.groupId]).filter(id => ID_RE.test(id));
      if (!ids.length) throw new UserError('메시지 id를 찾지 못했어요.');
      const scored = [];
      for (const id of ids) {
        const data = ids.length === 1 ? await api('GET', messagePath(h, id)) : await api('GET', messagePath(h, id)).catch(() => null);
        if (typeof data?.content === 'string') scored.push({ id, content: data.content, score: coverage(data.content, info.mds) });
      }
      scored.sort((x, y) => y.score - x.score);
      const best = scored[0];
      const close = Boolean(scored[1] && best.score - scored[1].score < 0.005);
      if (!best || best.score < (scored.length > 1 ? 0.995 : 0.97) || close) throw new UserError('화면 글과 서버 원문이 달라요. 새로고침한 뒤 다시 해 주세요. (답변 비교 중이면 크랙 수정창을 써 주세요)');
      msgId = best.id;
      content = best.content;
    }
    if (typeof content !== 'string') throw new UserError('메시지 원문을 읽지 못했어요.');
    return { chatId: h.chatId, msgId, content, group: info.group, groupId: info.groupId, mds: info.mds, via: info.fromStore ? 'store' : 'api' };
  }

  // 지금 원문(content)에 맞는 기록을 돌려줍니다. 그사이 다른 곳에서 바뀌었으면 거기서부터 새로 시작하고,
  // 옛 수정들은 보기용으로만 남깁니다(되돌리기가 남이 쓴 글을 지우지 않게).
  function recordFor(prev, content) {
    if (prev && normalize(prev.current) === normalize(content)) return prev;
    const edits = (prev?.edits || []).map(edit => ({ at: edit.at, kind: edit.kind, before: edit.before, after: edit.after, old: true }));
    return { base: content, origin: prev?.origin ?? prev?.base, current: content, spans: [], edits, rebased: Boolean(prev) };
  }

  // 수정 1번을 저장하고 흔적을 남깁니다. plan: { a, b, ins, kept, next } (원문에서 바뀌는 자리와 새 원문)
  async function commitEdit(target, plan, meta) {
    const snapshot = book(target.chatId)[target.msgId] || null;
    const result = await writeContent(target, plan.next);
    const record = recordFor(book(target.chatId)[target.msgId] || snapshot, target.content);
    const prevSpans = (record.spans || []).map(span => span.slice());
    record.spans = plan.changes ? applyChanges(record.spans, plan.changes) : shiftSpans(record.spans, plan.a, plan.b, plan.ins.length + plan.kept.length, plan.ins.length);
    record.edits.push({ at: Date.now(), kind: meta.kind, before: meta.before, after: meta.after, prev: target.content, prevSpans });
    finishRecord(target.chatId, target.msgId, record, result.content);
    return result;
  }

  function finishRecord(chatId, msgId, record, content) {
    record.current = content;
    record.at = Date.now();
    record.edits = record.edits.slice(-LIMITS.edits);
    record.edits.slice(0, -LIMITS.undo).forEach(edit => { delete edit.prev; delete edit.prevSpans; });
    putRecord(chatId, msgId, normalize(record.current) === normalize(record.base) ? null : record);
    saveBook(chatId);
    CME.changed(chatId, [msgId], 'pinset');
    schedulePaint(0);
  }

  // 되돌리기 전에 서버 글도 기록의 current와 같은지 확인합니다(다른 기기·탭이 서버만 바꾼 것을 덮어쓰지 않게).
  async function confirmServer(msgId, expected) {
    const data = await api('GET', messagePath(here(), msgId));
    if (typeof data?.content !== 'string' || normalize(data.content) !== normalize(expected)) throw new UserError('서버 글이 그사이 바뀌어서 되돌리지 않았어요. 새로고침해 주세요.');
  }

  async function undoLast(chatId, msgId, node) {
    const record = book(chatId)[msgId];
    const edit = record?.edits[record.edits.length - 1];
    if (!edit || typeof edit.prev !== 'string') throw new UserError('되돌릴 수정이 없어요.');
    const target = await resolveTarget(node);
    if (target.msgId !== msgId) throw new UserError('보이는 답변이 바뀌었어요.');
    if (normalize(target.content) !== normalize(record.current)) throw new UserError('그사이 다른 곳에서 바뀌어서 되돌리지 않았어요.');
    await confirmServer(msgId, record.current);
    const result = await writeContent(target, edit.prev);
    const live = book(chatId)[msgId] || record;
    const popped = live.edits.pop();
    // '하나만 되돌리기'를 되돌리면, 되돌렸던 수정의 표시도 풉니다.
    if (popped?.revertOf) {
      const original = live.edits.find(item => item.at === popped.revertOf);
      if (original) delete original.reverted;
    }
    live.spans = edit.prevSpans || [];
    finishRecord(chatId, msgId, live, result.content);
    return result;
  }

  // ---------- 하나만 골라 되돌리기 ----------
  // 수정 i의 바로 전 글(prev)과 바로 뒤 글(다음 수정의 prev 또는 current)로 바뀐 자리를 구하고,
  // 그 뒤 수정들의 위치 변화를 따라 지금 글에서의 자리를 찾아 그 부분만 원래 글로 돌립니다. 뒤 수정과 겹치면 하지 않습니다.
  function planRevertOne(record, i) {
    const edits = record.edits;
    const edit = edits[i];
    if (!edit || edit.old || edit.reverted) return null;
    const states = edits.map(item => (typeof item.prev === 'string' ? item.prev : null)).concat([record.current]);
    for (let k = i; k < states.length; k += 1) if (typeof states[k] !== 'string') return null;
    const change = wholeChange(states[i], states[i + 1]);
    let a = change.a;
    let b = change.a + change.newLen;
    for (let k = i + 1; k < edits.length; k += 1) {
      const later = wholeChange(states[k], states[k + 1]);
      if (later.b <= a) {
        // 앞쪽 변화: 길이 차이만큼 자리를 옮깁니다.
        const delta = later.newLen - (later.b - later.a);
        a += delta;
        b += delta;
      } else if (later.a < b) return { conflict: true };
      // 뒤쪽 변화는 자리에 영향이 없습니다.
    }
    const cur = record.current;
    if (cur.slice(a, b) !== change.newText) return { conflict: true };
    return { a, b, ins: change.oldText, removed: change.newText, next: cur.slice(0, a) + change.oldText + cur.slice(b) };
  }

  // [a, b)를 newLen 글자(원래 글)로 돌렸을 때: 그 자리의 흔적은 빼고 나머지 자리만 옮깁니다.
  function dropRegion(spans, a, b, newLen) {
    const delta = newLen - (b - a);
    const out = [];
    for (const [s, e] of spans || []) {
      if (e === s) {
        if (s < a) out.push([s, s]);
        else if (s > b) out.push([s + delta, s + delta]);
        continue;
      }
      if (e <= a) out.push([s, e]);
      else if (s >= b) out.push([s + delta, e + delta]);
      else {
        if (s < a) out.push([s, a]);
        if (e > b) out.push([a + newLen, e + delta]);
      }
    }
    return out;
  }

  async function revertOne(chatId, msgId, node, at) {
    const record = book(chatId)[msgId];
    const i = record ? record.edits.findIndex(item => item.at === at) : -1;
    if (i < 0) throw new UserError('그 수정을 찾지 못했어요.');
    if (i === record.edits.length - 1) return undoLast(chatId, msgId, node);
    const plan = planRevertOne(record, i);
    if (!plan) throw new UserError('오래된 수정이라 이것만 되돌릴 수는 없어요.');
    if (plan.conflict) throw new UserError('뒤에 고친 것과 자리가 겹쳐서 이것만 되돌릴 수 없어요.');
    const target = await resolveTarget(node);
    if (target.msgId !== msgId) throw new UserError('보이는 답변이 바뀌었어요.');
    if (normalize(target.content) !== normalize(record.current)) throw new UserError('그사이 다른 곳에서 바뀌어서 되돌리지 않았어요.');
    await confirmServer(msgId, record.current);
    const result = await writeContent(target, plan.next);
    const live = book(chatId)[msgId] || record;
    const prevSpans = (live.spans || []).map(span => span.slice());
    live.spans = dropRegion(live.spans, plan.a, plan.b, plan.ins.length);
    const original = live.edits.find(item => item.at === at);
    if (original) original.reverted = true;
    live.edits.push({ at: Date.now(), kind: 'revert', before: plan.removed, after: plan.ins, prev: record.current, prevSpans, revertOf: at });
    finishRecord(chatId, msgId, live, result.content);
    return result;
  }

  async function restoreBase(chatId, msgId, node) {
    const record = book(chatId)[msgId];
    if (!record) throw new UserError('흔적이 없어요.');
    const target = await resolveTarget(node);
    if (target.msgId !== msgId) throw new UserError('보이는 답변이 바뀌었어요.');
    if (normalize(target.content) !== normalize(record.current)) throw new UserError('그사이 다른 곳에서 바뀌어서 되돌리지 않았어요.');
    await confirmServer(msgId, record.current);
    const result = await writeContent(target, record.base);
    forget(chatId, msgId);
    return result;
  }

  function forget(chatId, msgId) {
    putRecord(chatId, msgId, null);
    saveBook(chatId);
    schedulePaint(0);
  }

  // ---------- 크랙 수정창으로 고친 것도 기록 ----------
  // 크랙은 저장소를 먼저 바꾼 뒤 PATCH를 보냅니다. 저장소 변화(전/후)를 잡아 두었다가 그 메시지의 PATCH가 성공하면 확정합니다.
  // 답변 생성·재생성·resync는 PATCH가 없으므로 기록되지 않습니다.

  const watchedStores = new WeakSet();
  const pendingNative = new Map();
  // 이 탭의 저장소에서 'current → base'로 돌아가는 것을 본 메시지. 이때만 기록을 지웁니다(다른 탭·옛 화면이 지우지 않게).
  const revertSeen = new Map();

  // 답변 생성·이어서 생성 중인지(이때의 저장소 변화는 크랙 수정창 기록 후보가 아님)
  function generatingNow() {
    if (streamingNow()) return true;
    try {
      const state = findBridge().state;
      return Boolean(state && String(state.status).toUpperCase() !== 'IDLE');
    } catch (error) {
      return false;
    }
  }

  function watchStore(store) {
    if (watchedStores.has(store)) return;
    watchedStores.add(store);
    try {
      store.subscribe((state, prev) => {
        if (!prev || state.messages === prev.messages) return;
        schedulePaint();
        state.messages.forEach((message, id) => {
          const old = prev.messages.get(id);
          if (!old || old === message || typeof old.content !== 'string' || typeof message.content !== 'string' || old.content === message.content) return;
          if (isOwn(id, message.content) || isOwn(id, old.content)) return;
          const recNow = books.get(here().chatId)?.[id];
          if (recNow && normalize(old.content) === normalize(recNow.current) && normalize(message.content) === normalize(recNow.base)) revertSeen.set(id, recNow.current);
          if (generatingNow()) return;
          const entry = { chatId: here().chatId, before: old.content, after: message.content, at: Date.now() };
          pendingNative.set(id, entry);
          setTimeout(() => {
            if (pendingNative.get(id) === entry) {
              pendingNative.delete(id);
              schedulePaint();
            }
          }, 15000);
        });
        prev.messages.forEach((message, id) => {
          if (!state.messages.has(id) && state.messages.size >= prev.messages.size - 3) {
            const chatId = here().chatId;
            if (book(chatId)[id]) forget(chatId, id);
          }
        });
      });
    } catch (error) {
      log('store subscribe failed', error);
    }
  }

  function sentMessage(body) {
    if (typeof body !== 'string') return null;
    try {
      const json = JSON.parse(body);
      return typeof json?.message === 'string' ? json.message : null;
    } catch (error) {
      return null;
    }
  }

  // info: { sentAt, entry(보낸 순간의 후보), body(보낸 글) }
  function onPatchDone(url, status, bodyText, info = {}) {
    if (status < 200 || status >= 300) return;
    const m = MSG_URL.exec(url);
    if (!m) return;
    const [, chatId, msgId] = m;
    const sent = sentMessage(info.body);
    // 경로 C(새로고침 대기)인 메시지를 크랙 수정창이 옛 글로 저장하면 핀셋 수정이 덮입니다.
    if (reloadNeeded.has(msgId) && sent !== null && !isOwn(msgId, sent)) {
      reloadNeeded.delete(msgId);
      toast('크랙 수정창 저장이 핀셋 수정을 덮었어요. 새로고침해서 확인해 주세요.', { error: true, ms: 6000 });
    }
    const entry = info.entry || pendingNative.get(msgId);
    if (!entry) return;
    if (pendingNative.get(msgId) === entry) pendingNative.delete(msgId);
    // 크랙 수정창은 저장소를 바꾸자마자 PATCH를 보냅니다. 오래된 변화나, 보낸 글이 그 변화와 다른 PATCH는 크랙 수정창 기록이 아닙니다.
    if (info.sentAt && info.sentAt - entry.at > 3000) return;
    if (sent !== null && normalize(sent) !== normalize(entry.after)) return;
    let content = entry.after;
    try {
      const json = JSON.parse(bodyText);
      if (typeof json?.data?.content === 'string') content = json.data.content;
    } catch (error) { /* 무시 */ }
    if (isOwn(msgId, content)) return;
    const record = recordFor(book(chatId)[msgId], entry.before);
    // 끝 공백·줄바꿈만 다른 것은 바뀐 자리로 치지 않습니다.
    const changes = changeList(entry.before.replace(/\s+$/, ''), content.replace(/\s+$/, ''));
    const prevSpans = (record.spans || []).map(span => span.slice());
    record.spans = applyChanges(record.spans, changes);
    record.edits.push({ at: Date.now(), kind: 'native', ...changeSummary(changes), prev: entry.before, prevSpans });
    diagState.nativeCaptured += 1;
    finishRecord(chatId, msgId, record, content);
  }

  // 다른 확프(모바일 유틸 등)의 감시와 겹쳐도 되도록, 지금 있는 함수를 감싸기만 합니다.
  function hookNetwork() {
    try {
      const proto = pageWindow.XMLHttpRequest.prototype;
      if (!proto.__cpnHooked) {
        const open = proto.open;
        const send = proto.send;
        proto.open = function (method, url) {
          try { this.__cpnReq = { method: String(method).toUpperCase(), url: String(url) }; } catch (error) { /* 무시 */ }
          return open.apply(this, arguments);
        };
        proto.send = function () {
          try {
            const req = this.__cpnReq;
            if (req && req.method === 'PATCH' && MSG_URL.test(req.url)) {
              const info = { sentAt: Date.now(), entry: pendingNative.get(MSG_URL.exec(req.url)[2]), body: arguments[0] };
              this.addEventListener('loadend', () => {
                let text = '';
                try { text = this.responseType === '' || this.responseType === 'text' ? this.responseText : JSON.stringify(this.response); } catch (error) { text = ''; }
                onPatchDone(req.url, this.status, text, info);
              });
            }
          } catch (error) { /* 무시 */ }
          return send.apply(this, arguments);
        };
        proto.__cpnHooked = true;
      }
      // 다른 확프가 XMLHttpRequest를 자기 가짜 생성자로 바꿔 두었으면(ajax-hook 식), 만들어지는 객체마다 open/send를 감쌉니다.
      const Ctor = pageWindow.XMLHttpRequest;
      if (!/\[native code\]/.test(Function.prototype.toString.call(Ctor)) && !Ctor.__cpnProxy) {
        diagState.xhrWrapped = true;
        pageWindow.XMLHttpRequest = new Proxy(Ctor, {
          construct(target, args, newTarget) {
            const x = Reflect.construct(target, args, newTarget);
            try {
              if (Object.prototype.hasOwnProperty.call(x, 'send') && !x.__cpnInst) {
                x.__cpnInst = true;
                const o = x.open;
                const s = x.send;
                x.open = function (method, url) {
                  try { x.__cpnReq = { method: String(method).toUpperCase(), url: String(url) }; } catch (error) { /* 무시 */ }
                  return o.apply(this, arguments);
                };
                x.send = function () {
                  try {
                    const req = x.__cpnReq;
                    if (req && req.method === 'PATCH' && MSG_URL.test(req.url)) {
                      const info = { sentAt: Date.now(), entry: pendingNative.get(MSG_URL.exec(req.url)[2]), body: arguments[0] };
                      x.addEventListener('loadend', () => {
                        let text = '';
                        try { text = x.responseType === '' || x.responseType === 'text' ? x.responseText : JSON.stringify(x.response); } catch (error) { text = ''; }
                        onPatchDone(req.url, x.status, text, info);
                      });
                    }
                  } catch (error) { /* 무시 */ }
                  return s.apply(this, arguments);
                };
              }
            } catch (error) { /* 무시 */ }
            return x;
          },
          get(target, key) {
            return key === '__cpnProxy' ? true : Reflect.get(target, key);
          },
        });
      }
      diagState.xhrHooked = true;
    } catch (error) {
      log('xhr hook failed', error);
    }
    try {
      const original = pageWindow.fetch;
      if (typeof original === 'function' && !original.__cpnHooked) {
        const wrapped = function (input, init) {
          const sentAt = Date.now();
          const promise = original.apply(this ?? pageWindow, arguments);
          try {
            // 주소는 문자열, Request, URL 객체 모두 됩니다.
            const url = typeof input === 'string' ? input : typeof input?.url === 'string' ? input.url : String(input ?? '');
            const method = String(init?.method || input?.method || 'GET').toUpperCase();
            if (method === 'PATCH' && MSG_URL.test(url)) {
              const info = { sentAt, entry: pendingNative.get(MSG_URL.exec(url)[2]), body: typeof init?.body === 'string' ? init.body : null };
              promise.then(response => response.clone().text().then(text => onPatchDone(url, response.status, text, info))).catch(() => {});
            }
          } catch (error) { /* 무시 */ }
          return promise;
        };
        wrapped.__cpnHooked = true;
        pageWindow.fetch = wrapped;
      }
      diagState.fetchHooked = true;
    } catch (error) {
      log('fetch hook failed', error);
    }
  }

  // ---------- 흔적 칠하기 ----------

  const HL = pageWindow.Highlight || window.Highlight;
  const registry = () => pageWindow.CSS?.highlights || window.CSS?.highlights || null;
  const hits = new Map();
  let paintTimer = 0;

  function schedulePaint(delay = 250) {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paint, delay);
  }

  function paint() {
    const h = here();
    const records = book(h.chatId);
    const reg = registry();
    if (streamingNow()) {
      schedulePaint(800);
      return;
    }
    hits.clear();
    const edits = [];
    const cuts = [];
    const keep = new Set();
    const wanted = new Set(Object.keys(records));
    if (h.chatId && wanted.size) {
      const bridge = findBridge();
      let changed = false;
      for (const group of document.querySelectorAll('[data-message-group-id]')) {
        const info = messageOf(group, bridge, wanted);
        if (!info) continue;
        const id = info.msgId || info.groupId;
        const record = records[id];
        if (!record) continue;
        // 저장 중이거나 확정을 기다리는 동안에는 화면이 잠깐 원문과 같아도 기록을 지우지 않습니다.
        const busy = inFlight.has(id) || pendingNative.has(id) || reloadNeeded.has(id);
        let status;
        if (info.fromStore) {
          if (normalize(info.content) === normalize(record.current)) status = 'ok';
          else if (!busy && revertSeen.get(id) === record.current && normalize(info.content) === normalize(record.base)) {
            // 이 탭에서 원래 글로 돌아가는 것을 직접 본 경우에만 기록을 지웁니다.
            // (같은 방을 연 다른 탭이나 옛 글이 한 번 그려진 화면은 '어긋남'으로만 둡니다.)
            revertSeen.delete(id);
            putRecord(h.chatId, id, null);
            changed = true;
            continue;
          } else status = 'stale';
        } else {
          status = !reloadNeeded.has(id) && coverage(record.current, info.mds) > 0.97 ? 'ok' : 'stale';
        }
        keep.add(ensureBadge(info.mds[info.mds.length - 1], id, record, status));
        if (status === 'ok' && settings.paint) {
          const painted = rangesFor(info.mds, record);
          edits.push(...painted.ranges);
          cuts.push(...painted.cuts);
          const hit = { id, group, ranges: painted.ranges.concat(painted.cuts) };
          info.mds.forEach(md => hits.set(md, hit));
        }
      }
      if (changed) saveBook(h.chatId);
    }
    document.querySelectorAll('.cpn-badge').forEach(badge => {
      if (!keep.has(badge)) badge.remove();
    });
    if (reg && HL) {
      try {
        reg.set('cpn-edit', new HL(...edits));
        reg.set('cpn-cut', new HL(...cuts));
      } catch (error) {
        log('highlight failed', error);
      }
    }
  }

  // 배지는 .wrtn-markdown 안이 아니라 바로 뒤에 붙입니다(크랙이 본문을 다시 그려도 지워지지 않게).
  function ensureBadge(md, id, record, status) {
    let badge = md.nextElementSibling;
    if (!badge?.classList.contains('cpn-badge')) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'cpn-badge cpn-ui';
      // 방금 고친 메시지의 배지만 톡 튀어나오게 합니다(새로고침이나 크랙이 다시 그릴 때는 조용히).
      if (Date.now() - (record.at || 0) < 4000) {
        badge.classList.add('is-new');
        badge.addEventListener('animationend', () => badge.classList.remove('is-new'), { once: true });
      }
      badge.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openTrace(groupOf(badge), badge.dataset.id, badge.getBoundingClientRect());
      });
      md.after(badge);
    }
    const count = record.edits.length;
    const label = status === 'stale' ? (reloadNeeded.has(id) ? '수정 흔적 · 새로고침하면 보여요' : '수정 흔적 · 어긋남') : `수정 흔적 ${count}`;
    if (badge.dataset.id !== id) badge.dataset.id = id;
    if (badge.dataset.label !== label) {
      badge.dataset.label = label;
      badge.innerHTML = `${ICONS.pen}<span></span>`;
      badge.lastElementChild.textContent = label;
    }
    badge.classList.toggle('is-stale', status === 'stale');
    return badge;
  }

  // ---------- 화면 (선택 막대, 편집 창, 흔적 창, 알림) ----------

  const ICONS = {
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    erase: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  };

  const HOST_CSS = `
::highlight(cpn-edit){background-color:rgba(255,140,60,.28)}
::highlight(cpn-cut){text-decoration:underline wavy rgba(234,88,12,.9);text-decoration-thickness:1.5px;text-underline-offset:3px}
.cpn-badge{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;width:max-content;height:22px;margin:4px 0 0;padding:0 8px 0 6px;border:0;border-radius:999px;background:rgba(255,140,60,.15);color:#c2410c;font-size:11.5px;font-weight:700;line-height:1;cursor:pointer;transition:background-color .15s,scale .15s}
.cpn-badge:hover{background:rgba(255,140,60,.26)}
.cpn-badge:active{scale:.97}
.cpn-badge svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.cpn-badge.is-stale{background:rgba(127,127,127,.14);color:inherit;opacity:.7}
html[data-cpn-theme="dark"] .cpn-badge{color:#ffab70}
html[data-cpn-theme="dark"] .cpn-badge.is-stale{color:inherit}
.cpn-badge.is-new{animation:cpnBadgeIn .38s cubic-bezier(.34,1.56,.64,1)}
@keyframes cpnBadgeIn{from{opacity:0;transform:scale(.6)}}
@media (prefers-reduced-motion:reduce){.cpn-badge.is-new{animation:none}}`;

  // 유리(글라스) 느낌: 반투명 바탕 + 뒤 흐림. 움직임은 짧고 가볍게, '동작 줄이기' 설정이면 끕니다.
  const STAGE_CSS = `
*{box-sizing:border-box}
button,textarea{font:inherit;color:inherit;letter-spacing:inherit}
button{cursor:pointer}
.stage{--glass:rgba(30,30,34,.58);--glass-solid:rgba(30,30,34,.94);--edge:inset 0 0 0 1px rgba(255,255,255,.1),inset 0 1px 0 rgba(255,255,255,.08);--drop:0 18px 48px -16px rgba(0,0,0,.6),0 2px 6px -2px rgba(0,0,0,.3);--blur:blur(22px) saturate(170%);--surface:rgba(255,255,255,.06);--surface-2:rgba(255,255,255,.11);--hover:rgba(255,255,255,.1);--text:#f1f1f2;--text-2:#a9a9b0;--text-3:#74747b;--rule:rgba(255,255,255,.08);--rail:rgba(255,255,255,.18);--pink:#ffab70;--pink-soft:rgba(255,140,60,.2);--on-pink:#2a1306;--danger:#ff9a9a;--out:cubic-bezier(.2,0,0,1);--spring:cubic-bezier(.34,1.4,.64,1);position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-size:13px;line-height:1.45;letter-spacing:-.01em}
.stage[data-theme=light]{--glass:rgba(255,255,255,.62);--glass-solid:rgba(255,255,255,.96);--edge:inset 0 0 0 1px rgba(255,255,255,.7),0 0 0 1px rgba(0,0,0,.07);--drop:0 18px 48px -18px rgba(0,0,0,.28),0 2px 6px -2px rgba(0,0,0,.08);--surface:rgba(0,0,0,.04);--surface-2:rgba(0,0,0,.08);--hover:rgba(0,0,0,.06);--text:#1c1c1b;--text-2:#5f5f5c;--text-3:#9a9a96;--rule:rgba(0,0,0,.07);--rail:rgba(0,0,0,.18);--pink:#c2410c;--pink-soft:rgba(255,140,60,.16);--on-pink:#fff;--danger:#c4545a}
.tb,.pop,.toast{background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);box-shadow:var(--edge),var(--drop);color:var(--text)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.tb,.pop,.toast{background:var(--glass-solid)}}
svg{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@keyframes cpnIn{from{opacity:0;transform:translateY(4px) scale(.92)}}
@keyframes cpnPop{from{opacity:0;transform:translateY(6px) scale(.97)}}
@keyframes cpnFade{from{opacity:0;transform:translateY(3px)}}
@keyframes cpnOut{to{opacity:0;transform:scale(.96)}}
@keyframes cpnToast{from{opacity:0;transform:translateY(10px) scale(.96)}}
@keyframes cpnTimer{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.tb{position:absolute;display:flex;gap:2px;padding:4px;border-radius:14px;pointer-events:auto;animation:cpnIn .22s var(--spring) both}
.tb button{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:0;border-radius:10px;background:none;font-size:12.5px;font-weight:600;white-space:nowrap;transition:background .15s,scale .12s;animation:cpnFade .2s var(--out) both}
.tb button:nth-child(2){animation-delay:.03s}
.tb button:nth-child(3){animation-delay:.06s}
.tb button:hover{background:var(--hover)}
.tb button:active{scale:.95}
.tb .main{color:var(--pink)}
.pop{position:absolute;width:380px;max-width:calc(100vw - 20px);display:flex;flex-direction:column;max-height:calc(100vh - 24px);border-radius:18px;pointer-events:auto;outline:none;animation:cpnPop .24s var(--out) both}
.pop.wide{width:620px}
.tb.out,.pop.out{pointer-events:none;animation:cpnOut .13s var(--out) forwards}
.hd{display:flex;align-items:center;gap:8px;padding:12px 10px 8px 14px}
.hd b{flex:1;font-size:14px;font-weight:700;letter-spacing:-.02em}
.hd small{color:var(--text-3);font-size:11.5px;font-weight:500;margin-left:6px}
.x{width:28px;height:28px;display:grid;place-items:center;padding:0;border:0;border-radius:9px;background:none;color:var(--text-2);transition:background .15s,color .15s,rotate .2s var(--out)}
.x:hover{background:var(--hover);color:var(--text);rotate:90deg}
.bd{padding:0 14px 12px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--rail) transparent}
.was{margin-bottom:8px;padding:8px 10px;border-radius:11px;background:var(--surface);color:var(--text-2);font-size:12.5px;max-height:84px;overflow:auto;white-space:pre-wrap;word-break:break-all;animation:cpnFade .22s var(--out) both}
.was i{font-style:normal;color:var(--text-3);font-size:11px;font-weight:700;margin-right:6px}
textarea{width:100%;min-height:72px;max-height:46vh;padding:10px 12px;border:0;border-radius:12px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--rule);color:var(--text);font-size:14px;line-height:1.6;resize:vertical;outline:none;white-space:pre-wrap;word-break:break-all;transition:box-shadow .18s,background .18s}
textarea:focus{background:var(--surface-2);box-shadow:inset 0 0 0 1.5px var(--pink),0 0 0 4px var(--pink-soft)}
.wide textarea{min-height:44vh;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.note{margin-top:6px;color:var(--text-3);font-size:11.5px;transition:color .15s}
.note.warn{color:var(--danger)}
.ft{display:flex;align-items:center;gap:6px;padding:10px 14px 12px;border-top:1px solid var(--rule)}
.ft .grow{flex:1}
.btn{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;border:0;border-radius:11px;background:var(--surface);color:var(--text);box-shadow:inset 0 0 0 1px var(--rule);font-size:12.5px;font-weight:600;transition:scale .12s,opacity .15s,background .15s,filter .15s}
.btn:hover{background:var(--surface-2)}
.btn:active{scale:.96}
.btn.pri{background:var(--pink);color:var(--on-pink);box-shadow:none}
.btn.pri:hover{filter:brightness(1.08)}
.btn.danger{color:var(--danger)}
.btn[disabled]{opacity:.4;pointer-events:none}
.btn.busy{opacity:.6;pointer-events:none}
.list{display:flex;flex-direction:column;gap:8px}
.it{padding:9px 10px;border-radius:12px;background:var(--surface);animation:cpnFade .22s var(--out) both}
.it:nth-child(2){animation-delay:.03s}.it:nth-child(3){animation-delay:.06s}.it:nth-child(4){animation-delay:.09s}.it:nth-child(n+5){animation-delay:.12s}
.it .meta{display:flex;gap:6px;color:var(--text-3);font-size:11px;font-weight:700;margin-bottom:4px}
.it .meta b{color:var(--text-2)}
.it.old{opacity:.55}
.del,.ins{display:block;white-space:pre-wrap;word-break:break-all;font-size:12.5px}
.del{color:var(--text-3);text-decoration:line-through;text-decoration-color:var(--danger)}
.ins{color:var(--text)}
.ins mark{background:var(--pink-soft);color:inherit;border-radius:3px;padding:0 1px}
.empty{color:var(--text-3);font-size:12px}
.stale{margin-bottom:8px;padding:8px 10px;border-radius:11px;background:var(--surface);color:var(--text-2);font-size:12px}
.sw{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 4px;border:0;background:none;color:var(--text-2);font-size:12px;font-weight:600}
.sw i{position:relative;width:30px;height:18px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--rule);transition:background .2s}
.sw i::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--text-2);transition:translate .22s var(--spring),background .2s}
.sw[aria-pressed=true] i{background:var(--pink)}
.sw[aria-pressed=true] i::after{translate:12px 0;background:#fff}
.toast{position:absolute;left:50%;bottom:28px;translate:-50% 0;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:9px 10px 9px 14px;border-radius:14px;font-size:13px;font-weight:600;pointer-events:auto;overflow:hidden;animation:cpnToast .26s var(--spring) both}
.toast svg{color:var(--pink)}
.toast.err svg{color:var(--danger)}
.toast.err{box-shadow:var(--edge),inset 0 0 0 1px rgba(238,138,138,.35),var(--drop)}
.toast.out{pointer-events:none;animation:cpnOut .15s var(--out) forwards}
.toast button{height:28px;padding:0 10px;border:0;border-radius:9px;background:var(--surface-2);color:var(--text);font-size:12px;font-weight:700;transition:background .15s}
.toast button:hover{background:var(--pink-soft);color:var(--pink)}
.toast .tm{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--pink);opacity:.7;transform-origin:left;animation:cpnTimer linear forwards}
.seg{display:inline-flex;gap:2px;padding:3px;margin-bottom:10px;border-radius:11px;background:var(--surface)}
.seg button{height:26px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--text-2);font-size:12px;font-weight:600;transition:background .18s var(--out),color .18s}
.seg button[aria-pressed=true]{background:var(--surface-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--rule)}
.it .meta{align-items:center}
.it .meta .grow{flex:1}
.mini{display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 8px;border:0;border-radius:7px;background:var(--surface-2);color:var(--text-2);font-size:11px;font-weight:700;opacity:.55;transition:opacity .15s,background .15s,color .15s}
.mini svg{width:12px;height:12px}
.it:hover .mini,.mini:focus-visible{opacity:1}
@media (hover:none){.mini{opacity:1}}
.mini:hover{background:var(--pink-soft);color:var(--pink)}
.mini.busy{opacity:.6;pointer-events:none}
.tag{padding:1px 6px;border-radius:6px;background:var(--surface-2);color:var(--text-2);font-size:10.5px}
.it.gone{opacity:.5}
.it.gone .ins mark{background:none;text-decoration:line-through}
.v-cmp{animation:cpnFade .2s var(--out) both}
.cmp{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.pane{min-width:0;padding:9px 10px;border-radius:12px;background:var(--surface)}
.pane .lab{margin-bottom:5px;color:var(--text-3);font-size:11px;font-weight:700}
.pane .txt{max-height:46vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.6;scrollbar-width:thin;scrollbar-color:var(--rail) transparent}
.pane del{color:var(--danger);text-decoration:line-through;text-decoration-thickness:1.5px;background:rgba(238,138,138,.12);border-radius:3px}
.pane ins{text-decoration:none;color:var(--text);background:var(--pink-soft);box-shadow:inset 0 -1.5px 0 var(--pink);border-radius:3px}
.pane .gap{display:inline-block;margin:0 4px;padding:0 6px;border-radius:6px;background:var(--surface-2);color:var(--text-3);font-size:11px}
.cmp-full{margin-top:6px}
@media (max-width:560px){.pop{left:10px!important;right:10px!important;top:auto!important;bottom:10px!important;width:auto!important}.cmp{grid-template-columns:1fr}.pane .txt{max-height:28vh}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}}`;

  const ui = { host: null, shadow: null, stage: null, toolbar: null, pop: null, busy: false, sel: null };
  const esc = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = selector => ui.shadow?.querySelector(selector);

  function currentTheme() {
    const theme = document.body?.dataset.theme;
    if (theme === 'light' || theme === 'dark') return theme;
    if (document.documentElement.classList.contains('dark')) return 'dark';
    return pageWindow.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function injectHostStyle() {
    if (document.getElementById('cpn-host-style')) return;
    const style = document.createElement('style');
    style.id = 'cpn-host-style';
    style.textContent = HOST_CSS;
    document.head.append(style);
  }

  function ensureStage() {
    if (ui.host?.isConnected) {
      ui.stage.dataset.theme = currentTheme();
      return ui.stage;
    }
    ui.host = document.createElement('div');
    ui.host.id = 'cpn-host';
    ui.shadow = ui.host.attachShadow({ mode: 'open' });
    ui.shadow.innerHTML = `<style>${STAGE_CSS}</style><style data-cme-theme>${CME.pinCss}</style><div class="stage"></div>`;
    ui.stage = ui.shadow.querySelector('.stage');
    ui.stage.dataset.theme = currentTheme();
    document.body.append(ui.host);
    // 편집 창 안의 키(Enter 등)가 크랙 단축키로 새지 않게, 창(window)의 잡기 단계에서 가장 먼저 멈춥니다.
    // (그림자 DOM 안에서 멈추면 document·window의 잡기 단계 리스너에는 이미 닿은 뒤입니다.)
    if (!ui.keyGuard) {
      ui.keyGuard = true;
      ['keydown', 'keyup', 'keypress'].forEach(type => pageWindow.addEventListener(type, event => {
        if (!ui.host || !event.composedPath().includes(ui.host)) return;
        if (type === 'keydown') onPanelKey(event);
        event.stopPropagation();
      }, true));
    }
    // 막대를 누를 때 선택이 풀리지 않게 합니다.
    ui.shadow.addEventListener('mousedown', event => {
      if (event.target.closest('.tb')) event.preventDefault();
    });
    ui.shadow.addEventListener('click', onPanelClick);
    return ui.stage;
  }

  // 닫힐 때 살짝 줄어들며 사라지게 합니다(그동안은 눌리지 않음).
  const reduceMotion = () => Boolean(pageWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  function fadeOut(el, ms = 140) {
    if (!el) return;
    if (reduceMotion()) {
      el.remove();
      return;
    }
    el.classList.add('out');
    setTimeout(() => el.remove(), ms);
  }

  function hideToolbar() {
    fadeOut(ui.toolbar);
    ui.toolbar = null;
  }

  function closePop() {
    fadeOut(ui.pop);
    ui.pop = null;
    ui.busy = false;
  }

  function place(el, rect, prefer = 'below') {
    const gap = 8;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(10, Math.min(innerWidth - width - 10, left));
    let top = prefer === 'above' ? rect.top - height - gap : rect.bottom + gap;
    if (prefer === 'above' && top < 8) top = rect.bottom + gap;
    if (prefer === 'below' && top + height > innerHeight - 8) top = Math.max(8, rect.top - height - gap);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - height - 8, top)))}px`;
  }

  const coarse = () => pageWindow.matchMedia?.('(pointer: coarse)').matches;

  function showToolbar(sel) {
    ensureStage();
    hideToolbar();
    ui.sel = sel;
    const bar = document.createElement('div');
    bar.className = 'tb';
    bar.innerHTML = `<button class="main" data-act="edit">${ICONS.pen}고치기</button><button data-act="erase">${ICONS.erase}지우기</button><button data-act="source" title="이 메시지 원문 전체 고치기">${ICONS.source}원문</button>`;
    ui.stage.append(bar);
    ui.toolbar = bar;
    const rect = sel.range.getBoundingClientRect();
    // 휴대폰은 위쪽에 기본 복사 메뉴가 뜨므로 아래에 둡니다.
    place(bar, rect, coarse() ? 'below' : 'above');
    // 선택한 글 쪽에서 튀어나오게 합니다.
    bar.style.transformOrigin = parseFloat(bar.style.top) < rect.top ? '50% 100%' : '50% 0';
  }

  function toast(message, options = {}) {
    const stage = ensureStage();
    stage.querySelectorAll('.toast:not(.out)').forEach(node => fadeOut(node, 160));
    const node = document.createElement('div');
    node.className = `toast${options.error ? ' err' : ''}`;
    node.innerHTML = `${options.error ? ICONS.alert : ICONS.check}<span>${esc(message)}</span>`;
    if (options.action) {
      const button = document.createElement('button');
      button.textContent = options.action.label;
      button.addEventListener('click', () => {
        fadeOut(node, 160);
        options.action.run();
      });
      node.append(button);
    }
    stage.append(node);
    // 채팅 입력창을 덮지 않게 그 위로 올립니다.
    const input = document.querySelector('.__chat_input_textarea') || Array.from(document.querySelectorAll('textarea, .ProseMirror[contenteditable="true"]')).find(el => !el.closest('[data-message-group-id]') && !el.closest('#cpn-host'));
    const box = input ? (input.closest('form') || input.parentElement || input).getBoundingClientRect() : null;
    if (box && box.top > innerHeight / 2 && box.top < innerHeight) node.style.bottom = `${Math.max(28, Math.round(innerHeight - box.top + 12))}px`;
    const ms = options.ms || (options.action ? 6000 : 2600);
    // 되돌리기 같은 버튼이 있으면 남은 시간을 아래 막대로 보여 줍니다.
    if (options.action) {
      const timer = document.createElement('i');
      timer.className = 'tm';
      timer.style.animationDuration = `${ms}ms`;
      node.append(timer);
    }
    setTimeout(() => fadeOut(node, 160), ms);
  }

  function failed(error) {
    diagState.lastError = String(error?.message || error);
    if (!(error instanceof UserError)) console.warn(LOG, error);
    toast(error instanceof UserError ? error.message : '고치지 못했어요. 새로고침 뒤 다시 해 주세요.', { error: true, ms: 4200 });
  }

  function doneToast(result, label, undo) {
    if (result.unverified) label = `${label} (서버 확인은 못 했어요)`;
    if (result.reload) {
      // 새로고침 전에 크랙 수정창으로 저장하면 그 창이 들고 있던 옛 글로 덮입니다.
      toast(`${label} · 새로고침하면 화면에 보여요. 그 전에 크랙 수정창을 쓰면 옛 글로 덮여요`, { action: { label: '새로고침', run: () => location.reload() }, ms: 8000 });
      return;
    }
    toast(label, undo ? { action: { label: '되돌리기', run: undo } } : {});
  }

  // 선택 → 대상 메시지 확인 → 원문 위치 찾기
  async function prepare(sel) {
    const target = await resolveTarget(sel.group);
    const mapped = mapSelection(target.mds, sel.range, target.content);
    return { target, mapped };
  }

  const liveGroup = target => (target.group?.isConnected ? target.group : findGroup(target.msgId));
  const undoAction = target => () => undoLast(target.chatId, target.msgId, liveGroup(target)).then(r => doneToast(r, '되돌렸어요')).catch(failed);

  // 원문 창으로 넘어간 이유는 창 안에 적습니다(휴대폰에서는 아래쪽 시트가 알림을 가리므로).
  function sourceFallback(target, region, why) {
    openSource(target, region);
    ui.pop?.querySelector('.bd')?.insertAdjacentHTML('afterbegin', `<div class="stale cpn-why">${esc(why)}</div>`);
  }

  async function startEdit(mode) {
    const sel = ui.sel;
    hideToolbar();
    if (!sel) return;
    let prepared;
    try {
      prepared = await prepare(sel);
    } catch (error) {
      failed(error);
      return;
    }
    const { target, mapped } = prepared;
    const rect = sel.range.getBoundingClientRect();
    document.getSelection()?.removeAllRanges();
    if (mode === 'source') {
      openSource(target, mapped.ok ? [mapped.a, mapped.b] : mapped.approx || null);
      return;
    }
    if (!mapped.ok) {
      sourceFallback(target, mapped.approx || null, '이 부분은 원문에서 정확히 못 찾아서, 원문 전체를 열었어요.');
      return;
    }
    if (mode === 'erase') {
      const plan = planSplice(target.content, mapped, '');
      if (!plan) {
        sourceFallback(target, [mapped.a, mapped.b], '고치면 서식(기울임·목록·링크)이 깨질 수 있어서 원문 창으로 열었어요.');
        return;
      }
      try {
        const result = await commitEdit(target, plan, { kind: 'pin', before: mapped.oldText, after: '' });
        doneToast(result, '지웠어요', undoAction(target));
      } catch (error) {
        failed(error);
      }
      return;
    }
    openEditor(target, mapped, rect);
  }

  function findGroup(msgId) {
    const bridge = findBridge();
    const wanted = new Set([msgId]);
    for (const group of document.querySelectorAll('[data-message-group-id]')) {
      const info = messageOf(group, bridge, wanted);
      if (info && (info.msgId || info.groupId) === msgId) return group;
    }
    return null;
  }

  function popShell(title, sub, wide) {
    ensureStage();
    closePop();
    const pop = document.createElement('div');
    pop.className = `pop${wide ? ' wide' : ''}`;
    pop.tabIndex = -1;
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<div class="hd"><b>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</b><button class="x" data-act="close" aria-label="닫기">${ICONS.close}</button></div><div class="bd"></div><div class="ft"></div>`;
    ui.stage.append(pop);
    ui.pop = pop;
    return pop;
  }

  function lengthNote(target, nextLength) {
    const note = ui.pop?.querySelector('.note');
    if (!note) return;
    const over = nextLength > LIMITS.soft;
    note.classList.toggle('warn', over);
    note.textContent = over
      ? `고친 뒤 ${nextLength.toLocaleString()}자예요. 8,000자가 넘으면 나중에 크랙 수정창으로 열 때 앞부분이 잘릴 수 있어요.`
      : (note.dataset.base || '');
  }

  function openEditor(target, mapped, rect) {
    const pop = popShell('핀셋 수정', '이 부분만 바꿔요');
    // 휴대폰에서는 Enter가 줄바꿈이고 [고치기] 버튼으로 저장합니다.
    const hint = coarse() ? '[고치기] 버튼으로 저장 · Enter 줄바꿈' : 'Enter 고치기 · Shift+Enter 줄바꿈 · Esc 닫기';
    pop.querySelector('.bd').innerHTML = `<div class="was"><i>원래</i>${esc(mapped.oldText)}</div><textarea spellcheck="false" aria-label="바꿀 글"></textarea><div class="note" data-base="${esc(hint)}">${esc(hint)}</div>`;
    pop.querySelector('.ft').innerHTML = '<span class="grow"></span><button class="btn" data-act="close">취소</button><button class="btn pri" data-act="save">고치기</button>';
    const area = pop.querySelector('textarea');
    area.value = mapped.oldText;
    const rest = target.content.length - mapped.oldText.length;
    area.addEventListener('input', () => lengthNote(target, rest + area.value.length));
    lengthNote(target, rest + area.value.length);
    pop.edit = { target, mapped };
    place(pop, rect, 'below');
    area.focus({ preventScroll: true });
    area.select();
  }

  function openSource(target, approx) {
    const pop = popShell('원문 고치기', '숨김 주석·서식 기호까지 보여요', true);
    const hint = coarse() ? '[고치기] 버튼으로 저장' : 'Ctrl+Enter 고치기 · Esc 닫기';
    pop.querySelector('.bd').innerHTML = `<textarea spellcheck="false" aria-label="메시지 원문"></textarea><div class="note" data-base="${esc(hint)}">${esc(hint)}</div>`;
    pop.querySelector('.ft').innerHTML = '<span class="grow"></span><button class="btn" data-act="close">취소</button><button class="btn pri" data-act="save-source">고치기</button>';
    const area = pop.querySelector('textarea');
    // 글 상자는 CRLF를 LF로 바꿔 보여 주므로, 선택 위치와 '손대지 않음' 판정도 LF 기준으로 맞춥니다.
    const shownSrc = target.content.replace(/\r\n?/g, '\n');
    const toShown = i => i - (target.content.slice(0, i).match(/\r\n/g) || []).length;
    area.value = shownSrc;
    area.addEventListener('input', () => lengthNote(target, area.value.length));
    lengthNote(target, area.value.length);
    pop.edit = { target, source: true, shown: shownSrc };
    pop.style.left = `${Math.max(10, (innerWidth - pop.offsetWidth) / 2)}px`;
    pop.style.top = `${Math.max(12, (innerHeight - pop.offsetHeight) / 2)}px`;
    area.focus({ preventScroll: true });
    if (approx) {
      area.setSelectionRange(toShown(approx[0]), toShown(approx[1]));
      const line = target.content.slice(0, approx[0]).split('\n').length;
      area.scrollTop = Math.max(0, (line - 3) * 21);
    }
  }

  async function saveEditor() {
    const pop = ui.pop;
    if (!pop?.edit || pop.busy) return;
    const button = pop.querySelector('[data-act^="save"]');
    const area = pop.querySelector('textarea');
    const { target, mapped, source } = pop.edit;
    pop.busy = true;
    button.classList.add('busy');
    // 저장하는 사이 다른 창을 열었으면 그 창은 닫지 않습니다.
    const done = () => {
      if (ui.pop === pop) closePop();
    };
    try {
      let result;
      if (source) {
        const next = area.value;
        if (next === (pop.edit.shown ?? target.content)) {
          done();
          return;
        }
        const change = wholeChange(target.content, next);
        const changes = changeList(target.content, next);
        const plan = { a: change.a, b: change.b, ins: change.newText, kept: '', next, changes };
        result = await commitEdit(target, plan, { kind: 'source', ...changeSummary(changes) });
      } else {
        let replacement = area.value;
        // 휴대폰에서 실수로 넣은 끝 줄바꿈은 뺍니다.
        if (!/\n$/.test(mapped.oldText)) replacement = replacement.replace(/\n+$/, '');
        if (replacement.replace(/\r\n?/g, '\n') === mapped.oldText.replace(/\r\n?/g, '\n')) {
          done();
          return;
        }
        const plan = planSplice(target.content, mapped, replacement);
        if (!plan) {
          done();
          sourceFallback(target, [mapped.a, mapped.b], '고치면 서식(기울임·목록·링크)이 깨질 수 있어서 원문 창으로 열었어요.');
          return;
        }
        result = await commitEdit(target, plan, { kind: 'pin', before: mapped.oldText, after: replacement });
      }
      done();
      doneToast(result, '고쳤어요', undoAction(target));
    } catch (error) {
      pop.busy = false;
      button.classList.remove('busy');
      failed(error);
    }
  }

  const KIND_LABEL = { pin: '핀셋', source: '원문 고치기', native: '크랙 수정창', revert: '하나 되돌림' };

  // ---------- 전후 비교 ----------
  // 낱말·공백·기호 단위로 나눠 Myers 차이 계산을 합니다. 너무 많이 다르면 앞뒤 같은 부분만 빼고 가운데를 통째로 바뀐 것으로 봅니다.
  const tokensOf = text => text.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];

  function diffTokens(a, b) {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const limit = Math.min(max, 300);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= limit && found < 0; d += 1) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off]) ? v[k + 1 + off] : v[k - 1 + off] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x += 1;
          y += 1;
        }
        v[k + off] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
    }
    if (found < 0) return null;
    const ops = [];
    let x = n;
    let y = m;
    for (let d = found; d >= 0; d -= 1) {
      const vv = trace[d];
      const k = x - y;
      const prevK = k === -d || (k !== d && vv[k - 1 + off] < vv[k + 1 + off]) ? k + 1 : k - 1;
      const prevX = vv[prevK + off];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        ops.push(['=', a[x - 1]]);
        x -= 1;
        y -= 1;
      }
      if (d > 0) {
        if (x === prevX) ops.push(['+', b[y - 1]]);
        else ops.push(['-', a[x - 1]]);
      }
      x = prevX;
      y = prevY;
    }
    return ops.reverse();
  }

  // 같은 종류끼리 이어 붙인 조각 목록 [[종류, 글], …]
  function diffParts(before, after) {
    let ops = diffTokens(tokensOf(before), tokensOf(after));
    if (!ops) {
      const c = wholeChange(before, after);
      ops = [['=', before.slice(0, c.a)], ['-', c.oldText], ['+', c.newText], ['=', before.slice(c.b)]];
    }
    const parts = [];
    for (const [type, text] of ops) {
      if (!text) continue;
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart[0] === type) lastPart[1] += text;
      else parts.push([type, text]);
    }
    return parts;
  }

  // 한쪽(처음 글 = 'old', 지금 글 = 'new')을 그립니다. 바뀌지 않은 긴 부분은 앞뒤만 남기고 접습니다(full이면 다 보여 줌).
  function diffPaneHtml(parts, side, full) {
    const skip = side === 'old' ? '+' : '-';
    const visible = parts.filter(([type]) => type !== skip);
    return visible.map(([type, text], index) => {
      if (type === '-') return `<del>${esc(text)}</del>`;
      if (type === '+') return `<ins>${esc(text)}</ins>`;
      if (full || text.length <= 260) return esc(text);
      const head = index > 0 ? esc(text.slice(0, 90)) : '';
      const tail = index < visible.length - 1 ? esc(text.slice(-90)) : '';
      return `${head}<span class="gap">⋯</span>${tail}`;
    }).join('');
  }

  function compareHtml(record, full) {
    const parts = diffParts(record.base, record.current);
    const changed = parts.filter(([type]) => type !== '=').length;
    if (!changed) return '<div class="empty">처음 글과 지금 글이 같아요.</div>';
    return `<div class="cmp"><div class="pane"><div class="lab">처음 글</div><div class="txt">${diffPaneHtml(parts, 'old', full)}</div></div><div class="pane"><div class="lab">지금 글</div><div class="txt">${diffPaneHtml(parts, 'new', full)}</div></div></div>
<button class="sw cmp-full" data-act="cmp-full" aria-pressed="${Boolean(full)}"><i></i>바뀌지 않은 부분도 다 보기</button>`;
  }

  function ago(at) {
    const sec = Math.max(0, (Date.now() - at) / 1000);
    if (sec < 60) return '방금';
    if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
    return `${Math.floor(sec / 86400)}일 전`;
  }

  const clip = (text, max = 160) => (text.length > max ? `${text.slice(0, max)}…` : text);

  function openTrace(group, msgId, rect) {
    // 쓰던 편집 창(글을 바꿨거나 저장 중)이 있으면 흔적 창으로 바꾸지 않습니다(입력이 사라지지 않게).
    if (ui.pop?.edit) {
      const area = ui.pop.querySelector('textarea');
      const original = ui.pop.edit.source ? (ui.pop.edit.shown ?? ui.pop.edit.target.content) : ui.pop.edit.mapped.oldText;
      if (ui.pop.busy || !area || area.value !== original) {
        area?.focus({ preventScroll: true });
        return;
      }
    }
    const chatId = here().chatId;
    const record = book(chatId)[msgId];
    if (!record || !group) return;
    hideToolbar();
    const pop = popShell('수정 흔적', `${record.edits.length}번 고침`);
    const bridge = findBridge(mdsOf(group)[0]);
    const info = messageOf(group, bridge, new Set([msgId]));
    const stale = !info || (info.fromStore ? normalize(info.content) !== normalize(record.current) : reloadNeeded.has(msgId) || coverage(record.current, info.mds) <= 0.97);
    // 수정마다 '이것만 되돌리기'(가장 최근 것은 '방금 것'과 같음). 오래됐거나 뒤 수정과 겹치면 버튼을 두지 않습니다.
    const lastIndex = record.edits.length - 1;
    const canRevert = (edit, i) => {
      if (stale || edit.old || edit.reverted) return false;
      if (i === lastIndex) return typeof edit.prev === 'string';
      const plan = planRevertOne(record, i);
      return Boolean(plan && !plan.conflict);
    };
    const items = record.edits.map((edit, i) => {
      const button = canRevert(edit, i) ? `<button class="mini" data-act="revert-one" data-at="${Number(edit.at)}" title="이 수정만 원래 글로 되돌려요">${ICONS.undo}이것만</button>` : '';
      const tag = edit.reverted ? '<span class="tag">되돌림</span>' : '';
      return `<div class="it${edit.old ? ' old' : ''}${edit.reverted ? ' gone' : ''}"><div class="meta"><b>${KIND_LABEL[edit.kind] || '수정'}</b><span>${ago(edit.at)}</span>${tag}<span class="grow"></span>${button}</div>${edit.before ? `<span class="del">${esc(clip(edit.before))}</span>` : ''}<span class="ins">${edit.after ? `<mark>${esc(clip(edit.after))}</mark>` : '<i>(지움)</i>'}</span></div>`;
    }).reverse().join('');
    const notes = [
      stale && reloadNeeded.has(msgId)
        ? '<div class="stale">서버에는 저장됐어요. 새로고침하면 흔적이 칠해지고 되돌리기도 쓸 수 있어요.</div>'
        : stale ? '<div class="stale">이 메시지가 다른 곳에서 바뀌어서 흔적을 칠하지 못했어요. 되돌리기도 막아 두었어요.</div>' : '',
      record.rebased ? '<div class="stale">중간에 다른 곳에서 글이 바뀌어서, 그 뒤의 수정만 되돌릴 수 있어요. 흐린 기록은 보기만 돼요.</div>' : '',
    ].join('');
    const seg = '<div class="seg"><button data-act="view" data-view="log" aria-pressed="true">기록</button><button data-act="view" data-view="cmp" aria-pressed="false">전후 비교</button></div>';
    pop.querySelector('.bd').innerHTML = `${seg}<div class="v-log">${notes}<div class="list">${items || '<div class="empty">기록이 없어요.</div>'}</div></div><div class="v-cmp" hidden></div>`;
    const last = record.edits[record.edits.length - 1];
    const canUndo = !stale && last && typeof last.prev === 'string';
    pop.querySelector('.ft').innerHTML = `<button class="sw" data-act="paint" aria-pressed="${settings.paint}"><i></i>색칠</button><span class="grow"></span><button class="btn danger" data-act="forget" title="글은 그대로 두고 기록만 지워요">기록 지우기</button><button class="btn" data-act="undo"${canUndo ? '' : ' disabled'}>${ICONS.undo}방금 것</button><button class="btn pri" data-act="restore"${stale ? ' disabled' : ''}>처음 글로</button>`;
    pop.trace = { chatId, msgId, group };
    place(pop, rect, 'below');
    pop.focus({ preventScroll: true });
  }

  function onPanelKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      swallowKeyUp('Escape');
      if (ui.pop) closePop();
      else hideToolbar();
      return;
    }
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    const pop = ui.pop;
    if (!pop?.edit || (event.composedPath()[0] || event.target)?.tagName !== 'TEXTAREA') return;
    if (pop.edit.source ? (event.ctrlKey || event.metaKey) : !event.shiftKey && !coarse()) {
      event.preventDefault();
      swallowKeyUp('Enter');
      saveEditor();
    }
  }

  // 키를 누르는 순간 창이 닫히면, 손을 뗄 때의 keyup이 본문으로 가서 크랙 단축키(Enter → 입력창 이동)가 움직입니다. 그 keyup 하나를 삼킵니다.
  // 키를 누른 채로 있으면 반복 keydown도 새므로 같이 막고, keyup은 실제로 올 때까지(최대 5초) 기다립니다.
  function swallowKeyUp(key) {
    const onDown = event => {
      if (event.key !== key || !event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onUp = event => {
      if (event.key !== key) return;
      event.stopPropagation();
      stop();
    };
    const stop = () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    setTimeout(stop, 5000);
  }

  async function runTrace(action, button) {
    const pop = ui.pop;
    if (pop.busy) return;
    const { chatId, msgId, group } = pop.trace;
    const live = group.isConnected ? group : findGroup(msgId);
    pop.busy = true;
    button?.classList.add('busy');
    try {
      if (action === 'undo') doneToast(await undoLast(chatId, msgId, live), '방금 수정을 되돌렸어요');
      if (action === 'restore') doneToast(await restoreBase(chatId, msgId, live), '처음 글로 되돌렸어요');
      if (action === 'revert-one') doneToast(await revertOne(chatId, msgId, live, Number(button.dataset.at)), '그 수정만 되돌렸어요');
      pop.busy = false;
      if (ui.pop === pop) closePop();
    } catch (error) {
      pop.busy = false;
      button?.classList.remove('busy');
      failed(error);
    }
  }

  // 흔적 창의 '기록 | 전후 비교' 전환. 비교는 처음 열 때 한 번 그립니다. 비교는 넓은 창으로 보여 줍니다.
  function switchTraceView(view, full) {
    const pop = ui.pop;
    if (!pop?.trace) return;
    const record = book(pop.trace.chatId)[pop.trace.msgId];
    pop.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    const log = pop.querySelector('.v-log');
    const cmp = pop.querySelector('.v-cmp');
    if (view === 'cmp' && record && (!cmp.dataset.ready || full !== undefined)) {
      cmp.innerHTML = compareHtml(record, Boolean(full));
      cmp.dataset.ready = '1';
    }
    log.hidden = view !== 'log';
    cmp.hidden = view !== 'cmp';
    pop.classList.toggle('wide', view === 'cmp');
    const left = parseFloat(pop.style.left) || 10;
    pop.style.left = `${Math.max(10, Math.min(innerWidth - pop.offsetWidth - 10, left))}px`;
    const top = parseFloat(pop.style.top) || 10;
    pop.style.top = `${Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, top))}px`;
  }

  function onPanelClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'close') return closePop();
    if (act === 'edit' || act === 'erase' || act === 'source') return startEdit(act);
    if (act === 'save' || act === 'save-source') return saveEditor();
    if (act === 'undo' || act === 'restore' || act === 'revert-one') return runTrace(act, button);
    if (act === 'view') return switchTraceView(button.dataset.view);
    if (act === 'cmp-full') return switchTraceView('cmp', button.getAttribute('aria-pressed') !== 'true');
    if (act === 'forget') {
      const { chatId, msgId } = ui.pop.trace;
      forget(chatId, msgId);
      closePop();
      toast('기록만 지웠어요. 글은 그대로예요.');
      return;
    }
    if (act === 'paint') {
      settings.paint = !settings.paint;
      writeValue(SETTINGS_KEY, settings);
      button.setAttribute('aria-pressed', String(settings.paint));
      schedulePaint(0);
    }
  }

  // ---------- 선택 감지 ----------

  const mdOf = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('.wrtn-markdown') || null;

  // 선택 안에 다른 메시지의 글자가 들어 있는지
  function otherMessageTextIn(range, group) {
    for (const other of document.querySelectorAll('.wrtn-markdown')) {
      if (group.contains(other)) continue;
      const o = document.createRange();
      o.selectNodeContents(other);
      if (range.compareBoundaryPoints(Range.START_TO_END, o) <= 0 || range.compareBoundaryPoints(Range.END_TO_START, o) >= 0) continue;
      const x = range.cloneRange();
      if (x.compareBoundaryPoints(Range.START_TO_START, o) < 0) x.setStart(o.startContainer, o.startOffset);
      if (x.compareBoundaryPoints(Range.END_TO_END, o) > 0) x.setEnd(o.endContainer, o.endOffset);
      if (/[\p{L}\p{N}]/u.test(x.toString())) return true;
    }
    return false;
  }

  function currentSelection() {
    if (!cmeEnabled) return null;
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const home = mdOf(sel.anchorNode) || mdOf(range.startContainer) || mdOf(range.endContainer);
    const group = groupOf(home);
    if (!home || !group) return null;
    const inGroup = node => {
      const m = mdOf(node);
      return Boolean(m && group.contains(m));
    };
    // 세 번 클릭처럼 끝이 메시지 글 밖(버튼·다음 블록 맨 앞)에 걸리면, 다른 메시지 글자가 없을 때만 이 메시지 글 끝으로 줄입니다.
    if (!inGroup(range.startContainer) || !inGroup(range.endContainer)) {
      // 시작 쪽이 다른 메시지에 있으면(목록 아래 빈틈까지 끈 경우) 화면에 칠해진 곳과 끈 곳이 달라서 거절합니다.
      if (!inGroup(range.startContainer) && !group.contains(range.startContainer)) return null;
      if (otherMessageTextIn(range, group)) return null;
      const mds = mdsOf(group);
      if (!inGroup(range.startContainer)) {
        const first = mds.find(m => range.comparePoint(m, 0) === 0);
        if (!first) return null;
        range.setStart(first, 0);
      }
      if (!inGroup(range.endContainer)) {
        const last = mds.slice().reverse().find(m => range.comparePoint(m, m.childNodes.length) === 0);
        if (!last) return null;
        range.setEnd(last, last.childNodes.length);
      }
    }
    const md = mdOf(range.startContainer);
    const el = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (!md || md.closest('[contenteditable="true"]')) return null;
    // 본문 안의 버튼 글자·입력 칸·핀셋 UI를 고른 것은 무시합니다.
    if ([range.startContainer, range.endContainer].some(node => el(node)?.closest('[contenteditable="true"], button, textarea, input, select, .cpn-ui'))) return null;
    if (!here().chatId || !/[\p{L}\p{N}]/u.test(range.toString())) return null;
    return { md, group, range };
  }

  // 이미 더 빨리 확인하기로 한 게 있으면 미루지 않습니다(마우스를 뗀 직후에 막대가 바로 뜨게).
  let selTimer = 0;
  let selDue = 0;
  let pointerHeld = false;
  function checkSelection(delay) {
    const due = Date.now() + delay;
    if (selTimer && selDue <= due) return;
    clearTimeout(selTimer);
    selDue = due;
    selTimer = setTimeout(() => {
      selTimer = 0;
      if (ui.pop) return;
      const sel = currentSelection();
      // 답변을 만드는 중(글자가 아직 안 나오는 대기 구간 포함)에는 막대를 띄우지 않습니다.
      const state = sel ? findBridge(sel.md).state : null;
      if (!sel || streamingNow() || (state && String(state.status).toUpperCase() !== 'IDLE')) {
        hideToolbar();
        return;
      }
      if (ui.toolbar && ui.sel && ui.sel.md === sel.md && ui.sel.range.toString() === sel.range.toString()) return;
      showToolbar(sel);
    }, delay);
  }

  let downAt = null;
  let warnedBlocked = false;
  document.addEventListener('pointerup', event => {
    pointerHeld = false;
    if (event.composedPath().includes(ui.host)) return;
    // 메시지 글을 마우스로 끌었는데 선택이 안 되면, 다른 확프가 글자 선택을 막고 있는 것입니다(한 번만 알림).
    if (!warnedBlocked && event.pointerType === 'mouse' && downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 12) {
      const md = event.target instanceof Element ? event.target.closest('.wrtn-markdown') : null;
      if (md && document.getSelection()?.isCollapsed && getComputedStyle(md).userSelect === 'none') {
        warnedBlocked = true;
        toast('다른 확프(모바일 유틸의 길게 누르기 메뉴)가 글자 선택을 막고 있어요. 그 설정을 끄면 핀셋을 쓸 수 있어요.', { error: true, ms: 6000 });
      }
    }
    downAt = null;
    checkSelection(30);
  }, true);
  document.addEventListener('pointercancel', () => { pointerHeld = false; }, true);
  document.addEventListener('keyup', event => {
    if (event.shiftKey || event.key === 'Shift') checkSelection(60);
  }, true);
  // 마우스로 끄는 중에는 기다렸다가 뗄 때 확인합니다. 휴대폰은 선택 손잡이를 움직여도 포인터 이벤트가 없어서 이것으로 확인합니다.
  document.addEventListener('selectionchange', () => {
    if (coarse()) {
      // 휴대폰: 손잡이를 끄는 동안에는 막대를 다시 만들지 않고, 멈춘 뒤 한 번만 확인합니다.
      clearTimeout(selTimer);
      selTimer = 0;
      checkSelection(450);
      return;
    }
    if (pointerHeld) return;
    checkSelection(250);
  });
  document.addEventListener('pointerdown', event => {
    const path = event.composedPath();
    if (path.includes(ui.host)) return;
    pointerHeld = event.pointerType === 'mouse';
    downAt = { x: event.clientX, y: event.clientY };
    // 새로 누르면 옛 선택의 막대는 바로 숨깁니다(새 선택을 옛 막대 위에서 놓아 옛 선택을 고치지 않게).
    hideToolbar();
    if (ui.pop && !ui.pop.edit) closePop();
  }, true);
  window.addEventListener('scroll', () => hideToolbar(), true);
  window.addEventListener('resize', () => hideToolbar());

  // 칠해진 흔적을 누르면 흔적 창을 엽니다.
  // 크랙 메시지 칸이 클릭 전파를 막아 두어서, 잡는 단계(capture)에서 듣습니다.
  document.addEventListener('click', event => {
    if (!document.getSelection()?.isCollapsed || event.composedPath().includes(ui.host)) return;
    const md = event.target instanceof Element ? event.target.closest('.wrtn-markdown') : null;
    const hit = md && hits.get(md);
    if (!hit) return;
    let node = null;
    let offset = 0;
    if (document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
      node = caret?.startContainer;
      offset = caret?.startOffset ?? 0;
    } else if (document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
      node = caret?.offsetNode;
      offset = caret?.offset ?? 0;
    }
    if (!node) return;
    const inside = hit.ranges.some(range => {
      try {
        return range.isPointInRange(node, offset) && (range.comparePoint(node, offset) === 0);
      } catch (error) {
        return false;
      }
    });
    if (inside) openTrace(hit.group, hit.id, { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY + 8, width: 0, height: 8 });
  }, true);

  // ---------- 시작 ----------

  let listObserver = null;
  let observedList = null;
  let lastPath = location.pathname;

  function tick() {
    injectHostStyle();
    // 배지와 창이 같은 테마 판단을 쓰고, 창을 연 채 테마를 바꿔도 따라가게 합니다.
    const theme = currentTheme();
    if (document.documentElement.dataset.cpnTheme !== theme) document.documentElement.dataset.cpnTheme = theme;
    if (ui.stage && ui.stage.dataset.theme !== theme) ui.stage.dataset.theme = theme;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      hideToolbar();
      closePop();
      schedulePaint(300);
    }
    const list = document.querySelector('[data-message-group-id]')?.parentElement || null;
    if (list !== observedList) {
      listObserver?.disconnect();
      observedList = list;
      if (list) {
        listObserver = new MutationObserver(mutations => {
          if (mutations.every(m => m.target instanceof Element && m.target.closest?.('.cpn-badge'))) return;
          schedulePaint();
        });
        listObserver.observe(list, { childList: true, subtree: true, characterData: true });
        findBridge();
        schedulePaint(100);
      }
    }
  }

  let cmeEnabled = readValue('cme:pinset:enabled', { enabled: true }).enabled !== false;
  CME.state.pinset = {
    records: () => JSON.parse(JSON.stringify(book(here().chatId))),
    role(group) { const bridge=findBridge(group.querySelector('.wrtn-markdown')),info=messageOf(group,bridge); const r=bridge.store?.getState()?.messages.get(info?.msgId)?.role; return r==='user'||r==='assistant'?r:''; },
    enabled: () => cmeEnabled,
    toggle() { cmeEnabled = !cmeEnabled; writeValue('cme:pinset:enabled', { enabled: cmeEnabled }); if (!cmeEnabled) { hideToolbar(); closePop(); } },
    trace(id) { const node=findGroup(id); if(!node)throw new UserError('화면에 메시지가 없어요. 해당 메시지로 이동해 주세요.'); openTrace(node,id,node.getBoundingClientRect()); },
    async undo(id) { const node=findGroup(id); if(!node)throw new UserError('화면에 메시지가 없어요. 해당 메시지로 이동해 주세요.'); return undoLast(here().chatId,id,node); }
  };
  document.dispatchEvent(new Event('cme:companions'));
  hookNetwork();
  tick();
  setInterval(tick, 1000);

  // 실기기 점검용: 개발자 도구 콘솔에서 CrackPinset.diag() 를 실행하면 연결 상태를 보여 줍니다.
  pageWindow.CrackPinset = {
    version: VERSION,
    diag() {
      const h = here();
      const md = document.querySelector('[data-message-group-id] .wrtn-markdown');
      const bridge = findBridge(md);
      const state = bridge.store ? bridge.store.getState() : null;
      const info = md ? messageOf(groupOf(md), bridge) : null;
      return {
        version: VERSION,
        route: h,
        fiber: bridge.fiber,
        actions: bridge.actions ? Object.keys(bridge.actions).sort() : null,
        chatState: bridge.state ? { status: bridge.state.status, chatId: bridge.state.chatId, selectedMessageId: bridge.state.selectedMessageId } : null,
        chatIdMismatch: bridge.mismatch,
        store: state ? { messages: state.messages.size, groups: state.messageGroups ? state.messageGroups.length : null, updateMessage: typeof state.updateMessage === 'function' } : null,
        firstMessage: info ? { groupId: info.groupId, ids: info.ids, msgId: info.msgId, fromStore: info.fromStore, contentLength: info.content?.length ?? null, mds: info.mds.length, coverage: info.content ? Number(coverage(info.content, info.mds).toFixed(3)) : null } : null,
        highlightApi: Boolean(HL && registry()),
        // 다른 확프(모바일 유틸 길게 누르기 메뉴 등)가 메시지 글자 선택을 막고 있는지
        selectBlocked: md ? getComputedStyle(md).userSelect === 'none' : null,
        network: { xhr: diagState.xhrHooked, xhrWrapped: diagState.xhrWrapped, fetch: diagState.fetchHooked },
        lastPath: diagState.lastPath,
        lastError: diagState.lastError,
        nativeCaptured: diagState.nativeCaptured,
        records: Object.keys(book(h.chatId)).length,
      };
    },
    records: () => JSON.parse(JSON.stringify(book(here().chatId))),
    debug(on = true) {
      debug = Boolean(on);
      try { pageWindow.localStorage.setItem('cpn:debug', debug ? '1' : '0'); } catch (error) { /* 무시 */ }
      return debug;
    },
    // 원문 대조 시험: CrackPinset.mapTest() → 현재 선택한 글이 원문 어디에 해당하는지
    async mapTest() {
      const sel = currentSelection();
      if (!sel) return '메시지 안에서 글자를 먼저 선택해 주세요.';
      const { target, mapped } = await prepare(sel);
      const { vpos, ...rest } = mapped;
      const erase = mapped.ok ? planSplice(target.content, mapped, '') : null;
      return { msgId: target.msgId, via: target.via, ...rest, sourceSlice: mapped.ok ? target.content.slice(mapped.a, mapped.b) : null, eraseWouldGive: erase ? erase.next.slice(Math.max(0, erase.a - 30), erase.a + erase.kept.length + 30) : '(원문 창으로 넘어감)' };
    },
  };
  console.info(LOG, `v${VERSION} 준비됨`);
})();



/*
 * 평소에는 일하지 않아요. 페이지를 감시하거나 주기적으로 도는 코드가 없고, 네트워크 요청도 하지 않아요.
 * 하는 일은 두 가지뿐이에요.
 *   - 클릭할 때(채팅방 이동, 오른쪽 패널 열기 등) 패널에 「로그 저장」 줄이 없으면 한 번 넣어요.
 *   - 그 줄이나 Tampermonkey 메뉴의 「로그 저장」을 눌러 저장할 때만 크랙 공식 API(읽기 전용)를 불러요.
 *       GET /crack-gen/v3/chats/:chatId/messages?limit&cursor   대화 (최신 메시지부터, 커서로 이전 페이지)
 *       GET /crack-gen/v3/chats/:chatId                          방 정보 (작품명, 유저노트, 모델)
 *       GET /crack-gen/v3/chats/:chatId/summaries?limit=20&type=longTerm&orderBy=newest&filter=all&cursor
 *                                                                장기기억 (20개씩, 커서로 다음 페이지)
 */
(() => {
    'use strict';

    if (typeof document !== 'undefined' && (CME.page.__crackTranscriptRunning || CME.externalTranscript())) { CME.duplicate('대화록'); return; }
    if (typeof document !== 'undefined') CME.page.__crackTranscriptRunning = true;
    const APP = { name: 'Crack Transcript', version: '1.3.0' };
    const API = 'https://crack-api.wrtn.ai/crack-gen';
    const PAGE_LIMITS = [500, 200, 100, 20], PAGE_GAP_MS = 120;
    const MEMORY_PAGE = 20, MEMORY_MAX_PAGES = 500; // the summaries API refuses more than 20 per page
    const DEFAULTS = Object.freeze({
        mode: 'all', recent: 50, from: 1, to: 100, format: 'txt',
        info: true, memory: true, stats: true, alts: false,
        split: false, splitSize: 1000, zip: false,
        clean: { on: true, imageMarkdown: true, imageUrls: true, comments: true, blankLines: true, markdown: false, wishInject: true, loreOoc: true, codeFence: 'keep', removeKeywords: false, keywordPatterns: '' },
    });
    const net = { fetch: (...args) => fetch(...args) };
    const hasDom = typeof document !== 'undefined';

    // ---------- small helpers ----------
    const wait = (ms, signal) => new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('cancelled', 'AbortError')); }, { once: true });
    });
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = n => String(n).padStart(2, '0');
    const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const fmtDate = d => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
    const num = n => Number(n || 0).toLocaleString('ko-KR');
    // Cut by characters, not UTF-16 units, so an emoji is never split in half.
    const fileSafe = s => Array.from(String(s || '크랙 대화').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 60).join('').trim() || '크랙 대화';
    const oneLine = s => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
    const cancelled = () => new DOMException('cancelled', 'AbortError');
    // Long jobs (cleaning and writing a huge chat) pause about every 50 ms, so the page keeps painting and taking
    // input, and 취소 gets through. The pause is a posted message, not a timer: a hidden tab runs timers once a second
    // (once a minute after 5 minutes), which would stretch a big save to minutes.
    let breath = 0;
    async function breathe(signal) {
        if (performance.now() - breath < 50) return;
        await new Promise(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0); });
        if (signal?.aborted) throw cancelled();
        breath = performance.now();
    }
    // File text is collected as string pieces, never one huge string (a very long chat would hit the browser's maximum
    // string length). Every ~2M characters the pieces so far become one Blob part, so a long chat is not held twice
    // (as strings and as Blob data) while its file is made. done() returns the Blob parts.
    function pieces(...first) {
        const parts = [], cur = [];
        let chars = 0;
        const flush = () => { if (cur.length) parts.push(new Blob(cur)); cur.length = 0; chars = 0; };
        const push = (...xs) => { for (const x of xs) { cur.push(x); chars += x.length; } if (chars > 1 << 21) flush(); };
        push(...first);
        return { push, done() { flush(); return parts; } };
    }
    // A Mongo-style id starts with its creation time in seconds; messages carry no other timestamp.
    const idTime = id => /^[0-9a-f]{24}$/i.test(id || '') ? new Date(parseInt(id.slice(0, 8), 16) * 1000) : null;

    function readToken() {
        if (!hasDom) return '';
        const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }
    function routeChat(path = hasDom ? location.pathname : '') {
        let m = String(path).match(/\/stories\/([^/]+)\/episodes\/([0-9a-f]{24})/i);
        if (m) return { storyId:m[1], chatId:m[2], kind:'story' };
        m = String(path).match(/^\/(?:characters\/[^/]+\/chats|u\/[^/]+\/c)\/([0-9a-f]{24})/i);
        return m ? { storyId:'', chatId:m[1], kind:'character' } : null;
    }

    // ---------- API ----------
    async function api(path, { signal } = {}) {
        for (let attempt = 0; ; attempt++) {
            let res;
            try {
                res = await net.fetch(API + (routeChat()?.kind === 'character' ? path.replace('/v3/chats/', '/character-chats/') : path), { headers: { accept: 'application/json, text/plain, */*', authorization: `Bearer ${readToken()}`, platform: 'web', 'wrtn-locale': 'ko-KR' }, signal });
            } catch (error) {
                if (signal?.aborted) throw error;
                if (attempt >= 5) throw new Error(`네트워크 오류로 받지 못했어요 (${error.message})`);
                await wait(Math.min(15000, 800 * 2 ** attempt), signal);
                continue;
            }
            if (res.ok) { const body = await res.json(); return body && typeof body === 'object' && 'data' in body ? body.data : body; }
            if (res.status === 401 && attempt < 1) { await wait(1500, signal); continue; } // the page may refresh its token meanwhile
            if ((res.status === 429 || res.status >= 500) && attempt < 6) {
                const after = Number(res.headers.get('retry-after'));
                await wait(after > 0 ? Math.min(after, 30) * 1000 : Math.min(15000, 800 * 2 ** attempt), signal);
                continue;
            }
            const error = new Error(res.status === 401 ? '로그인이 풀렸어요. 크랙을 새로고침한 뒤 다시 눌러 주세요.' : `크랙 서버가 요청을 거절했어요 (HTTP ${res.status}).`);
            error.status = res.status;
            throw error;
        }
    }

    // Only what the files need is kept; the rest of each page is dropped as it arrives (long chats stay light).
    const slim = m => ({ _id: m._id, role: m.role, content: m.content, turnId: m.turnId, parentTurnId: m.parentTurnId, status: m.status, reroll: m.reroll, isPrologue: m.isPrologue, crackerModel: m.crackerModel, situationImages: m.situationImages, images: m.images, imageUrls: m.imageUrls });

    // Pages from newest to oldest until `enough(all)` says so or the history ends. A failure after retries keeps
    // what was already received on the error, so it can still be saved. A server that repeats a page (same cursor,
    // nothing new) stops the paging the same way instead of being asked again and again.
    async function fetchMessages(chatId, { enough, onProgress, signal } = {}) {
        const all = [], ids = new Set(), cursors = new Set();
        let cursor = null, step = 0, pages = 0;
        for (;;) {
            let data;
            try {
                data = await api(`/v3/chats/${chatId}/messages?limit=${PAGE_LIMITS[step]}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
            } catch (error) {
                // A smaller page size if the server ever refuses a big one (not when it is only busy).
                if (!pages && step < PAGE_LIMITS.length - 1 && [400, 413, 422].includes(error.status)) { step++; continue; }
                error.partial = all;
                throw error;
            }
            const list = Array.isArray(data?.messages) ? data.messages : [];
            const before = all.length;
            for (const m of list) if (m && m._id && !ids.has(m._id)) { ids.add(m._id); all.push(slim(m)); }
            pages++;
            onProgress?.(all.length, pages);
            const next = data?.nextCursor ? String(data.nextCursor) : '';
            const end = !data?.hasNext || !next || !list.length;
            if (end || enough?.(all)) return { messages: all, complete: end };
            if (all.length === before || cursors.has(next)) {
                const error = new Error('크랙 서버가 같은 페이지를 되풀이해서 받기를 멈췄어요.');
                error.partial = all;
                throw error;
            }
            cursors.add(next);
            cursor = next;
            await wait(PAGE_GAP_MS, signal);
        }
    }

    async function fetchChat(chatId, opts, signal) {
        if (!opts.info) return { chat: null };
        try { return { chat: await api(`/v3/chats/${chatId}`, { signal }) }; }
        catch (error) { if (signal?.aborted) throw error; return { chat: null, chatError: error.message }; }
    }

    // Long-term memories, 20 per page: each page names the next one until there is none. Returned oldest first, so
    // they read in story order. When a later page fails, the pages already received are kept (`failure` says why).
    async function fetchMemories(chatId, { signal } = {}) {
        const list = [], ids = new Set(), cursors = new Set();
        let cursor = null, total = 0, failure = '';
        for (let page = 0; page < MEMORY_MAX_PAGES; page++) {
            let data;
            try {
                data = await api(`/v3/chats/${chatId}/summaries?limit=${MEMORY_PAGE}&type=longTerm&orderBy=newest&filter=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
            } catch (error) {
                if (signal?.aborted || !list.length) throw error;
                failure = error.message;
                break;
            }
            const items = Array.isArray(data?.summaries) ? data.summaries : [];
            total = Math.max(total, Number(data?.totalCount) || 0);
            for (const s of items) {
                if (!s || !s._id || ids.has(s._id)) continue;
                ids.add(s._id);
                const at = s.createdAt ? new Date(s.createdAt) : idTime(s._id);
                list.push({ id: s._id, title: oneLine(s.title), summary: oneLine(s.summary), createdAt: at && !isNaN(at) ? at : null });
            }
            const next = data?.nextCursor ? String(data.nextCursor) : '';
            if (!next || !items.length || cursors.has(next)) break;
            cursors.add(next);
            cursor = next;
            await wait(PAGE_GAP_MS, signal);
        }
        // Pages are newest first: reversed, the stable sort keeps memories with the same time oldest first too.
        list.reverse().sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
        return { memories: list, total: Math.max(total, list.length), failure };
    }

    // ---------- thread ----------
    // The list is newest first. Following parentTurnId back from the newest message gives the line the chat really
    // took; other assistant messages with the same parent are rerolls (other versions).
    function buildThread(messages) {
        const byTurn = new Map(), children = new Map();
        for (const m of messages) {
            if (m.turnId && !byTurn.has(m.turnId)) byTurn.set(m.turnId, m);
            const key = m.parentTurnId || '';
            if (!children.has(key)) children.set(key, []);
            children.get(key).push(m);
        }
        const chain = [], seen = new Set();
        let cur = messages[0] || null;
        while (cur && !seen.has(cur.turnId)) { seen.add(cur.turnId); chain.push(cur); cur = cur.parentTurnId ? byTurn.get(cur.parentTurnId) : null; }
        chain.reverse();
        const rooted = Boolean(chain.length && !chain[0].parentTurnId);
        return { chain, children, rooted, onChain: seen };
    }

    function normalize(m) {
        const images = [];
        for (const src of [m.situationImages, m.images, m.imageUrls]) {
            if (!Array.isArray(src)) continue;
            for (const it of src) { const url = typeof it === 'string' ? it : it?.url || it?.imageUrl || it?.src; if (url) images.push(String(url)); }
        }
        return {
            id: m._id, turnId: m.turnId || '', parentTurnId: m.parentTurnId || '', role: m.role === 'user' ? 'user' : 'assistant',
            content: String(m.content ?? ''), createdAt: idTime(m._id), status: m.status || '', reroll: m.reroll === true,
            prologue: m.isPrologue === true, model: m.crackerModel || '', images,
        };
    }

    // Turn = a user message and the replies that follow it. The opening message of the chat (no parent) is the
    // prologue; a reply at the head of a cut-off history is not, it is the tail of a turn whose start was not read.
    function toTurns(thread) {
        const turns = [];
        let cur = null;
        for (const raw of thread.chain) {
            const m = normalize(raw);
            if (m.role === 'user' || !cur) {
                cur = { no: null, user: m.role === 'user' ? m : null, replies: [], alts: [], prologue: m.role !== 'user' && (m.prologue || !m.parentTurnId) };
                turns.push(cur);
                if (m.role === 'user') continue;
            }
            cur.replies.push(m);
        }
        // Other versions: off-line assistant messages under the same parent as any reply of the turn (a reroll of a
        // continuation hangs under the reply before it).
        for (const t of turns) {
            if (!t.replies.length) continue;
            const parents = new Set(t.replies.map(r => r.parentTurnId || ''));
            t.alts = [...parents].flatMap(p => thread.children.get(p) || [])
                .filter(x => x.role !== 'user' && !thread.onChain.has(x.turnId))
                .map(normalize)
                .sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
        }
        return turns;
    }

    function numberTurns(turns, base) {
        // base = the number the first user turn gets (null when unknown: the history before it was not read).
        let n = base;
        for (const t of turns) {
            if (t.prologue) { t.no = n === null ? null : 0; t.label = '프롤로그'; continue; }
            t.no = n === null ? null : n;
            if (n !== null) n++;
        }
        // `rel` is the order within the selection; files use it when the real number is unknown, so split parts and
        // every format count the same way.
        let rel = 1;
        for (const t of turns) if (!t.prologue) { t.rel = rel; t.label = t.no === null ? `최근 ${rel}` : `${t.no}턴`; rel++; }
        return turns;
    }
    const turnNo = t => t.no !== null ? t.no : t.prologue ? 0 : t.rel;

    // ---------- selection by mode ----------
    function pickTurns(mode, opts, fetched, checkpoint) {
        const thread = buildThread(fetched.messages);
        const turns = toTurns(thread);
        const note = [];
        if (mode === 'all' || mode === 'range') {
            if (!thread.rooted) note.push('대화 처음까지 다 받지 못해서 번호를 확정하지 못했어요.');
            numberTurns(turns, thread.rooted ? 1 : null);
            if (mode === 'range') {
                const a = Math.max(0, Number(opts.from) || 0), b = Math.max(a, Number(opts.to) || a);
                return { turns: turns.filter(t => t.no !== null && t.no >= a && t.no <= b), note, newest: false };
            }
            return { turns, note, newest: true };
        }
        if (mode === 'recent') {
            const want = Math.max(1, Number(opts.recent) || 1);
            const keep = turns.filter(t => !t.prologue).slice(-want);
            // Without the start of the chat, real numbers can still come from the saved point when it was received.
            const at = !thread.rooted && Number.isFinite(checkpoint.no) && checkpoint.userTurnId ? turns.findIndex(t => t.user?.turnId === checkpoint.userTurnId) : -1;
            if (thread.rooted) numberTurns(turns, 1);
            else if (at >= 0) numberTurns(turns, checkpoint.no - turns.slice(0, at).filter(t => !t.prologue).length);
            else numberTurns(keep, null); // unknown numbers: count within the file
            if (keep.length && keep[0].no === null) {
                note.push('대화 처음까지 받지 않아서 턴 번호는 이번 파일 안의 순서예요.');
                // A saved point with a real number is worth more than one without: keep it.
                if (Number.isFinite(checkpoint.no)) return { turns: keep, note, newest: false };
            }
            return { turns: keep, note, newest: true };
        }
        // mode === 'new': everything after the saved point.
        const idx = turns.findIndex(t => (checkpoint.userTurnId && t.user?.turnId === checkpoint.userTurnId) || (!checkpoint.userTurnId && t.prologue));
        if (idx < 0) return { turns: [], note: ['저장해 둔 지점을 대화에서 찾지 못했어요. 「전체」로 한 번 저장해 주세요.'], newest: false, lost: true };
        const savedTurn = turns[idx];
        const lastReply = savedTurn.replies[savedTurn.replies.length - 1];
        // The saved last turn counts again when its reply was regenerated or continued after saving.
        const from = lastReply && lastReply.turnId !== checkpoint.leafTurnId ? idx : idx + 1;
        if (from === idx) note.push('저장 뒤에 마지막 턴의 답변이 바뀌어서 그 턴도 다시 넣었어요.');
        // The prologue opens the chat, so the turn after it is always 1, whatever number was stored with it.
        const baseNo = savedTurn.prologue ? 1 : Number.isFinite(checkpoint.no) ? checkpoint.no : null;
        numberTurns(baseNo === null ? turns.slice(from) : turns.slice(idx), baseNo);
        if (baseNo === null) note.push('이전 저장의 턴 번호를 몰라서 이번 파일 안의 순서로 표시했어요.');
        return { turns: turns.slice(from), note, newest: true };
    }

    // ---------- cleaning (applied to every message before saving) ----------
    const FENCE = /^\s*```/;
    // ```text``` opening and closing on one line is an inline span (bots use it for status lines), not a fence.
    const FENCE_SPAN = /^\s*```(.*?)```(.*)$/;
    // Whole ``` blocks; an opening fence that never closes is kept as it is, and so is a line that only starts with
    // an inline span.
    function dropCodeBlocks(text) {
        const kept = [];
        let held = null;
        for (const line of text.split('\n')) {
            if (held) { held.push(line); if (/^\s*```\s*$/.test(line)) held = null; continue; }
            if (FENCE.test(line)) { if (/^\s*```.+```\s*$/.test(line)) continue; if (!FENCE_SPAN.test(line)) { held = [line]; continue; } }
            kept.push(line);
        }
        if (held) kept.push(...held);
        return kept.join('\n');
    }
    // An image address may hold one level of (parentheses).
    const IMG_DEST = String.raw`(?:[^()\n]|\([^()\n]*\))*`;
    // Pieces the decoration rule leaves alone: linked images, images, links (their text is still cleaned), inline
    // code (its marks go) and bare addresses, whose _ and * belong to the address. A private-use character already in
    // the text is kept the same way, so the placeholders below always come back in order.
    const SLOT = '';
    const KEEP = new RegExp(`(${[
        String.raw`\[!\[[^\]\n]*\]\(${IMG_DEST}\)\]\(${IMG_DEST}\)`,
        String.raw`!\[[^\]\n]*\]\(${IMG_DEST}\)`,
        String.raw`\[[^\]\n]+\]\([^)\n]+\)`,
        '`[^`\\n]+`',
        String.raw`https?:\/\/[^\s<>]+`,
        SLOT,
    ].join('|')})`, 'g');
    // Keeps the words, drops the decoration: headings, quotes, links, inline code, bold, italic, strike. _x_ counts
    // as italic only on word edges, so ㅠ_ㅠ or snake_case stay as written.
    // [mark, rule, replacement]: a rule runs only when its mark is in the text (most pieces have few or none), so a
    // new rule must come with its mark.
    const PLAIN = [
        ['**', /\*\*([^*\n]+)\*\*/g, '$1'],
        ['__', /(^|[^\p{L}\p{N}_])__([^_\n]+)__(?![\p{L}\p{N}_])/gu, '$1$2'],
        ['*', /(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2'],
        ['_', /(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1$2'],
        ['~~', /~~([^~\n]+)~~/g, '$1'],
    ];
    const plainText = s => PLAIN.reduce((t, [mark, re, to]) => t.includes(mark) ? t.replace(re, to) : t, s);
    // The kept pieces are parked as placeholders while the rules run over the whole line, so a mark that wraps a link
    // or code (**[링크](주소)**, *`코드`*) still pairs up. An address gives back trailing * _ ~, which close such a mark
    // (autolinks end before them too).
    const keepBack = p => p[0] === '`' ? p.slice(1, -1) : p[0] === '[' && p[1] !== '!' ? plainText(p.replace(/^\[([^\]\n]+)\]\([^)\n]+\)$/, '$1').replace(/`([^`\n]+)`/g, '$1')) : p;
    const plainLine = line => {
        const kept = [];
        const body = line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s{0,3}>\s?/, '').replace(KEEP, p => {
            const tail = p[0] === 'h' ? /[*_~]+$/.exec(p)?.[0] || '' : '';
            kept.push(tail ? p.slice(0, -tail.length) : p);
            return SLOT + tail;
        });
        let i = 0;
        return plainText(body).replace(new RegExp(SLOT, 'g'), () => keepBack(kept[i++]));
    };
    const IMAGE_URL_LINE = /^\s*https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif|svg)(?:\?\S*)?\s*$/i;
    const IMAGE_URL_LINES = /^[ \t]*https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif|svg)(?:\?\S*)?[ \t]*$/gim;
    // An image, or an image wrapped in a link (counted and removed as one).
    const IMAGE_MD = new RegExp(String.raw`\[!\[[^\]\n]*\]\((${IMG_DEST})\)\]\(${IMG_DEST}\)|!\[[^\]\n]*\]\((${IMG_DEST})\)`, 'g');
    const COMMENT_LINE = /^\s*\[(?:\/\/|comment)\]:\s*#\s*\(.*\)\s*$/i;
    const urlOf = inner => { const s = String(inner).trim(); const u = s[0] === '<' ? s.slice(1, s.indexOf('>') > 0 ? s.indexOf('>') : undefined) : s.split(/\s+/)[0]; return /^https?:\/\//i.test(u) ? u : ''; };

    // Reference blocks other extensions hide inside messages. Only whole blocks go (an opening marker with its own
    // closing marker), and a block never reaches across another opening marker of the same kind, so a lone broken
    // marker cannot swallow the story around it. Markers may be raw or HTML-escaped (&lt;!-- … --&gt;), and a \ or ?
    // in front of a marker at the start of a line belongs to it (one ending a sentence stays).
    const OPEN = '(?:<|&lt;)', CLOSE = '(?:>|&gt;)';
    const WISH_FAMILIES = 'RP_CONTEXT_MANAGER|WISH_SESSION_SETUP|RP_CTX';
    const hiddenComment = families => new RegExp(`(?:(^|\\n)[\\\\?])?${OPEN}!--\\s*(${families})(?:_START)?\\b(?:(?!${OPEN}!--\\s*\\2(?:_START)?\\b)[\\s\\S])*?\\2_END\\s*--${CLOSE}`, 'gi');
    const tagBlock = name => new RegExp(`${OPEN}${name}\\b(?:(?!${OPEN}${name}\\b)[\\s\\S])*?${OPEN}\\/${name}\\s*${CLOSE}`, 'gi');
    // Wish RP Manager · Core: context/memory notes, the first-message session setup, cognition notes and their
    // older one-line form. [rule, replacement]
    const WISH_RULES = [
        [hiddenComment(WISH_FAMILIES), (all, nl) => nl || ''],
        [tagBlock('rp_context_manager'), ''],
        [/^[ \t]*\[\/\/\]:[ \t]*#[ \t]*\(RP_COG_V1\|[^\n]*\)[ \t]*(?:\n|$)/gim, ''],
    ];
    const LORE_RULES = [[tagBlock('ooc_lore_context'), '']];
    // Nested blocks of one kind come off from the inside out, a few passes at most.
    const stripBlocks = (text, rules) => {
        for (let pass = 0; pass < 8; pass++) {
            const before = text;
            for (const [re, to] of rules) text = text.replace(re, to);
            if (text === before) break;
        }
        return text;
    };
    // Plain HTML comments. While the Wish rule is on, a Wish marker left in the text is a broken block kept on
    // purpose, so no comment may start there (it would run to any later --> and take the story with it).
    const COMMENTS = /<!--[\s\S]*?-->/g;
    const COMMENTS_NOT_WISH = new RegExp(`<!--(?!\\s*(?:${WISH_FAMILIES})(?![A-Za-z0-9]))[\\s\\S]*?-->`, 'gi');

    // `cut` (optional) collects the addresses of images taken out of the text, so the statistics still count them.
    function cleanContent(input, c, cut) {
        let text = String(input ?? '').replace(/\r\n?/g, '\n').replace(/﻿/g, '');
        if (!c?.on) return text;
        if (c.wishInject) text = stripBlocks(text, WISH_RULES);
        if (c.loreOoc) text = stripBlocks(text, LORE_RULES);
        if (c.codeFence === 'blocks') text = dropCodeBlocks(text);
        if (c.comments) text = text.replace(c.wishInject ? COMMENTS_NOT_WISH : COMMENTS, '');
        const lines = [];
        let inFence = false;
        for (let line of text.split('\n')) {
            if (c.comments && COMMENT_LINE.test(line)) continue;
            if (c.imageMarkdown && line.includes('![')) line = line.replace(IMAGE_MD, (all, a, b) => { const u = urlOf(a ?? b); if (u) cut?.push(u); return ''; });
            if (c.imageUrls && IMAGE_URL_LINE.test(line)) { cut?.push(line.trim()); continue; }
            if (FENCE.test(line)) {
                const span = FENCE_SPAN.exec(line);
                if (!span) { inFence = !inFence; if (c.codeFence === 'fences') continue; } // a fence line: ``` or ```lang
                else if (c.codeFence === 'fences') { line = `${span[1].trim()} ${span[2].trim()}`.trim(); if (!line) continue; } // ```x``` keeps x
            } else if (c.markdown && !inFence && !IMAGE_URL_LINE.test(line)) line = plainLine(line);
            // Trailing spaces and tabs off in one pass from the end (a regex here is quadratic on long space runs).
            // Only ASCII space and tab: trimEnd() would also take NBSP and U+3000.
            let end = line.length;
            while (end && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
            if (end < line.length) line = line.slice(0, end);
            lines.push(line.trim() ? line : '');
        }
        text = lines.join('\n');
        if (c.blankLines) text = text.replace(/\n{3,}/g, '\n\n').trim();
        return text;
    }
    // Cleans the chosen turns in place; returns how many characters went away. Other versions are cleaned only when
    // they go into the file.
    function cleanTurns(turns, c, { alts = true } = {}) {
        let removed = 0;
        if (!c?.on) return removed;
        for (const t of turns) for (const m of [t.user, ...t.replies, ...(alts ? t.alts : [])]) {
            if (!m) continue;
            const before = m.content.length, cut = [];
            m.content = cleanContent(m.content, c, cut);
            if (cut.length) m.cut = [...(m.cut || []), ...cut];
            removed += before - m.content.length;
        }
        return removed;
    }
    // Text formats: images attached to a message (situation images) are listed as links unless the cleaning drops
    // image URL lines, and images written in the text stay or go with the text.
    const showImages = opts => !(opts.clean?.on && opts.clean.imageUrls);
    // The HTML file shows every image as a picture where it is written, so its cleaning leaves images in the text and
    // the HTML builder turns them into pictures in place.
    const cleaningFor = opts => opts.format === 'html' && opts.clean?.on ? { ...opts.clean, imageMarkdown: false, imageUrls: false } : opts.clean;

    // ---------- stats ----------
    function computeStats(turns) {
        let userChars = 0, aiChars = 0, rerolls = 0, images = 0, first = null, last = null;
        for (const t of turns) {
            for (const m of [t.user, ...t.replies]) {
                if (!m) continue;
                if (m.role === 'user') userChars += m.content.length; else aiChars += m.content.length;
                images += m.images.length + (m.cut?.length || 0) + (m.content.match(IMAGE_MD)?.length || 0) + (m.content.match(IMAGE_URL_LINES)?.length || 0);
                if (m.createdAt) { if (!first || m.createdAt < first) first = m.createdAt; if (!last || m.createdAt > last) last = m.createdAt; }
            }
            rerolls += t.alts.length;
        }
        return { turns: turns.filter(t => !t.prologue).length, userChars, aiChars, totalChars: userChars + aiChars, rerolls, images, first, last };
    }

    // ---------- shared document parts ----------
    function describe(ctx) {
        const c = ctx.chat || {};
        const story = c.story || {};
        return {
            title: story.name || c.title || ctx.pageTitle || '크랙 대화',
            chatTitle: c.title || '',
            model: c.crackerModel || (typeof c.model === 'string' ? c.model : c.model?.name) || '',
            created: c.createdAt ? new Date(c.createdAt) : null,
            userNote: typeof story.userNote === 'string' ? story.userNote : story.userNote?.content || '',
        };
    }
    const rangeLabel = turns => {
        const nums = turns.filter(t => !t.prologue).map(t => t.no).filter(n => n !== null);
        if (nums.length) return `${nums[0]}-${nums[nums.length - 1]}턴`;
        const n = turns.filter(t => !t.prologue).length;
        return n ? `${n}턴` : '프롤로그';
    };
    const statsLine = s => `${num(s.turns)}턴 · 내 글 ${num(s.userChars)}자 · AI ${num(s.aiChars)}자 · 리롤 ${num(s.rerolls)}${s.images ? ` · 이미지 ${num(s.images)}` : ''} · ${fmtDate(s.first)} ~ ${fmtDate(s.last)}`;
    const whoOf = (t, m) => m.role === 'user' ? '나' : t.prologue ? '프롤로그' : 'AI';
    const memoriesOf = ctx => ctx.memories || [];

    // Image markdown (also wrapped in a link) as the HTML file draws it; the address ends at the first space.
    const HTML_URL = String.raw`(https?:\/\/(?:[^\s()]|\([^\s()]*\))+)(?:\s${IMG_DEST})?`;
    const HTML_IMG = new RegExp(String.raw`\[!\[[^\]\n]*\]\(\s*${HTML_URL}\)\]\(${IMG_DEST}\)|!\[[^\]\n]*\]\(\s*${HTML_URL}\)`, 'g');
    // Markdown-lite for display: **bold** and *narration*, on already-escaped text.
    const inline = s => s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

    // Every builder is async, pauses now and then (breathe) and returns the file as Blob parts (see pieces), except
    // EPUB, which returns its finished Blob.

    // ---------- TXT ----------
    // Turn blocks, so a tool reading the file can split it by whole turns:
    //   ===== TURN 12 =====
    //   [USER] / [CHARACTER]       (the other-version label is plain text inside the turn)
    // Attached image addresses sit on their own lines.
    async function buildTxt(ctx, turns, part, signal) {
        const d = describe(ctx), out = pieces('﻿');
        out.push(`${d.title}\n`);
        if (ctx.opts.info && d.chatTitle && d.chatTitle !== d.title) out.push(`대화: ${d.chatTitle}\n`);
        out.push(`범위: ${rangeLabel(turns)}${part ? ` (${part})` : ''} · 저장 ${fmtDate(ctx.now)}\n`);
        if (ctx.opts.stats) out.push(`통계: ${statsLine(computeStats(turns))}\n`);
        for (const n of ctx.notes) out.push(`※ ${n}\n`);
        if (ctx.opts.info && d.userNote) out.push(`\n유저노트:\n${d.userNote}\n`);
        const mem = memoriesOf(ctx);
        if (mem.length) out.push(`\n장기기억 ${num(mem.length)}개:\n${mem.map(m => `- ${m.title ? `${m.title}: ` : ''}${m.summary}`).join('\n')}\n`);
        const links = showImages(ctx.opts);
        const imgs = m => links && m.images.length ? `\n${m.images.join('\n')}` : '';
        for (const [i, t] of turns.entries()) {
            await breathe(signal);
            const blocks = [];
            if (t.user) blocks.push(`[USER]\n${t.user.content}${imgs(t.user)}`);
            for (const m of t.replies) blocks.push(`[CHARACTER]\n${m.content}${imgs(m)}`);
            if (ctx.opts.alts) t.alts.forEach((m, k) => blocks.push(`(다른 버전 ${k + 1})\n${m.content}`));
            out.push(`\n===== TURN ${turnNo(t) ?? i + 1} =====\n${blocks.join('\n\n')}\n`);
        }
        return out.done();
    }

    // ---------- HTML ----------
    // A browser cannot lay out a page taller than about 33.5M px (Chrome, Safari) or 17.9M px (Firefox): past that the
    // end of a long chat piles up on one spot and cannot be reached. 2,000 turns of ~3.5k characters on a phone in
    // Firefox measure about 12.6M px, so one HTML file holds at most this many turns.
    const HTML_PART = 2000;
    async function buildHtml(ctx, turns, part, signal) {
        const d = describe(ctx), s = ctx.opts.stats ? computeStats(turns) : null, mem = memoriesOf(ctx);
        // Pictures, not links, loading lazily: image markdown and bare image addresses in the text show right where they
        // are written (see cleaningFor), and the message's attached situation images show under it. Each picture is
        // parked as <n> while *emphasis* is applied, so a * inside an address cannot break it (escaped text has no <).
        const pic = u => `<a class="pic" href="${u}" target="_blank" rel="noopener"><img src="${u}" loading="lazy" decoding="async" alt=""></a>`;
        const body = text => {
            const parked = [];
            const park = u => `<${parked.push(pic(u)) - 1}>`;
            return inline(esc(text).replace(HTML_IMG, (all, a, b) => park(a ?? b)).replace(IMAGE_URL_LINES, line => park(line.trim())))
                .replace(/<(\d+)>/g, (all, i) => parked[+i]);
        };
        const pics = m => { const list = [...new Set([...m.images, ...(m.cut || [])])].filter(u => /^https?:\/\//i.test(u)); return list.length ? `<div class="pics">${list.map(u => pic(esc(u))).join('')}</div>` : ''; };
        const msg = (m, who) => `<div class="m ${m.role === 'user' ? 'u' : 'a'}"><div class="who">${who}${m.status && m.status !== 'end' ? ` <span class="st">(${esc(m.status)})</span>` : ''}<time>${fmtDate(m.createdAt)}</time></div><div class="tx">${body(m.content)}</div>${pics(m)}</div>`;
        const info = `<table class="meta">${ctx.opts.info && d.chatTitle && d.chatTitle !== d.title ? `<tr><th>대화</th><td>${esc(d.chatTitle)}</td></tr>` : ''}<tr><th>범위</th><td>${esc(rangeLabel(turns))}${part ? ` · ${part}` : ''}</td></tr><tr><th>저장</th><td>${fmtDate(ctx.now)}</td></tr></table>${ctx.opts.info && d.userNote ? `<details class="box" open><summary>유저노트</summary><div class="tx">${body(d.userNote)}</div></details>` : ''}${mem.length ? `<details class="box"><summary>장기기억 ${num(mem.length)}개</summary><ol class="mem">${mem.map(m => `<li>${m.title ? `<b>${esc(m.title)}</b> ` : ''}${esc(m.summary)}</li>`).join('')}</ol></details>` : ''}`;
        const stats = s ? `<div class="stats"><span><b>${num(s.turns)}</b>턴</span><span>내 글 <b>${num(s.userChars)}</b>자</span><span>AI <b>${num(s.aiChars)}</b>자</span><span>리롤 <b>${num(s.rerolls)}</b></span>${s.images ? `<span>이미지 <b>${num(s.images)}</b></span>` : ''}<span>${fmtDate(s.first)} ~ ${fmtDate(s.last)}</span></div>` : '';
        const notes = ctx.notes.length ? `<p class="note">${ctx.notes.map(esc).join('<br>')}</p>` : '';
        const out = pieces(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} · ${esc(rangeLabel(turns))}</title>
<style>
:root{--bg:#fff;--ink:#1a1918;--sub:#61605a;--mute:#85837d;--line:#e5e5e1;--u:#f5f5f2;--acc:#0c6acf}
@media(prefers-color-scheme:dark){:root{--bg:#141413;--ink:#f0efeb;--sub:#a8a69f;--mute:#85837d;--line:#2c2b29;--u:#1e1e1c;--acc:#6aa7ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 Pretendard,'Apple SD Gothic Neo',system-ui,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:28px 20px 80px}header{padding-bottom:16px;border-bottom:1px solid var(--line)}
.k{font-size:12px;font-weight:500;color:var(--mute)}h1{font-size:24px;font-weight:600;margin:6px 0 12px;line-height:1.35}
.meta{border-collapse:collapse;font-size:13px}.meta th{text-align:left;color:var(--sub);font-weight:500;padding:2px 16px 2px 0;white-space:nowrap}.meta td{padding:2px 0}
.stats{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;color:var(--sub);margin-top:10px}.stats b{color:var(--ink);font-weight:600}
.box{border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-top:12px}.box summary{cursor:pointer;font-weight:600;font-size:14px}
.mem{margin:8px 0 0;padding-left:22px;font-size:14px;line-height:1.6}.mem li{margin:4px 0}.mem b{font-weight:600}
.bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;padding:12px 0;background:var(--bg);border-bottom:1px solid var(--line)}
.bar input{flex:1;min-width:0;height:40px;font:inherit;font-size:14px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}.bar #go{flex:0 0 120px}.bar span{font-size:12px;color:var(--sub);align-self:center;white-space:nowrap}
.t{padding:16px 0;border-bottom:1px solid var(--line);scroll-margin-top:68px}.blk{content-visibility:auto;contain-intrinsic-size:80000px;contain-intrinsic-size:auto 80000px}.blk.part{content-visibility:visible}.t h2{font-size:12px;font-weight:600;color:var(--mute);margin:0 0 8px}
.m{border-radius:12px;padding:12px 16px;margin:8px 0}.m.u{background:var(--u)}.m.a{border:1px solid var(--line)}
.who{font-size:12px;font-weight:600;color:var(--sub);display:flex;gap:8px;margin-bottom:4px}.who time{margin-left:auto;font-weight:400;color:var(--mute)}.st{color:#e5432a}
.tx{white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}.tx em{color:var(--sub)}
.pic{display:inline-block;max-width:100%;vertical-align:top}.pic img{display:block;max-width:100%;max-height:480px;height:auto;border-radius:10px;background:var(--u)}
.pics{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.pics .pic img{max-height:360px}
.alt{margin-top:6px;font-size:14px}.alt summary{cursor:pointer;color:var(--acc);font-size:13px}.note{font-size:13px;color:var(--sub)}.hide{display:none}
</style></head><body><div class="wrap"><header><div class="k">크랙 대화 로그 · ${esc(APP.name)} ${APP.version}</div><h1>${esc(d.title)}</h1>${info}${stats}${notes}</header>
<div class="bar"><input id="q" type="search" placeholder="내용 검색"><input id="go" type="number" placeholder="턴 번호로 이동"><span id="n"></span></div>
<main>
`);
        // 50 turns per block: the browser lays out and paints only the blocks near the screen. The search hides blocks
        // without a hit and draws partly hidden ones normally; a jump gives its block and the one before it real height.
        for (const [i, t] of turns.entries()) {
            await breathe(signal);
            const id = t.no !== null ? `t${t.no}` : t.prologue ? 'p' : `r${t.rel ?? i}`;
            const alts = ctx.opts.alts && t.alts.length ? `<details class="alt"><summary>다른 버전 ${t.alts.length}개</summary>${t.alts.map((m, k) => msg(m, `버전 ${k + 1}`)).join('')}</details>` : '';
            out.push(`${i % 50 ? '' : i ? '</div><div class="blk">' : '<div class="blk">'}<section class="t" id="${id}"><h2>${esc(t.label)}</h2>${[t.user, ...t.replies].filter(Boolean).map(m => msg(m, whoOf(t, m))).join('')}${alts}</section>\n`);
        }
        out.push(`${turns.length ? '</div>' : ''}</main></div>
<script>
(function(){var q=document.getElementById('q'),go=document.getElementById('go'),n=document.getElementById('n'),ts=[].slice.call(document.querySelectorAll('.t')),bs=[].slice.call(document.querySelectorAll('.blk')),timer=0;
function run(){var v=q.value.trim().toLowerCase(),c=0,cs=v!==v.toUpperCase();ts.forEach(function(t){var hit=!v||(cs?t.textContent.toLowerCase():t.textContent).indexOf(v)>=0;t.classList.toggle('hide',!hit);if(hit)c++;});
bs.forEach(function(b){var k=b.querySelectorAll('.t:not(.hide)').length;b.classList.toggle('hide',!k);b.classList.toggle('part',k>0&&k<b.children.length);});n.textContent=v?c+'턴':'';}
q.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(run,200);});
go.addEventListener('keydown',function(e){if(e.key!=='Enter')return;var el=document.getElementById('t'+go.value)||document.getElementById('r'+go.value);if(el){q.value='';run();var b=el.parentNode;[b,b.previousElementSibling].forEach(function(x){if(x)x.style.contentVisibility='visible';});el.scrollIntoView();}});})();
</script></body></html>`);
        return out.done();
    }

    // ---------- Markdown ----------
    async function buildMd(ctx, turns, part, signal) {
        const d = describe(ctx), out = pieces(`# ${d.title}\n\n`), mem = memoriesOf(ctx);
        if (ctx.opts.info && d.chatTitle && d.chatTitle !== d.title) out.push(`- 대화: ${d.chatTitle}\n`);
        out.push(`- 범위: ${rangeLabel(turns)}${part ? ` · ${part}` : ''}\n- 저장: ${fmtDate(ctx.now)}\n\n`);
        if (ctx.opts.stats) out.push(`> ${statsLine(computeStats(turns))}\n\n`);
        for (const n of ctx.notes) out.push(`> ${n}\n\n`);
        if (ctx.opts.info && d.userNote) out.push('## 유저노트\n\n', d.userNote.split('\n').map(l => `> ${l}`).join('\n'), '\n\n');
        if (mem.length) out.push(`## 장기기억 (${num(mem.length)}개)\n\n`, mem.map(m => `- ${m.title ? `**${m.title}** — ` : ''}${m.summary}`).join('\n'), '\n\n');
        out.push('---\n\n');
        const links = showImages(ctx.opts);
        const imgs = m => links && m.images.length ? `\n\n${m.images.map((u, i) => `[이미지 ${i + 1}](${u})`).join(' · ')}` : '';
        // A <!-- with no --> after it in the same message would make Markdown viewers hide the rest of the file.
        const md = s => { const end = s.lastIndexOf('-->'); return s.replace(/<!--/g, (o, i) => i > end ? '&lt;!--' : o); };
        for (const t of turns) {
            await breathe(signal);
            out.push(`## ${t.label}\n\n`);
            for (const m of [t.user, ...t.replies]) if (m) out.push(`**${whoOf(t, m)}**\n\n${md(m.content)}${imgs(m)}\n\n`);
            if (ctx.opts.alts && t.alts.length) {
                out.push(`<details><summary>다른 버전 ${t.alts.length}개</summary>\n\n`);
                t.alts.forEach((m, i) => out.push(`**버전 ${i + 1}**\n\n${md(m.content)}\n\n`));
                out.push('</details>\n\n');
            }
        }
        return out.done();
    }

    // ---------- JSON ----------
    // A plain `title` + `messages[].role/content` shape that other tools can read; the rest rides along.
    async function buildJson(ctx, turns, part, signal) {
        const d = describe(ctx), s = computeStats(turns), mem = memoriesOf(ctx);
        const brief = x => ({ id: x.id, content: x.content, createdAt: x.createdAt?.toISOString() || null, model: x.model || undefined });
        const head = JSON.stringify({
            title: d.title,
            meta: {
                title: d.title, chatTitle: d.chatTitle || undefined, model: d.model || undefined, chatId: ctx.chatId, storyId: ctx.storyId,
                savedAt: ctx.now.toISOString(), app: `${APP.name} ${APP.version}`, range: rangeLabel(turns), part: part || undefined,
                userNote: ctx.opts.info && d.userNote ? d.userNote : undefined, notes: ctx.notes.length ? ctx.notes : undefined,
                stats: ctx.opts.stats ? { turns: s.turns, userChars: s.userChars, aiChars: s.aiChars, rerolls: s.rerolls, images: s.images, first: s.first?.toISOString() || null, last: s.last?.toISOString() || null } : undefined,
                memories: mem.length ? mem.map(m => ({ title: m.title, summary: m.summary, createdAt: m.createdAt?.toISOString() || null })) : undefined,
                // The text below went through these cleaning rules (so the file says it is not the raw text).
                cleaned: ctx.opts.clean?.on ? Object.entries(cleaningFor(ctx.opts)).filter(([k, v]) => k !== 'on' && v && v !== 'keep').map(([k, v]) => v === true ? k : `${k}:${v}`) : undefined,
            },
        }, null, 2);
        const out = pieces(head.slice(0, -2), ',\n  "messages": [\n');
        const links = showImages(ctx.opts);
        // One row per line, written as it is made (", " goes in front of every row but the first).
        let rows = 0;
        for (const [i, t] of turns.entries()) {
            await breathe(signal);
            const no = turnNo(t) ?? i + 1;
            for (const m of [t.user, ...t.replies]) {
                if (!m) continue;
                const row = { role: m.role, content: m.content, turn: no, id: m.id, createdAt: m.createdAt?.toISOString() || null };
                if (m.role !== 'user' && m.model) row.model = m.model;
                if (links && m.images.length) row.images = m.images;
                if (m.status && m.status !== 'end') row.status = m.status;
                if (t.prologue) row.prologue = true;
                // Other versions ride on the reply they stand in for.
                const mine = ctx.opts.alts && m.role !== 'user' ? t.alts.filter(a => a.parentTurnId === m.parentTurnId) : [];
                if (mine.length) row.alternates = mine.map(brief);
                out.push(`${rows++ ? ',\n' : ''}    ${JSON.stringify(row)}`);
            }
        }
        out.push(rows ? '\n  ]\n}\n' : '  ]\n}\n');
        return out.done();
    }

    // ---------- ZIP (stored, no compression) ----------
    // Slicing-by-8: table k (at k * 256) advances a byte through k more zero bytes, so 8 bytes take 8 lookups.
    const CRC_TABLE = (() => { const t = new Uint32Array(2048); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } for (let i = 256; i < 2048; i++) t[i] = t[t[i - 256] & 255] ^ (t[i - 256] >>> 8); return t; })();
    const crcStep = (c, u8) => {
        const T = CRC_TABLE;
        let i = 0;
        for (const end = u8.length - 7; i < end; i += 8) {
            const a = c ^ (u8[i] | u8[i + 1] << 8 | u8[i + 2] << 16 | u8[i + 3] << 24);
            c = T[1792 + (a & 255)] ^ T[1536 + (a >>> 8 & 255)] ^ T[1280 + (a >>> 16 & 255)] ^ T[1024 + (a >>> 24)] ^ T[768 + u8[i + 4]] ^ T[512 + u8[i + 5]] ^ T[256 + u8[i + 6]] ^ T[u8[i + 7]];
        }
        for (; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8);
        return c;
    };
    const crc32 = u8 => (crcStep(0xFFFFFFFF, u8) ^ 0xFFFFFFFF) >>> 0;
    async function crcOf(data) {
        if (!(data instanceof Blob)) return crc32(data);
        let c = 0xFFFFFFFF;
        for (let off = 0; off < data.size; off += 4 << 20) c = crcStep(c, new Uint8Array(await data.slice(off, off + (4 << 20)).arrayBuffer()));
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    // Entries may be strings, bytes or Blobs; Blobs are read in 4 MB slices for the checksum and then referenced as
    // they are, so bundling big files does not copy them into memory.
    async function makeZip(entries, type = 'application/zip') {
        const enc = new TextEncoder(), parts = [], central = [];
        let offset = 0, centralSize = 0;
        const d = new Date();
        const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        for (const e of entries) {
            await breathe();
            const name = enc.encode(e.name), data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
            const size = data instanceof Blob ? data.size : data.length, crc = await crcOf(data);
            const flags = /^[\x20-\x7e]*$/.test(e.name) ? 0 : 0x0800; // UTF-8 names
            const h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, flags, true); h.setUint16(8, 0, true);
            h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
            h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
            parts.push(h.buffer, name, data);
            const c = new DataView(new ArrayBuffer(46));
            c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, flags, true); c.setUint16(10, 0, true);
            c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
            c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
            central.push(c.buffer, name);
            centralSize += 46 + name.length;
            offset += 30 + name.length + size;
        }
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end.buffer], { type });
    }

    // ---------- EPUB ----------
    async function buildEpub(ctx, turns, part, signal) {
        const d = describe(ctx), s = ctx.opts.stats ? computeStats(turns) : null, mem = memoriesOf(ctx);
        // XML forbids most control characters: a vertical tab or form feed becomes a line break, the rest go.
        const x = v => esc(String(v ?? '').replace(/[\u000B\u000C]/g, '\n').replace(/[\u0000-\u0008\u000E-\u001F￾￿]/g, '')).replace(/&#39;/g, '&#x27;');
        const para = text => inline(x(text)).replace(/\n/g, '<br/>');
        const page = (title, inner) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko"><head><meta charset="utf-8"/><title>${x(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${inner}</body></html>`;
        // 50 turns per chapter; the prologue rides with the first chapter without counting as a turn.
        const CH = 50, chapters = [], lead = turns[0]?.prologue ? 1 : 0;
        for (let i = lead; i < turns.length; i += CH) chapters.push(turns.slice(i === lead ? 0 : i, i + CH));
        if (!chapters.length) chapters.push(turns);
        // Without real numbers every chapter would read "50턴": name it by its first and last turn instead.
        const chLabel = list => {
            const ts = list.filter(t => !t.prologue);
            if (!ts.length || ts.some(t => t.no !== null)) return rangeLabel(list);
            const a = ts[0].label, b = ts[ts.length - 1].label;
            return a === b ? a : `${a} – ${b}`;
        };
        const links = showImages(ctx.opts);
        const msg = (m, who) => `<div class="m ${m.role === 'user' ? 'u' : 'a'}"><p class="who">${x(who)}</p><p>${para(m.content)}</p>${links && m.images.length ? `<p class="img">${m.images.map((u, i) => `<a href="${x(u)}">이미지 ${i + 1}</a>`).join(' · ')}</p>` : ''}</div>`;
        const files = [];
        const info = `<h1>${x(d.title)}</h1><p class="sub">${x(rangeLabel(turns))}${part ? ` · ${x(part)}` : ''} · ${x(fmtDate(ctx.now))} 저장</p>${s ? `<p class="sub">${x(statsLine(s))}</p>` : ''}${ctx.notes.map(n => `<p class="sub">${x(n)}</p>`).join('')}${ctx.opts.info && d.userNote ? `<h2>유저노트</h2><p>${para(d.userNote)}</p>` : ''}${mem.length ? `<h2>장기기억 ${x(num(mem.length))}개</h2><ol class="mem">${mem.map(m => `<li>${m.title ? `<b>${x(m.title)}</b> ` : ''}${x(m.summary)}</li>`).join('')}</ol>` : ''}`;
        files.push({ name: 'OEBPS/info.xhtml', data: page(d.title, info) });
        for (const [i, list] of chapters.entries()) {
            await breathe(signal);
            const inner = list.map(t => `<section class="t"><h2>${x(t.label)}</h2>${[t.user, ...t.replies].filter(Boolean).map(m => msg(m, whoOf(t, m))).join('')}${ctx.opts.alts && t.alts.length ? `<div class="alt"><p class="who">다른 버전 ${t.alts.length}개</p>${t.alts.map((m, k) => msg(m, `버전 ${k + 1}`)).join('')}</div>` : ''}</section>`).join('');
            // A Blob per chapter right away: the book is never held as strings and bytes at once (makeZip takes Blobs).
            files.push({ name: `OEBPS/c${String(i + 1).padStart(5, '0')}.xhtml`, data: new Blob([page(chLabel(list), inner)]) });
        }
        const css = 'body{font-family:serif;line-height:1.7;margin:0 4%}h1{font-size:1.5em}h2{font-size:.85em;color:#777;margin:1.6em 0 .4em}.sub{color:#777;font-size:.85em;margin:.2em 0}.m{margin:.6em 0}.who{font-size:.8em;font-weight:bold;color:#777;margin:0}.u p{color:#3a3a8a}em{color:#666}.alt{border-left:2px solid #ccc;padding-left:.8em;margin-top:.6em}.img{font-size:.8em}.mem{font-size:.9em;padding-left:1.4em}.mem li{margin:.3em 0}';
        const ids = files.map((f, i) => ({ id: i === 0 ? 'info' : `c${i}`, href: f.name.replace('OEBPS/', '') }));
        const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const uid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ko"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${uid}</dc:identifier><dc:title>${x(d.title)} · ${x(rangeLabel(turns))}</dc:title><dc:language>ko</dc:language><dc:creator>크랙</dc:creator><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${ids.map(i => `<item id="${i.id}" href="${i.href}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map(i => `<itemref idref="${i.id}"/>`).join('')}</spine></package>`;
        const nav = page('목차', `<nav epub:type="toc" id="toc"><h1>목차</h1><ol><li><a href="info.xhtml">정보</a></li>${chapters.map((list, i) => `<li><a href="${ids[i + 1].href}">${x(chLabel(list))}</a></li>`).join('')}</ol></nav>`);
        const container = '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
        return makeZip([
            { name: 'mimetype', data: 'application/epub+zip' },
            { name: 'META-INF/container.xml', data: container },
            { name: 'OEBPS/content.opf', data: opf },
            { name: 'OEBPS/nav.xhtml', data: nav },
            { name: 'OEBPS/style.css', data: css },
            ...files,
        ], 'application/epub+zip');
    }

    // ---------- export ----------
    const FORMATS = {
        txt: { label: 'TXT', ext: 'txt', type: 'text/plain;charset=utf-8', build: buildTxt, hint: '턴 단위로 나눈 텍스트' },
        html: { label: 'HTML', ext: 'html', type: 'text/html;charset=utf-8', build: buildHtml, hint: '브라우저로 여는 읽기용 파일 (이미지 표시, 검색, 턴 번호로 이동)' },
        md: { label: 'MD', ext: 'md', type: 'text/markdown;charset=utf-8', build: buildMd, hint: 'Markdown · 노션, 옵시디언 같은 메모 앱용' },
        json: { label: 'JSON', ext: 'json', type: 'application/json;charset=utf-8', build: buildJson, hint: '다른 도구로 다시 가공하기 좋은 데이터 (청소 설정이 적용돼요)' },
        epub: { label: 'EPUB', ext: 'epub', type: 'application/epub+zip', build: buildEpub, hint: '전자책 앱으로 소설처럼 읽기' },
    };

    async function makeFiles(ctx, turns, signal) {
        const chunks = [];
        // N turns per file (HTML at most HTML_PART); the prologue rides with the first file without counting as a turn.
        let size = ctx.opts.split ? Math.max(10, Number(ctx.opts.splitSize) || 1000) : Infinity;
        if (ctx.opts.format === 'html') size = Math.min(size, HTML_PART);
        const lead = turns[0]?.prologue ? 1 : 0;
        if (turns.length - lead > size) for (let i = lead; i < turns.length; i += size) chunks.push(turns.slice(i === lead ? 0 : i, i + size));
        else chunks.push(turns);
        const base = `${fileSafe(describe(ctx).title)}_${stamp(ctx.now)}`, f = FORMATS[ctx.opts.format] || FORMATS.txt;
        const files = [];
        for (let i = 0; i < chunks.length; i++) {
            const list = chunks[i], part = chunks.length > 1 ? `${i + 1}/${chunks.length}` : '';
            const out = await f.build(ctx, list, part, signal);
            files.push({ name: `${base}_${rangeLabel(list)}${chunks.length > 1 ? `_${i + 1}of${chunks.length}` : ''}.${f.ext}`, blob: out instanceof Blob ? out : new Blob(out, { type: f.type }) });
        }
        return files;
    }

    async function bundle(files, ctx) {
        if (!ctx.opts.zip || files.length < 2) return files;
        return [{ name: `${fileSafe(describe(ctx).title)}_${stamp(ctx.now)}.zip`, blob: await makeZip(files.map(f => ({ name: f.name, data: f.blob }))) }];
    }

    // Files go out 400 ms apart (browsers drop downloads that start too close together). A cancel stops before the
    // next file is handed to the browser; the save is done as soon as the last file is out.
    async function download(files, signal) {
        for (const [i, f] of files.entries()) {
            if (i) await wait(400);
            if (signal?.aborted) throw cancelled();
            const url = URL.createObjectURL(f.blob), a = document.createElement('a');
            a.href = url; a.download = f.name; a.style.display = 'none';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        }
    }
    const io = { download };

    // ---------- saved point ----------
    const CK_PREFIX = 'checkpoint:';
    const ckKey = chatId => `${CK_PREFIX}${chatId}`;
    const getCheckpoint = chatId => { try { return GM_getValue(ckKey(chatId), null); } catch { return null; } };
    function setCheckpoint(chatId, turns) {
        const last = turns[turns.length - 1];
        if (!last) return;
        const leaf = last.replies[last.replies.length - 1] || last.user;
        const no = last.prologue ? 0 : last.no;
        try { GM_setValue(ckKey(chatId), { userTurnId: last.user?.turnId || null, leafTurnId: leaf?.turnId || null, no: Number.isFinite(no) ? no : null, at: Date.now() }); } catch {}
    }
    // Saved points of every room (the saved options stay).
    const savedKeys = () => { try { return (GM_listValues() || []).filter(k => String(k).startsWith(CK_PREFIX)); } catch { return []; } };
    const wipeSaved = () => { const keys = savedKeys(); for (const k of keys) { try { GM_deleteValue(k); } catch {} } return keys.length; };
    const pageTitle = () => hasDom ? document.title.replace(/\s*\|\s*크랙\s*$/, '').trim() : '';

    // `route` is the room the dialog was opened in, so a save never picks up another room after the page moved.
    async function runSave(opts, ui, signal, route = routeChat()) {
        if (!route) throw new Error('채팅방 안에서 눌러 주세요.');
        const title = pageTitle(); // read before the first await: the page may move to another room meanwhile
        const checkpoint = getCheckpoint(route.chatId);
        if (opts.mode === 'new' && !checkpoint) throw new Error('아직 이 방을 저장한 적이 없어요. 먼저 「전체」로 저장해 주세요.');
        const now = new Date(), started = Date.now();
        ui.progress('대화를 받는 중…');
        let enough = null;
        if (opts.mode === 'recent') { const want = Math.max(1, Number(opts.recent) || 1); enough = all => all.reduce((n, m) => n + (m.role === 'user' ? 1 : 0), 0) > want; }
        if (opts.mode === 'new') { const anchor = checkpoint.userTurnId || checkpoint.leafTurnId; enough = all => all.some(m => m.turnId === anchor); }
        let fetched, partial = false;
        try {
            fetched = await fetchMessages(route.chatId, { enough, signal, onProgress: (n, pages) => ui.progress(`메시지 ${num(n)}개 받는 중… (${pages}페이지 · ${Math.round((Date.now() - started) / 1000)}초)`) });
        } catch (error) {
            // A cut-off history can serve 「전체」 and 「최근」. 「구간」 needs real numbers and 「새 턴만」 its saved point,
            // which a cut-off history never reached, so those show the real error instead.
            if (signal.aborted) throw error;
            if (await ui.confirmScreen?.(error.message)) {
                if (opts.mode !== 'all' && opts.mode !== 'recent') opts = { ...opts, mode:'all' };
                opts = { ...opts, alts:false };
                ui.screenMode?.(opts.mode);
                fetched = await CME.readScreen({ signal, chatId:route.chatId, progress:ui.progress });
                partial = true;
            } else {
            if (!error.partial?.length || opts.mode === 'range' || opts.mode === 'new') throw error;
            if (!(await ui.confirmPartial(error.message, error.partial.length))) throw error;
            fetched = { messages: error.partial, complete: false };
            partial = true;
            }
        }
        if (!fetched.messages.length) throw new Error('받은 메시지가 없어요.');
        const { chat, chatError } = await fetchChat(route.chatId, opts, signal);
        const picked = pickTurns(opts.mode, opts, fetched, checkpoint || {});
        const screenSource = fetched.screen;
        fetched = null; // the raw pages are no longer needed; on a very long chat this frees the text before cleaning copies it
        if (picked.lost) throw new Error(picked.note[0]);
        if (!picked.turns.length) throw new Error(opts.mode === 'new' ? '저장한 뒤로 새로 생긴 턴이 없어요.' : '고른 범위에 해당하는 턴이 없어요.');
        const notes = [...picked.note];
        if (partial) notes.push(screenSource ? '화면에서 읽은 기록이에요. 전체·최근만 가능하고 새 턴만·구간·리롤 버전은 사용할 수 없어요. 턴 번호는 이번 파일 안의 순서예요.' : '중간에 받기가 끊겨서 받은 데까지만 저장했어요.');
        if (chatError) notes.push(`작품 정보를 받지 못했어요: ${chatError}`);
        let memories = [];
        if (opts.memory) {
            ui.progress('장기기억을 받는 중…');
            try {
                const got = await fetchMemories(route.chatId, { signal });
                memories = got.memories;
                if (got.failure || got.total > memories.length) notes.push(`장기기억 ${num(got.total)}개 중 ${num(memories.length)}개만 받았어요.${got.failure ? ` (${got.failure})` : ''}`);
            } catch (error) {
                if (signal.aborted) throw error;
                notes.push(`장기기억을 받지 못했어요: ${error.message}`);
            }
        }
        const ctx = { opts, now, chat, notes, memories, chatId: route.chatId, storyId: route.storyId, pageTitle: title };
        ui.progress(`파일을 만드는 중… (${num(picked.turns.length)}턴)`);
        await wait(30, signal);
        // Cleaned 500 turns at a time with pauses in between, so the page stays responsive on huge chats.
        const clean = cleaningFor(opts);
        let removed = 0;
        for (let i = 0; i < picked.turns.length; i += 500) { await breathe(signal); removed += cleanTurns(picked.turns.slice(i, i + 500), clean, { alts: Boolean(opts.alts) }); }
        const exportTurns = CME.filterKeywords(picked.turns, clean);
        const files = await bundle(await makeFiles(ctx, exportTurns, signal), ctx);
        await io.download(files, signal);
        // Notes below this line only go to the dialog: the files are already made.
        if (picked.newest && !partial) setCheckpoint(route.chatId, picked.turns);
        else notes.push('이번 저장은 「새 턴만」의 기준 지점을 바꾸지 않았어요.');
        // Several downloads in a row may wait behind the browser's "download multiple files" question.
        if (files.length > 1) notes.unshift(`파일 ${files.length}개를 차례로 내려받아요. 브라우저가 여러 파일 받기를 물으면 허용해 주세요.`);
        const total = picked.turns.filter(t => !t.prologue).length;
        if (opts.format === 'html' && total > HTML_PART && !(opts.split && opts.splitSize <= HTML_PART)) notes.push(`HTML은 한 파일이 너무 길면 브라우저가 끝부분을 보여 주지 못해서 ${num(HTML_PART)}턴씩 나눠 저장했어요.`);
        return `${num(total)}턴을 파일 ${files.length}개로 저장했어요.${memories.length ? ` 장기기억 ${num(memories.length)}개도 넣었어요.` : ''}${removed > 0 ? ` 청소로 ${num(removed)}자를 덜어냈어요.` : ''}${notes.length ? `\n${notes.join('\n')}` : ''}`;
    }

    // ---------- dialog (built only when opened) ----------
    const loadOpts = () => {
        let v = null;
        try { v = GM_getValue('options', null); } catch {}
        const o = { ...DEFAULTS, ...(v || {}), clean: { ...DEFAULTS.clean, ...(v?.clean || {}) } };
        // 1.0/1.1 kept several formats and a reroll mode; keep the first chosen format and the reroll choice.
        if (!v?.format && v?.formats) o.format = Object.keys(FORMATS).find(k => v.formats[k]) || DEFAULTS.format;
        if (v?.rerolls && v.alts === undefined) o.alts = v.rerolls === 'all';
        if (!FORMATS[o.format]) o.format = DEFAULTS.format;
        // 1.3 changed two defaults that 1.2 stored with every save: ZIP now starts off (kept on for anyone who splits
        // files, so they do not get a burst of downloads) and lore blocks are now removed (1.2 started that rule off,
        // so a stored "off" is almost always just the old default). Image links follow the image cleaning rules.
        if (v && !v.rev) {
            if (!v.split) o.zip = DEFAULTS.zip;
            o.clean.loreOoc = DEFAULTS.clean.loreOoc;
        }
        o.rev = 2;
        delete o.formats; delete o.rerolls; delete o.showButton; delete o.images;
        return CME.migrateKeywords(o);
    };
    const saveOpts = o => { try { GM_setValue('options', o); } catch {} };

    // Material Symbols (Outlined, weight 400), the same family as Crack's own panel icons.
    const ICONS = {
        arrow: 'M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200Z',
        tray: 'M240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z',
        error: 'M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
        article: 'M280-280h280v-80H280v80Zm0-160h400v-80H280v80Zm0-160h400v-80H280v80Zm-80 480q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z',
        clean: 'M120-40v-280q0-83 58.5-141.5T320-520h40v-320q0-33 23.5-56.5T440-920h80q33 0 56.5 23.5T600-840v320h40q83 0 141.5 58.5T840-320v280H120Zm80-80h80v-120q0-17 11.5-28.5T320-280q17 0 28.5 11.5T360-240v120h80v-120q0-17 11.5-28.5T480-280q17 0 28.5 11.5T520-240v120h80v-120q0-17 11.5-28.5T640-280q17 0 28.5 11.5T680-240v120h80v-200q0-50-35-85t-85-35H320q-50 0-85 35t-35 85v200Zm320-400v-320h-80v320h80Zm0 0h-80 80Z',
        tune: 'M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-160v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-160v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z',
        hideImage: 'm840-234-80-80v-446H314l-80-80h526q33 0 56.5 23.5T840-760v526ZM792-56l-64-64H200q-33 0-56.5-23.5T120-200v-528l-64-64 56-56 736 736-56 56ZM240-280l120-160 90 120 33-44-283-283v447h447l-80-80H240Zm297-257ZM424-424Z',
        linkOff: 'm770-302-60-62q40-11 65-42.5t25-73.5q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 57-29.5 105T770-302ZM634-440l-80-80h86v80h-6ZM792-56 56-792l56-56 736 736-56 56ZM440-280H280q-83 0-141.5-58.5T80-480q0-69 42-123t108-71l74 74h-24q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h65l79 80H320Z',
        codeOff: 'M791-55 280-566l-87 87 183 183-56 56L80-480l143-143L55-791l57-57 736 736-57 57Zm-54-282-57-57 87-87-183-183 56-56 240 240-143 143Z',
        lineSpacing: 'M240-160 80-320l56-56 64 62v-332l-64 62-56-56 160-160 160 160-56 56-64-62v332l64-62 56 56-160 160Zm240-40v-80h400v80H480Zm0-240v-80h400v80H480Zm0-240v-80h400v80H480Z',
        formatClear: 'm528-546-93-93-121-121h486v120H568l-40 94ZM792-56 460-388l-80 188H249l119-280L56-792l56-56 736 736-56 56Z',
        code: 'M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z',
        notesOff: 'M280-400q-17 0-28.5-11.5T240-440q0-17 11.5-28.5T280-480q17 0 28.5 11.5T320-440q0 17-11.5 28.5T280-400Zm548 154-74-74h46v-480H274l-80-80h606q33 0 56.5 23.5T880-800v480q0 26-14.5 45.5T828-246ZM554-520l-80-80h246v80H554ZM820-28 606-240H240L80-80v-688l-52-52 56-56L876-84l-56 56ZM344-504Zm170-56Zm-234 40q-17 0-28.5-11.5T240-560q0-17 11.5-28.5T280-600q17 0 28.5 11.5T320-560q0 17-11.5 28.5T280-520Zm154-120-34-34v-46h320v80H434Zm-274-48v413l46-45h322L160-688Z',
        book: 'M560-564v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-600q-38 0-73 9.5T560-564Zm0 220v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-380q-38 0-73 9t-67 27Zm0-110v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-490q-38 0-73 9.5T560-454ZM260-320q47 0 91.5 10.5T440-278v-394q-41-24-87-36t-93-12q-36 0-71.5 7T120-692v396q35-12 69.5-18t70.5-6Zm260 42q44-21 88.5-31.5T700-320q36 0 70.5 6t69.5 18v-396q-33-14-68.5-21t-71.5-7q-47 0-93 12t-87 36v394Zm-40 118q-48-38-104-59t-116-21q-42 0-82.5 11T100-198q-21 11-40.5-1T40-234v-482q0-11 5.5-21T62-752q46-24 96-36t102-12q58 0 113.5 15T480-740q51-30 106.5-45T700-800q52 0 102 12t96 36q11 5 16.5 15t5.5 21v482q0 23-19.5 35t-40.5 1q-37-20-77.5-31T700-240q-60 0-116 21t-104 59ZM280-494Z',
        info: 'M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
        memory: 'M390-120q-51 0-88-35.5T260-241q-60-8-100-53t-40-106q0-21 5.5-41.5T142-480q-11-18-16.5-38t-5.5-42q0-61 40-105.5t99-52.5q3-51 41-86.5t90-35.5q26 0 48.5 10t41.5 27q18-17 41-27t49-10q52 0 89.5 35t40.5 86q59 8 99.5 53T840-560q0 22-5.5 42T818-480q11 18 16.5 38.5T840-400q0 62-40.5 106.5T699-241q-5 50-41.5 85.5T570-120q-25 0-48.5-9.5T480-156q-19 17-42 26.5t-48 9.5Zm130-590v460q0 21 14.5 35.5T570-200q20 0 34.5-16t15.5-36q-21-8-38.5-21.5T550-306q-10-14-7.5-30t16.5-26q14-10 30-7.5t26 16.5q11 16 28 24.5t37 8.5q33 0 56.5-23.5T760-400q0-5-.5-10t-2.5-10q-17 10-36.5 15t-40.5 5q-17 0-28.5-11.5T640-440q0-17 11.5-28.5T680-480q33 0 56.5-23.5T760-560q0-33-23.5-56T680-640q-11 18-28.5 31.5T613-587q-16 6-31-1t-20-23q-5-16 1.5-31t22.5-20q15-5 24.5-18t9.5-30q0-21-14.5-35.5T570-760q-21 0-35.5 14.5T520-710Zm-80 460v-460q0-21-14.5-35.5T390-760q-21 0-35.5 14.5T340-710q0 16 9 29.5t24 18.5q16 5 23 20t2 31q-6 16-21 23t-31 1q-21-8-38.5-21.5T279-640q-32 1-55.5 24.5T200-560q0 33 23.5 56.5T280-480q17 0 28.5 11.5T320-440q0 17-11.5 28.5T280-400q-21 0-40.5-5T203-420q-2 5-2.5 10t-.5 10q0 33 23.5 56.5T280-320q20 0 37-8.5t28-24.5q10-14 26-16.5t30 7.5q14 10 16.5 26t-7.5 30q-14 19-32 33t-39 22q1 20 16 35.5t35 15.5q21 0 35.5-14.5T440-250Zm40-230Z',
        chart: 'M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z',
        layers: 'M480-118 120-398l66-50 294 228 294-228 66 50-360 280Zm0-202L120-600l360-280 360 280-360 280Zm0-280Zm0 178 230-178-230-178-230 178 230 178Z',
        split: 'M200-520q-33 0-56.5-23.5T120-600v-160q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v160q0 33-23.5 56.5T760-520H200Zm0-80h560v-160H200v160Zm0 480q-33 0-56.5-23.5T120-200v-160q0-33 23.5-56.5T200-440h560q33 0 56.5 23.5T840-360v160q0 33-23.5 56.5T760-120H200Zm0-80h560v-160H200v160Zm0-400v-160 160Zm0 400v-160 160Z',
        zip: 'M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z',
    };
    const svg = (name, cls) => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 -960 960 960" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

    // One glass layer only (the dialog). The scrim is a plain tint, sections are translucent fills without blur, and
    // every animation moves only transform/opacity (only the one-shot check mark draws a stroke). Nothing keeps running
    // once the dialog has opened. Crack's own
    // theme variables (set on body[data-theme]) pass into the shadow root; the values after the commas are fallbacks.
    const UI_CSS = `
:host{all:initial}
.v{
 --ink:var(--text_primary,#1a1918);--sub:var(--text_secondary,#61605a);--mute:var(--text_tertiary,#85837d);
 --key:var(--surface_primary,#0d0d0c);--on-key:var(--bg_screen,#fff);
 --glass:rgba(250,250,248,.74);--solid:#f7f7f5;--sheen:rgba(255,255,255,.6);--rim:rgba(0,0,0,.07);
 --spec:linear-gradient(165deg,rgba(255,255,255,.95),rgba(255,255,255,.3) 26%,rgba(255,255,255,0) 52%,rgba(255,255,255,.45));
 --fill:rgba(255,255,255,.58);--line:rgba(13,13,12,.075);--well:rgba(13,13,12,.06);
 --thumb:#fff;--thumb-sh:0 1px 1px rgba(0,0,0,.04),0 3px 10px rgba(0,0,0,.10);
 --track:rgba(13,13,12,.15);--knob:#fff;--knob-on:#fff;--knob-sh:0 1px 2px rgba(0,0,0,.14),0 3px 8px rgba(0,0,0,.10);
 --scrim:rgba(12,12,11,.32);--shadow:0 30px 70px -18px rgba(0,0,0,.35),0 6px 18px rgba(0,0,0,.08);
 --err:#cf3a22;--err-soft:rgba(207,58,34,.09);
 font-family:Pretendard,"Pretendard Variable","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;line-height:1.45;color:var(--ink);
 -webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;color-scheme:light}
.v[data-theme=dark]{
 --ink:var(--text_primary,#f0efeb);--sub:var(--text_secondary,#a8a69f);--mute:var(--text_tertiary,#85837d);
 --key:var(--surface_primary,#fcfcfa);--on-key:var(--bg_screen,#141413);
 --glass:rgba(30,30,28,.68);--solid:#1d1d1b;--sheen:rgba(255,255,255,.06);--rim:rgba(0,0,0,.55);
 --spec:linear-gradient(165deg,rgba(255,255,255,.30),rgba(255,255,255,.07) 28%,rgba(255,255,255,0) 55%,rgba(255,255,255,.12));
 --fill:rgba(255,255,255,.045);--line:rgba(255,255,255,.075);--well:rgba(0,0,0,.30);
 --thumb:rgba(255,255,255,.16);--thumb-sh:inset 0 1px 0 rgba(255,255,255,.14),0 3px 10px rgba(0,0,0,.35);
 --track:rgba(255,255,255,.17);--knob:#dcdbd6;--knob-on:#141413;--knob-sh:0 2px 6px rgba(0,0,0,.4);
 --scrim:rgba(0,0,0,.5);--shadow:0 30px 80px -16px rgba(0,0,0,.75),0 6px 18px rgba(0,0,0,.35);
 --err:#ff7d66;--err-soft:rgba(255,125,102,.12);color-scheme:dark}
.v *,.v *::before,.v *::after{box-sizing:border-box}
.scrim{position:fixed;inset:0;z-index:2147483600;background:var(--scrim);animation:fade .22s ease-out backwards}
.wrap{position:fixed;inset:0;z-index:2147483601;display:grid;place-items:center;padding:16px}
.dlg{position:relative;width:min(460px,100%);height:min(620px,calc(100vh - 32px));height:min(620px,calc(100dvh - 32px));display:flex;flex-direction:column;overflow:hidden;border-radius:28px;
 background:linear-gradient(180deg,var(--sheen),transparent 150px),var(--glass);
 -webkit-backdrop-filter:blur(24px) saturate(1.7);backdrop-filter:blur(24px) saturate(1.7);
 box-shadow:var(--shadow),0 0 0 1px var(--rim);animation:rise .34s cubic-bezier(.2,.9,.3,1.06) backwards}
.dlg::before{content:"";position:absolute;inset:0;z-index:3;border-radius:inherit;padding:1px;background:var(--spec);pointer-events:none;
 -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.dlg{background:var(--solid)}}
@media (prefers-reduced-transparency:reduce){.dlg{background:var(--solid);-webkit-backdrop-filter:none;backdrop-filter:none}}
.v.out .scrim{opacity:0;transition:opacity .18s ease}
.v.out .dlg{opacity:0;transform:translateY(10px) scale(.97);transition:opacity .18s ease,transform .18s ease}

.hd{display:flex;align-items:center;gap:12px;padding:20px 20px 14px}
/* Header icon = the save state: the arrow drops in on open, keeps falling into the tray while saving (with a ring
   running around the tile), turns into a drawn check when done, and shakes into an alert on errors. */
.ic{position:relative;flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--fill);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink)}
.ic::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:0 0 0 2px var(--key);opacity:0;pointer-events:none}
.ic>.glyph,.ic>.arrow{grid-area:1/1}
.glyph{display:block;width:22px;height:22px;overflow:visible}
.glyph path{transform-box:fill-box;transform-origin:center;transition:opacity .2s,transform .3s cubic-bezier(.3,1.4,.5,1)}
.glyph .tray,.arrow,.glyph .bad{fill:currentColor}
/* The arrow and the ring move whole boxes, not SVG geometry, so the compositor runs them while saving (an animated
   SVG shape would re-layout and repaint Crack's whole page every frame). */
.arrow{transform-origin:50% 41.7%;transition:opacity .2s,transform .3s cubic-bezier(.3,1.4,.5,1);animation:drop .55s cubic-bezier(.3,1.5,.5,1) .15s backwards}
.glyph .ok{fill:none;stroke:currentColor;stroke-width:96;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:100;stroke-dashoffset:100;opacity:0}
.glyph .bad{opacity:0;transform:scale(.6)}
.ring{position:absolute;inset:-4px;border-radius:16px;padding:2px;overflow:hidden;opacity:0;transition:opacity .25s;pointer-events:none;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.ring::before{content:"";position:absolute;inset:-50%;background:conic-gradient(var(--key) 0 .24turn,transparent 0)}
.dlg[data-state=busy] .ring{opacity:1}
.dlg[data-state=busy] .ring::before{animation:orbit 1.3s linear infinite}
.dlg[data-state=busy] .arrow{animation:fall 1.05s cubic-bezier(.5,0,.4,1) infinite}
.dlg[data-state=done] .arrow,.dlg[data-state=done] .glyph .tray,.dlg[data-state=error] .arrow,.dlg[data-state=error] .glyph .tray{opacity:0;transform:scale(.6)}
.dlg[data-state=done] .glyph .ok{opacity:1;animation:draw .5s .08s cubic-bezier(.6,0,.2,1) forwards}
.dlg[data-state=done] .ic::after{animation:pulse .75s ease-out}
.dlg[data-state=error] .glyph .bad{opacity:1;transform:none}
.dlg[data-state=error] .ic{color:var(--err);animation:shake .45s ease}
.ttl{min-width:0}
.ttl h2{margin:0;font-size:19px;font-weight:700;letter-spacing:-.2px;line-height:1.3}
.ttl p{margin:2px 0 0;font-size:12px;font-weight:500;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.tabbar{--i:0;position:relative;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));margin:0 20px;border-bottom:1px solid var(--line)}
.tabbar .thumb{position:absolute;left:0;bottom:-1px;height:2px;width:calc(100% / var(--n));border-radius:2px;background:var(--key);transform:translateX(calc(var(--i) * 100%));transition:transform .34s cubic-bezier(.3,1.2,.45,1)}
.tabbar label{position:relative;height:42px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:14px;font-weight:600;color:var(--mute);cursor:pointer;user-select:none;transition:color .2s}
.tabbar .ti{flex:none;width:18px;height:18px;fill:currentColor}
.tabbar label.on .ti{animation:pop .45s cubic-bezier(.3,1.6,.5,1)}
.tabbar label.on[data-k=clean] .ti{transform-origin:50% 90%;animation:sweep .6s ease}
.tabbar label.on{color:var(--ink)}
.tabbar input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
/* Focus rings are drawn on a box right after the (hidden) radio, so they work without :has(). */
.tabbar .fx,.seg .fx{position:absolute;inset:0;border-radius:inherit;pointer-events:none}
.tabbar input:focus-visible+.fx{outline:2px solid var(--key);outline-offset:-5px;border-radius:10px}

/* Fixed-height dialog; tabs share one grid cell and each scrolls on its own (only 청소 is long enough to). The body
   clips sideways, so a tab sliding in never adds a horizontal scrollbar for a frame. */
.bd{flex:1;min-height:0;display:grid;overflow:hidden}
.pane{grid-area:1/1;min-width:0;min-height:0;overflow:hidden auto;padding:16px 16px 6px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--track) transparent;visibility:hidden;pointer-events:none}
.dlg[data-tab=main] [data-pane=main],.dlg[data-tab=clean] [data-pane=clean],.dlg[data-tab=more] [data-pane=more]{visibility:visible;pointer-events:auto;animation:pane .28s cubic-bezier(.2,.8,.2,1) backwards}
.sec{margin:0 0 16px}
.sec>h3{margin:0 6px 7px;font-size:12px;font-weight:600;color:var(--mute);letter-spacing:.2px}
.hint{margin:8px 6px 0;font-size:12.5px;font-weight:500;color:var(--sub)}

.seg{--i:0;position:relative;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));padding:3px;border-radius:14px;background:var(--well)}
.seg .thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px) / var(--n));border-radius:11px;background:var(--thumb);box-shadow:var(--thumb-sh);
 transform:translateX(calc(var(--i) * 100%));transition:transform .34s cubic-bezier(.3,1.3,.45,1)}
.seg:active .thumb{transform:translateX(calc(var(--i) * 100%)) scale(.96)}
.seg label{position:relative;z-index:1;min-width:0;height:36px;display:grid;place-items:center;padding:0 4px;border-radius:11px;font-size:13px;font-weight:600;color:var(--sub);white-space:nowrap;cursor:pointer;user-select:none;transition:color .2s}
.seg label.on{color:var(--ink)}
.seg label.off{opacity:.35;cursor:not-allowed}
.seg input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.seg input:focus-visible+.fx{outline:2px solid var(--key);outline-offset:-2px}
.seg.sm label{height:30px;font-size:12px}
.seg.sm{border-radius:12px}.seg.sm .thumb{border-radius:9px}

.extra{display:grid;align-items:center;min-height:38px;margin-top:8px;padding:0 6px}
.extra>*{grid-area:1/1;display:none;margin:0;align-items:center;gap:8px;font-size:13.5px;font-weight:500}
.extra>p{font-size:12.5px;color:var(--sub)}
.dlg[data-mode=all] [data-for=all],.dlg[data-mode=new] [data-for=new],.dlg[data-mode=recent] [data-for=recent],.dlg[data-mode=range] [data-for=range]{display:flex;animation:in .22s ease-out backwards}

.num{width:70px;height:34px;padding:0 8px;border:0;border-radius:10px;background:var(--well);color:var(--ink);font:inherit;font-size:14px;font-weight:600;text-align:center;box-shadow:inset 0 0 0 1px var(--line);transition:box-shadow .15s}
.num:focus{outline:none;box-shadow:inset 0 0 0 1.5px var(--key)}

.card{border-radius:16px;background:var(--fill);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.card>*{position:relative}
.card>*+*::before{content:"";position:absolute;left:56px;right:0;top:0;height:1px;background:var(--line);pointer-events:none}
/* Row icons: dimmed while the row is off, full colour with a small spring when it is on. */
.ri{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--well);color:var(--mute);transition:color .25s}
.ri svg{width:18px;height:18px;fill:currentColor;transform:scale(.86);transition:transform .4s cubic-bezier(.3,1.7,.5,1)}
.row.lit .ri,.row.fence .ri{color:var(--ink)}
.row.lit .ri svg,.row.fence .ri svg{transform:none}
.row{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 14px;font-size:14px;font-weight:500;cursor:pointer;user-select:none}
.row .t{flex:1;min-width:0}
.row .t small{display:block;margin-top:1px;font-size:12px;font-weight:500;color:var(--mute)}
.row.split{cursor:default}
.row.split .lbl{flex:1;display:flex;align-items:center;gap:12px;align-self:stretch;cursor:pointer}
.row.fence{flex-wrap:wrap;cursor:default;row-gap:8px}
.row.fence .seg{flex:1 1 calc(100% - 42px);margin-left:42px}

.sw-in{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.sw{flex:none;position:relative;width:44px;height:26px;border-radius:13px;background:var(--track);transition:background-color .2s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:11px;background:var(--knob);box-shadow:var(--knob-sh);transition:transform .3s cubic-bezier(.3,1.35,.5,1),width .16s ease}
.sw-in:checked+.sw{background:var(--key)}
.sw-in:checked+.sw::after{transform:translateX(18px);background:var(--knob-on)}
.row:active .sw::after,.lbl:active .sw::after{width:27px}
.row:active .sw-in:checked+.sw::after,.lbl:active .sw-in:checked+.sw::after{transform:translateX(13px)}
.sw-in:focus-visible+.sw{outline:2px solid var(--key);outline-offset:2px}

[data-clean]{transition:opacity .2s}
[data-clean].dim{opacity:.45}

/* Clearing saved history: red row, the bin lid tips open on hover, opens wide when armed, and snaps shut when done. */
.row.danger{width:100%;border:0;background:none;font:inherit;text-align:left;color:var(--err);transition:background-color .2s}
.row.danger .ri{background:var(--err-soft);color:var(--err)}
.row.danger .ri svg{transform:none;overflow:visible}
.row.danger .t small{color:var(--err);opacity:.72}
.row.danger[data-armed]{background:var(--err-soft)}
.row.danger[data-armed] .ri{animation:nudge .4s ease}
.row.danger[data-done] .ri{animation:pop .45s cubic-bezier(.3,1.6,.5,1)}
.row.danger:disabled{cursor:default}
.row.danger:disabled .t,.row.danger:disabled .ri{opacity:.5}
.row.danger[data-done]:disabled .ri{opacity:1}
.row.danger:focus-visible{outline:2px solid var(--err);outline-offset:-2px;border-radius:16px}
.lid{transform-box:fill-box;transform-origin:100% 100%;transition:transform .32s cubic-bezier(.3,1.5,.5,1)}
@media (hover:hover){.row.danger:not(:disabled):hover .lid{transform:rotate(-10deg)}}
.row.danger[data-armed] .lid,.row.danger[data-armed]:hover .lid{transform:rotate(-24deg)}
.hint.warn{color:var(--err);opacity:.85}

.ft{position:relative;display:flex;align-items:center;gap:8px;padding:12px 16px 16px}
.ft::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:var(--line)}
.bar{position:absolute;left:0;right:0;top:0;height:2px;overflow:hidden;opacity:0;transition:opacity .2s}
.bar::before{content:"";position:absolute;top:0;bottom:0;left:0;width:35%;background:linear-gradient(90deg,transparent,var(--key),transparent);transform:translateX(-100%)}
.dlg[data-state=busy] .bar{opacity:1}
.dlg[data-state=busy] .bar::before{animation:run 1.1s cubic-bezier(.45,0,.2,1) infinite}
.dlg:focus{outline:none}
.msg{flex:1;min-width:0;max-height:54px;overflow:auto;overscroll-behavior:contain;font-size:12.5px;font-weight:500;color:var(--sub);white-space:pre-line;line-height:1.45}
.msg.err{color:var(--err)}
.btn{flex:none;height:46px;min-width:84px;padding:0 20px;border:0;border-radius:23px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:transform .14s ease,opacity .15s}
.btn.ghost{background:var(--fill);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.btn.key{background:var(--key);color:var(--on-key);box-shadow:0 8px 18px -8px rgba(0,0,0,.5)}
.btn:active{transform:scale(.96)}
.btn:disabled{opacity:.5;cursor:default;transform:none}
.btn:focus-visible{outline:2px solid var(--key);outline-offset:2px}

@keyframes fade{from{opacity:0}}
@keyframes rise{from{opacity:0;transform:translateY(16px) scale(.96)}}
@keyframes in{from{opacity:0;transform:translateY(-4px)}}
@keyframes pane{from{opacity:0;transform:translateX(var(--dx,0px))}}
@keyframes pop{0%{transform:scale(.7)}60%{transform:scale(1.14)}100%{transform:none}}
@keyframes sweep{0%,100%{transform:none}20%{transform:rotate(-16deg)}45%{transform:rotate(12deg)}70%{transform:rotate(-6deg)}}
@keyframes drop{from{opacity:0;transform:translateY(-6.9px)}}
@keyframes fall{0%{opacity:0;transform:translateY(-4.6px)}30%{opacity:1}70%{opacity:1;transform:translateY(.7px)}100%{opacity:0;transform:translateY(1.4px)}}
@keyframes orbit{to{transform:rotate(1turn)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pulse{from{opacity:.55;transform:scale(1)}to{opacity:0;transform:scale(1.5)}}
@keyframes shake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@keyframes run{to{transform:translateX(300%)}}
@keyframes nudge{25%{transform:rotate(-7deg)}50%{transform:rotate(5deg)}75%{transform:rotate(-2deg)}}
@media (max-width:480px){.wrap{padding:10px;align-items:end}.dlg{border-radius:26px;height:min(690px,calc(100dvh - 20px))}
 .ft{flex-wrap:wrap;justify-content:flex-end}.msg{flex-basis:100%;order:-1;max-height:72px}.msg:empty{display:none}}
@media (prefers-reduced-motion:reduce){.v *,.v *::before,.v *::after{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}`;

    const CLEAN_ROWS = [['imageMarkdown', '이미지 마크다운 제거', '', 'hideImage'], ['imageUrls', '이미지 URL 줄 제거', '', 'linkOff'], ['comments', 'HTML · 마크다운 주석 제거', '', 'codeOff'], ['blankLines', '빈 줄 정리', '', 'lineSpacing'], ['markdown', '마크다운 장식 제거', '굵게, 기울임 같은 표시만 빼고 내용은 남겨요', 'formatClear']];
    const INJECT_ROWS = [['wishInject', 'Wish 매니저 주입 블록 제거', 'Wish RP Manager · Core가 숨겨 넣은 기억·인지·시작 설정', 'notesOff'], ['loreOoc', '로어 주입 블록 제거', '&lt;ooc_lore_context&gt; 참고 블록', 'book']];
    const INCLUDE_ROWS = [['info', '작품 정보 · 유저노트', '', 'info'], ['memory', '장기기억', '요약 메모리의 장기 기억 전부', 'memory'], ['stats', '통계', '턴 수, 글자 수, 기간, 이미지 수', 'chart'], ['alts', '리롤된 다른 버전', '', 'layers']];
    const CLEAN_KEYS = ['on', 'imageMarkdown', 'imageUrls', 'comments', 'blankLines', 'markdown', 'wishInject', 'loreOoc'];
    const NEED_SAVE = '「전체」나 「최근」으로 저장하면 쓸 수 있어요';
    const tile = name => `<span class="ri">${svg(name)}</span>`;
    const sw = (name, label, sub = '', icon = '') => `<label class="row">${icon ? tile(icon) : ''}<span class="t">${label}${sub ? `<small>${sub}</small>` : ''}</span><input class="sw-in" type="checkbox" name="${name}"><span class="sw" aria-hidden="true"></span></label>`;
    // Segmented control (also the tab bar): items are [value, label, disabled, icon]; `group` names it for screen readers.
    const seg = (name, items, cls = '', kind = 'seg', group = '') => `<div class="${kind} ${cls}" style="--n:${items.length}" role="radiogroup"${group ? ` aria-label="${group}"` : ''}><i class="thumb" aria-hidden="true"></i>${items.map(([v, l, off, icon]) => `<label class="${off ? 'off' : ''}" data-k="${v}"${off ? ` title="${NEED_SAVE}"` : ''}><input type="radio" name="${name}" value="${v}"${off ? ' disabled' : ''}><i class="fx" aria-hidden="true"></i>${icon ? svg(icon, 'ti') : ''}${l}</label>`).join('')}</div>`;
    // Header glyph: tray + arrow (idle/busy), a drawn check (done), an alert (error), plus a ring that orbits while busy.
    const GLYPH = `<span class="ic"><svg class="glyph" viewBox="0 -960 960 960" aria-hidden="true"><path class="tray" d="${ICONS.tray}"/><path class="ok" d="M250-470 410-310 720-620" pathLength="100"/><path class="bad" d="${ICONS.error}"/></svg><i class="arrow"><svg class="glyph" viewBox="0 -960 960 960" aria-hidden="true"><path d="${ICONS.arrow}"/></svg></i><i class="ring" aria-hidden="true"></i></span>`;
    // Bin with a separate lid so the lid can tip open.
    const BIN = `<span class="ri"><svg viewBox="0 -960 960 960" aria-hidden="true"><path class="lid" d="M160-720v-80h200v-40h240v40h200v80H160Z"/><path d="M200-720h80v520h400v-520h80v520q0 33-23.5 56.5T680-120H280q-33 0-56.5-23.5T200-200v-520Zm160 440h80v-360h-80v360Zm160 0h80v-360h-80v360Z"/></svg></span>`;
    const ckLine = c => `${pageTitle() || '현재 채팅방'} · ${c ? `마지막 저장 ${fmtDate(new Date(c.at))}${Number.isFinite(c.no) ? ` · ${c.no}턴까지` : ''}` : '이어 저장할 기준 지점이 아직 없어요'}`;
    const newHint = c => c ? `마지막 저장${Number.isFinite(c.no) ? `(${c.no}턴)` : ''} 뒤로 새로 생긴 턴만 저장해요.` : '';

    function dialogHtml(ck, theme) {
        return `<style>${UI_CSS}</style><div class="v" data-theme="${theme}"><div class="scrim"></div><div class="wrap"><div class="dlg" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="t">
<div class="hd">${GLYPH}<div class="ttl"><h2 id="t">로그 저장</h2><p data-sub>${esc(ckLine(ck))}</p></div></div>
${seg('tab', [['main', '기본', false, 'article'], ['clean', '청소', false, 'clean'], ['more', '옵션', false, 'tune']], '', 'tabbar', '설정 탭')}
<div class="bd">
<div class="pane" data-pane="main">
<section class="sec"><h3>범위</h3>${seg('mode', [['all', '전체'], ['new', '새 턴만', !ck], ['recent', '최근'], ['range', '구간']], '', 'seg', '범위')}
<div class="extra"><p data-for="all">대화 처음부터 지금까지 모두 저장해요.</p><p data-for="new" data-new-hint>${esc(newHint(ck))}</p>
<div data-for="recent">최근 <input class="num" type="number" name="recent" min="1" inputmode="numeric" aria-label="최근 몇 턴"> 턴</div>
<div data-for="range"><input class="num" type="number" name="from" min="0" inputmode="numeric" aria-label="시작 턴"> 턴부터 <input class="num" type="number" name="to" min="0" inputmode="numeric" aria-label="끝 턴"> 턴까지</div></div></section>
<section class="sec"><h3>형식</h3>${seg('format', Object.entries(FORMATS).map(([k, f]) => [k, f.label]), '', 'seg', '형식')}<p class="hint" data-format-hint></p></section>
<section class="sec"><h3>로컬 데이터</h3><div class="card"><button type="button" class="row danger" data-act="wipe">${BIN}<span class="t"><span data-wipe-label></span><small data-wipe-sub></small></span></button></div>
<p class="hint warn">지금까지 저장한 턴 정보(마지막 저장 지점)를 모든 방에서 지워요. 지운 뒤에는 「새 턴만」을 못 쓰고, 처음부터 다시 저장해야 해요.</p></section>
</div>
<div class="pane" data-pane="clean">
<section class="sec"><div class="card">${sw('c-on', '메시지 청소', '저장할 때 아래 규칙으로 메시지를 정리해요', 'clean')}</div></section>
<section class="sec"><h3>기본 정리</h3><div class="card" data-clean>${CLEAN_ROWS.map(([k, l, s, i]) => sw(`c-${k}`, l, s, i)).join('')}
<div class="row fence">${tile('code')}<span class="t">코드블록</span>${seg('c-codeFence', [['keep', '유지'], ['fences', '경계만 삭제'], ['blocks', '블록 전체 삭제']], 'sm', 'seg', '코드블록')}</div></div></section>
<section class="sec"><h3>확장 프로그램 주입</h3><div class="card" data-clean>${INJECT_ROWS.map(([k, l, s, i]) => sw(`c-${k}`, l, s, i)).join('')}</div>
<p class="hint">RP에는 안 보이지만 메시지 원문에 숨어 있는 참고 블록이에요. 대화 내용은 건드리지 않아요.</p></section>
</div>
<div class="pane" data-pane="more">
<section class="sec"><h3>함께 넣기</h3><div class="card">${INCLUDE_ROWS.map(([k, l, s, i]) => sw(k, l, s, i)).join('')}</div></section>
<section class="sec"><h3>파일</h3><div class="card"><div class="row split">${tile('split')}<input class="num" type="number" name="splitSize" min="10" inputmode="numeric" aria-label="한 파일에 넣을 턴 수"><label class="lbl"><span class="t">턴마다 나눠 저장<small>큰 방은 나누면 파일이 가벼워요</small></span><input class="sw-in" type="checkbox" name="split"><span class="sw" aria-hidden="true"></span></label></div>${sw('zip', '여러 파일은 ZIP 하나로', '', 'zip')}</div></section>
</div>
</div>
<div class="ft"><i class="bar" aria-hidden="true"></i><div class="msg" aria-live="polite"></div><button type="button" class="btn ghost" data-act="close">닫기</button><button type="button" class="btn key" data-act="save">저장</button></div>
</div></div></div>`;
    }

    function toolsDialogHtml(ck,theme) {
        const original=dialogHtml(ck,theme);
        const extra='<section class="sec"><h3>제거 키워드</h3><div class="card">'+sw('c-removeKeywords','이 단어가 든 메시지 빼기','한 줄에 하나씩 적어 주세요. 저장본에서만 뺍니다.','clean')+'</div><textarea class="cme-keywords" name="keywordPatterns" aria-label="제거할 키워드" placeholder="한 줄에 하나"></textarea></section>';
        return original.replace('<div class="pane" data-pane="clean">','<div class="pane" data-pane="clean">'+extra).replace('</style>','</style><style data-cme-theme>'+CME.transcriptCss+'</style>');
    }
    let openDialog = null;
    function openSaver() {
        const external=CME.externalTranscript(); if(external){external.click();return;}
        if (openDialog?.isConnected) return; // a dialog removed by the page itself does not block a new one
        const route = routeChat();
        if (!route) { alert(`${APP.name}: 채팅방 안에서 눌러 주세요.`); return; }
        const opts = loadOpts(), ck = getCheckpoint(route.chatId);
        if (opts.mode === 'new' && !ck) opts.mode = 'all';
        const theme = document.body?.dataset.theme === 'dark' ? 'dark' : 'light';
        const prevFocus = document.activeElement;
        const host = document.createElement('div'), root = host.attachShadow({ mode: 'open' });
        host.id = 'cme-transcript-host';
        root.innerHTML = toolsDialogHtml(ck, theme);
        const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
        const v = $('.v'), dlg = $('.dlg'), msg = $('.msg'), saveBtn = $('[data-act="save"]'), closeBtn = $('[data-act="close"]'), wipeBtn = $('[data-act="wipe"]');
        const set = (name, value) => { for (const el of $$(`[name="${name}"]`)) { if (el.type === 'radio') el.checked = el.value === value; else if (el.type === 'checkbox') el.checked = Boolean(value); else el.value = value; } };
        // The sliding thumb follows the checked option; only a CSS variable and a class change.
        const syncSeg = s => { const labels = [...s.querySelectorAll('label')], i = Math.max(0, labels.findIndex(l => l.querySelector('input').checked)); s.style.setProperty('--i', i); labels.forEach((l, k) => l.classList.toggle('on', k === i)); };
        const hint = animate => { const el = $('[data-format-hint]'); el.textContent = FORMATS[($$('[name="format"]').find(x => x.checked) || {}).value]?.hint || ''; if (animate) el.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' }); };
        const syncClean = () => { const on = $('[name="c-on"]').checked; $$('[data-clean]').forEach(el => el.classList.toggle('dim', !on)); };
        // A row whose switch is on shows its icon at full colour (a class, so it works without :has()).
        const syncLit = () => $$('.row').forEach(r => r.classList.toggle('lit', Boolean(r.querySelector('.sw-in:checked'))));
        set('mode', opts.mode); set('recent', opts.recent); set('from', opts.from); set('to', opts.to); set('format', opts.format); set('splitSize', opts.splitSize);
        for (const k of ['info', 'memory', 'stats', 'alts', 'split', 'zip']) set(k, opts[k]);
        for (const k of CLEAN_KEYS) set(`c-${k}`, opts.clean[k]);
        set('c-codeFence', opts.clean.codeFence);
        set('c-removeKeywords', opts.clean.removeKeywords); set('keywordPatterns',opts.clean.keywordPatterns);
        set('tab', 'main');
        dlg.dataset.mode = opts.mode; dlg.dataset.tab = 'main';
        const TABS = ['main', 'clean', 'more'];
        $$('.seg, .tabbar').forEach(syncSeg); hint(false); syncClean(); syncLit();
        root.addEventListener('change', e => {
            const t = e.target, s = t.closest('.seg, .tabbar');
            if (s) syncSeg(s);
            if (t.name === 'tab') {
                // The new tab slides in from the side it sits on.
                dlg.style.setProperty('--dx', `${TABS.indexOf(t.value) > TABS.indexOf(dlg.dataset.tab) ? 18 : -18}px`);
                dlg.dataset.tab = t.value;
                return;
            }
            if (t.name === 'mode') dlg.dataset.mode = t.value;
            if (t.name === 'format') hint(true);
            if (t.name === 'c-on') syncClean();
            if (t.classList.contains('sw-in')) syncLit();
        });
        $('[name="splitSize"]').addEventListener('input', () => { set('split', true); syncLit(); });
        // Wheel outside a scrollable tab or message must not scroll the chat behind (that would also re-blur the glass).
        $('.wrap').addEventListener('wheel', e => { const box = e.target.closest('.pane, .msg'); if (!box || box.scrollHeight <= box.clientHeight) e.preventDefault(); }, { passive: false });
        const read = () => {
            const val = n => $(`[name="${n}"]`), radio = n => ($$(`[name="${n}"]`).find(el => el.checked) || {}).value;
            return {
                ...opts, mode: radio('mode') || 'all', recent: Number(val('recent').value) || 50, from: Number(val('from').value) || 0, to: Number(val('to').value) || 0, format: radio('format') || 'txt',
                info: val('info').checked, memory: val('memory').checked, stats: val('stats').checked, alts: val('alts').checked, split: val('split').checked, splitSize: Number(val('splitSize').value) || 1000, zip: val('zip').checked,
                clean: { ...Object.fromEntries(CLEAN_KEYS.map(k => [k, val(`c-${k}`).checked])), codeFence: radio('c-codeFence') || 'keep', removeKeywords: val('c-removeKeywords').checked, keywordPatterns: val('keywordPatterns').value },
            };
        };
        // 「새 턴만」 follows whether this room has a saved point.
        const syncSaved = c => {
            const label = $('.seg [data-k="new"]');
            label.classList.toggle('off', !c); label.querySelector('input').disabled = !c;
            if (c) label.removeAttribute('title'); else label.title = NEED_SAVE;
            if (!c && dlg.dataset.mode === 'new') { set('mode', 'all'); dlg.dataset.mode = 'all'; }
            $('[data-sub]').textContent = ckLine(c);
            $('[data-new-hint]').textContent = newHint(c);
            syncSeg(label.parentElement);
        };

        let controller = null, settle = 0, disarm = 0, armedAt = 0, saved = savedKeys().length;
        // A control that gets disabled while it has focus drops focus out of the dialog (and Escape with it).
        const keepFocus = el => { if (root.activeElement === el) dlg.focus({ preventScroll: true }); };
        // Header glyph state: busy while saving, done (check) or error (alert) for a moment, then back to idle.
        const setState = s => { clearTimeout(settle); if (s) dlg.dataset.state = s; else delete dlg.dataset.state; if (s === 'done' || s === 'error') settle = setTimeout(() => setState(''), 2600); };
        // Clearing saved history takes two taps: the first arms it (lid opens) for 3 s, the second clears. The second
        // click of a double-click (or a bouncing button) comes too soon to count.
        const wipeText = (label, sub) => { $('[data-wipe-label]').textContent = label; $('[data-wipe-sub]').textContent = sub; };
        const wipeIdle = () => { clearTimeout(disarm); delete wipeBtn.dataset.armed; delete wipeBtn.dataset.done; if (!saved) keepFocus(wipeBtn); wipeBtn.disabled = !saved; wipeText('저장 기록 비우기', saved ? `방 ${num(saved)}곳의 마지막 저장 지점` : '비울 기록이 없어요'); };
        const onWipe = () => {
            if (!('armed' in wipeBtn.dataset)) { wipeBtn.dataset.armed = ''; armedAt = performance.now(); wipeText('한 번 더 누르면 지워져요', '3초 안에 다시 누르세요'); disarm = setTimeout(wipeIdle, 3000); return; }
            if (performance.now() - armedAt < 500) return;
            clearTimeout(disarm);
            const n = wipeSaved();
            saved = savedKeys().length;
            keepFocus(wipeBtn);
            delete wipeBtn.dataset.armed; wipeBtn.dataset.done = ''; wipeBtn.disabled = true;
            wipeText('비웠어요', `방 ${num(n)}곳의 저장 기록을 지웠어요`);
            syncSaved(null);
        };
        wipeIdle();
        // The dialog belongs to the room it was opened in: going back to another chat closes it.
        const onRoute = () => { if (!controller && routeChat()?.chatId !== route.chatId) close(); };
        const close = () => {
            window.removeEventListener('popstate', onRoute);
            controller?.abort(); clearTimeout(settle); clearTimeout(disarm); openDialog = null;
            v.classList.add('out'); setTimeout(() => host.remove(), 200);
            if (prevFocus?.isConnected) prevFocus.focus?.({ preventScroll: true });
        };
        const ui = {
            confirmScreen: why => Promise.resolve(confirm(why+'\n\n화면에서 읽을까요? 전체·최근만 가능해요. 새 턴만·구간을 골랐다면 전체로 읽어요. 리롤 버전과 새 턴만의 기준점은 저장하지 않아요.')),
            screenMode: mode => {
                set('mode',mode);set('alts',false);dlg.dataset.mode=mode;
                for(const key of ['new','range']){const label=$('.seg [data-k="'+key+'"]');label.classList.add('off');label.querySelector('input').disabled=true;label.title='화면 읽기는 전체·최근만 가능해요.';}
                $('[name="alts"]').disabled=true;
                $('.extra').insertAdjacentHTML('beforeend','<p class="cme-screen-note">화면 읽기는 전체·최근만 가능해요. 새 턴만·구간·리롤 버전은 서버 기록이 필요해요.</p>');
                $$('.seg').forEach(syncSeg);
            },
            progress: text => { msg.classList.remove('err'); msg.textContent = text; },
            confirmPartial: (why, n) => Promise.resolve(confirm(`${why}\n\n받은 메시지 ${num(n)}개만이라도 저장할까요?`)),
        };
        // The backdrop closes the dialog only when the press also started there (a drag out of the dialog does not).
        let pressedBackdrop = false;
        root.addEventListener('pointerdown', e => { pressedBackdrop = e.target === $('.wrap'); });
        root.addEventListener('click', async e => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'wipe') { if (!controller) onWipe(); return; }
            if (act === 'close') { if (controller) controller.abort(); else close(); return; }
            if (e.target === $('.wrap') && pressedBackdrop && !controller) return close();
            if (act !== 'save' || controller) return;
            if (routeChat()?.chatId !== route.chatId) return close();
            const o = read();
            if (o.mode === 'range' && o.to < o.from) { msg.classList.add('err'); msg.textContent = '턴 범위를 다시 확인해 주세요.'; return; }
            saveOpts(o);
            controller = new AbortController();
            keepFocus(saveBtn);
            setState('busy'); saveBtn.disabled = true; saveBtn.textContent = '저장 중'; closeBtn.textContent = '취소';
            try {
                msg.classList.remove('err');
                msg.textContent = await runSave(o, ui, controller.signal, route);
                setState('done');
                // After a save, 「새 턴만」 and the history count are up to date without reopening the dialog.
                const c = getCheckpoint(route.chatId);
                if (c) syncSaved(c);
                saved = savedKeys().length; wipeIdle();
            } catch (error) {
                const cancelled = error.name === 'AbortError';
                msg.classList.add('err'); msg.textContent = cancelled ? '취소했어요.' : error.message;
                setState(cancelled ? '' : 'error');
            } finally {
                controller = null; saveBtn.disabled = false; saveBtn.textContent = '저장'; closeBtn.textContent = '닫기';
                if (routeChat()?.chatId !== route.chatId) return close(); // the page moved to another room while saving
                if (!root.activeElement || root.activeElement === dlg) saveBtn.focus({ preventScroll: true });
            }
        });
        // Escape closes; Tab stays inside the dialog (it is modal).
        root.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !controller) close();
            if (e.repeat && e.key === 'Enter' && e.target === wipeBtn) e.preventDefault(); // a held Enter is not a second tap
            if (e.key !== 'Tab') return;
            const first = $('[name="tab"]:checked'), last = saveBtn.disabled ? closeBtn : saveBtn, a = root.activeElement;
            if (e.shiftKey && (!a || a === first || a === dlg)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (!a || a === last)) { e.preventDefault(); first.focus(); }
        });
        document.body.appendChild(host);
        openDialog = host;
        window.addEventListener('popstate', onRoute);
        saveBtn.focus({ preventScroll: true });
    }

    // ---------- 「로그 저장」 row in Crack's right panel ----------
    // Material Symbols "download", the same family as Crack's own panel icons.
    const ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="var(--icon_secondary)" viewBox="0 -960 960 960" width="24" height="24" aria-hidden="true"><path d="${ICONS.arrow}${ICONS.tray}"/></svg>`;
    const ROW_MARK = 'data-crack-transcript';
    const isPanel = el => /\bborder-l\b/.test(el.className) && /\bbg-background\b/.test(el.className);
    function placeRow() {
        if (CME.externalTranscript()) return;
        if (!routeChat()) return;
        for (const panel of document.querySelectorAll('div.bg-background.border-l')) {
            if (!isPanel(panel) || panel.querySelector(`[${ROW_MARK}]`)) continue;
            // Last row of the 「채팅방 설정」 group, else the row of a known item.
            let anchor = null;
            const heading = [...panel.querySelectorAll('span,p')].find(e => !e.children.length && e.textContent.trim() === '채팅방 설정');
            for (let el = heading?.nextElementSibling; el && el.querySelector?.('[role="button"]'); el = el.nextElementSibling) anchor = el;
            if (!anchor) anchor = [...panel.querySelectorAll('[role="button"]')].find(r => /^(키보드 단축키|요약 메모리|유저 노트)$/.test(r.textContent.trim()))?.parentElement || null;
            const sample = anchor?.querySelector('[role="button"]');
            if (!sample) continue;
            const wrap = document.createElement('div');
            wrap.className = anchor.className;
            wrap.setAttribute(ROW_MARK, '');
            wrap.dataset.cmeOwned='';
            const row = document.createElement('div');
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            row.className = sample.className;
            const inner = document.createElement('span');
            inner.className = sample.firstElementChild?.className || 'flex space-x-2 items-center';
            inner.innerHTML = `${ICON}<span class="${esc(sample.querySelector('span span')?.className || 'whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium')}">로그 저장</span>`;
            row.appendChild(inner);
            // Our own handler only: the event stops here, so Crack's handlers never see a click on this row.
            row.addEventListener('click', e => { e.stopPropagation(); openSaver(); });
            row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openSaver(); } });
            wrap.appendChild(row);
            anchor.after(wrap);
        }
    }

    CME.state.transcript = { open:openSaver };
    if (hasDom) document.dispatchEvent(new Event('cme:companions'));
    // The Node test hook (module.exports) loads the script without wiring the page.
    if (hasDom && !(typeof module === 'object' && module.exports)) {
        // The panel row needs no GM API, so it is placed even where the manager has no menu commands.
        if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('로그 저장', openSaver);
        // No observers or intervals: a click (opening the panel, moving to another room) may re-render the panel, so
        // the row is checked shortly after each click, plus a few times while the page first loads.
        let pending = 0;
        const soon = () => { if (!pending) pending = setTimeout(() => { pending = 0; placeRow(); }, 600); };
        document.addEventListener('click', soon, true);
        document.addEventListener('keyup', e => { if (e.ctrlKey || e.metaKey || e.altKey) soon(); }, true);
        window.addEventListener('popstate', soon);
        for (const ms of [600, 1900, 4600]) setTimeout(placeRow, ms);
    }

    // Test hook: Node, or a page that set window.__CT_TEST before loading (never set by the userscript itself).
    const hook = { net, io, runSave, api, fetchMessages, fetchChat, fetchMemories, buildThread, toTurns, numberTurns, pickTurns, computeStats, cleanContent, cleanTurns, cleaningFor, loadOpts, buildTxt, buildHtml, buildMd, buildJson, buildEpub, makeZip, crc32, makeFiles, bundle, routeChat, idTime, placeRow, openSaver, savedKeys, wipeSaved, DEFAULTS };
    if (typeof module === 'object' && module.exports) module.exports = hook;
    else if (hasDom && window.__CT_TEST) window.__CT_TEST = hook;
})();

}
function queueCompanions(){setTimeout(startCompanions,60);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',queueCompanions,{once:true});else queueCompanions();
})();
