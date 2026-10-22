// Рендер и события. Весь экран перерисовывается из состояния; события — через data-action.

import { t, getLang, setLang } from './i18n.js';
import { scoreFromTarget, isValidScore } from './scoring.js';
import * as S from './state.js';

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const storage = (() => {
    try {
        return window.localStorage;
    } catch {
        return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
})();
const LANG_KEY = 'pd-lang';
const THEME_KEY = 'pd-theme';

let session = null;
const view = {
    screen: 'setup', // 'setup' | 'game' | 'results' | 'settings'
    drafts: {}, // черновики счёта: ключ -> [x, y]
    setup: null,
    dialog: null, // { type, ... }
    toast: '',
    playersError: '',
};

// ---------- утилиты ----------

function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="icons.svg#fa-${name}"/></svg>`;
}

function btn(action, label, { iconName, cls = '', attrs = '', disabled = false } = {}) {
    return `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs} ${disabled ? 'disabled' : ''}>${
        iconName ? icon(iconName) : ''
    }${label ? `<span>${label}</span>` : ''}</button>`;
}

function segmented(action, options, value, disabledValues = []) {
    return `<div class="segmented">${options
        .map(
            ([v, label]) =>
                `<button type="button" class="seg ${v === value ? 'on' : ''}" data-action="${action}" data-value="${v}" ${
                    disabledValues.includes(v) ? 'disabled' : ''
                }>${label}</button>`,
        )
        .join('')}</div>`;
}

function stepper(action, value, label = value) {
    return `<div class="stepper">
        <button type="button" class="btn round" data-action="${action}" data-delta="-1" aria-label="−">${icon('minus')}</button>
        <span class="stepper-value">${label}</span>
        <button type="button" class="btn round" data-action="${action}" data-delta="1" aria-label="+">${icon('plus')}</button>
    </div>`;
}

function persist() {
    if (session) S.saveSession(storage, session);
}

function showToast(text) {
    view.toast = text;
    render();
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
        view.toast = '';
        render();
    }, 2500);
}

function unitName(id) {
    if (session.settings.mode === 'americano') return S.playerName(session, id);
    return S.pairName(session, session.pairs.find((p) => p.id === id));
}

function sideNames(match, side) {
    return match.sides[side].map((id) => S.playerName(session, id)).join(' + ');
}

// ---------- тема и язык ----------

function isDark() {
    const forced = document.documentElement.dataset.theme;
    if (forced) return forced === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark() ? '#0c1511' : '#1f6f4a');
}

function switches() {
    return `<div class="switches">
        <div class="switch-container">
            ${icon('sun')}<span>${t('themeLight')}</span>
            <label class="switch"><input type="checkbox" data-toggle="theme" ${isDark() ? 'checked' : ''} aria-label="${t('themeDark')}" /><span class="slider"></span></label>
            <span>${t('themeDark')}</span>${icon('moon')}
        </div>
        <div class="switch-container">
            <img class="flag" src="icons/flag-ru.svg" alt="" /><span>Русский</span>
            <label class="switch"><input type="checkbox" data-toggle="lang" ${getLang() === 'en' ? 'checked' : ''} aria-label="English" /><span class="slider"></span></label>
            <span>English</span><img class="flag" src="icons/flag-gb.svg" alt="" />
        </div>
    </div>`;
}

// ---------- настройка ----------

function defaultSetup() {
    const last = S.loadLast(storage);
    return {
        settings: { ...S.DEFAULT_SETTINGS, ...(last?.settings ?? {}), endRounds: null },
        names: [],
        pairs: [],
        pickFirst: null,
        nameInput: '',
        targetValue: last?.settings?.targetSum ?? 25,
        error: '',
        last,
    };
}

function renderSetup() {
    const su = view.setup;
    const st = su.settings;
    const isPairs = st.mode === 'pairs';
    const ws = isPairs && st.rotation === 'winnerstays';
    const paired = new Set(su.pairs.flat());
    const unpaired = su.names.filter((n) => !paired.has(n));
    const endRounds = st.endRounds ?? Math.max(S.defaultEndRounds(su.names.length, st.courts), 1);
    const circlesRounds = S.roundsForCircles(su.names.length, st.courts, st.endCircles);

    return `
    ${switches()}
    <section class="card">
        <h2>${t('mode')}</h2>
        ${segmented('set-mode', [['americano', t('americano')], ['pairs', t('fixedPairs')]], st.mode)}
        ${
            isPairs
                ? `<h3>${t('rotation')}</h3>
                   ${segmented(
                       'set-rotation',
                       [['roundrobin', t('roundRobin')], ['winnerstays', t('winnerStays')]],
                       st.rotation,
                       st.courts > 1 ? ['winnerstays'] : [],
                   )}
                   ${st.courts > 1 ? `<p class="note">${t('winnerStaysOneCourt')}</p>` : ''}`
                : ''
        }
        <div class="row-between">
            <h3>${t('courts')}</h3>
            ${stepper('set-courts', st.courts)}
        </div>
        ${
            ws
                ? `<div class="row-between">
                       <h3>${t('maxStreak')}</h3>
                       ${stepper('set-streak', st.maxStreak ?? 0, st.maxStreak ? st.maxStreak : t('off'))}
                   </div>`
                : ''
        }
        <h3>${t('scoring')}</h3>
        ${segmented('set-scoring', [['free', t('freeScore')], ['target', t('targetScore')]], st.targetSum ? 'target' : 'free')}
        ${
            st.targetSum
                ? `<div class="row-between">
                       <div class="chips">${[19, 25, 31, 32]
                           .map((v) => `<button type="button" class="chip ${v === st.targetSum ? 'on' : ''}" data-action="set-target" data-value="${v}">${v}</button>`)
                           .join('')}</div>
                       ${stepper('step-target', st.targetSum)}
                   </div>`
                : ''
        }
        ${
            isPairs
                ? ''
                : `<h3>${t('endOfGame')}</h3>
                   ${segmented('set-end', [['free', t('endFree')], ['rounds', t('endRounds')], ['circles', t('endCircles')]], st.endMode)}
                   ${
                       st.endMode === 'rounds'
                           ? `<div class="row-between"><h3>${t('roundsCount')}</h3>${stepper('step-end-rounds', endRounds)}</div>`
                           : ''
                   }
                   ${
                       st.endMode === 'circles'
                           ? `<div class="row-between"><h3>${t('circlesCount')}</h3>${stepper('step-end-circles', st.endCircles)}</div>
                              <p class="note">${t('circlesNote')}${circlesRounds ? ` ${t('circlesRounds', { n: circlesRounds })}` : ''}</p>`
                           : ''
                   }`
        }
    </section>

    <section class="card">
        <h2>${t('players')} <span class="muted">${su.names.length}</span></h2>
        <form class="add-row" data-form="add-name">
            <input type="text" id="name-input" data-input="name" value="${esc(su.nameInput)}" placeholder="${t('nickname')}" autocomplete="off" enterkeyhint="done" maxlength="24" />
            <button type="submit" class="btn round primary" aria-label="${t('add')}">${icon('plus')}</button>
        </form>
        ${
            su.names.length === 0 && su.last?.names?.length
                ? btn('use-last', t('sameAsLast'), { iconName: 'clock-rotate-left', cls: 'wide ghost' })
                : ''
        }
        <ul class="name-list">${su.names
            .map(
                (n) =>
                    `<li><span>${esc(n)}</span><button type="button" class="btn round ghost" data-action="remove-name" data-name="${esc(n)}" aria-label="${t('remove')}">${icon('xmark')}</button></li>`,
            )
            .join('')}</ul>
    </section>

    ${
        isPairs
            ? `<section class="card">
                <h2>${t('pairs')} <span class="muted">${su.pairs.length}</span></h2>
                ${
                    unpaired.length
                        ? `<p class="note">${t('pickPartner')}</p>
                           <div class="chips">${unpaired
                               .map(
                                   (n) =>
                                       `<button type="button" class="chip ${su.pickFirst === n ? 'on' : ''}" data-action="pick-partner" data-name="${esc(n)}">${esc(n)}</button>`,
                               )
                               .join('')}</div>
                           ${btn('random-pairs', t('randomPairs'), { iconName: 'shuffle', cls: 'wide ghost' })}`
                        : ''
                }
                <ul class="name-list">${su.pairs
                    .map(
                        ([a, b], i) =>
                            `<li><span>${esc(a)} + ${esc(b)}</span><button type="button" class="btn round ghost" data-action="unpair" data-index="${i}" aria-label="${t('remove')}">${icon('xmark')}</button></li>`,
                    )
                    .join('')}</ul>
            </section>`
            : ''
    }

    ${su.error ? `<p class="error">${icon('circle-exclamation')} ${su.error}</p>` : ''}
    ${btn('start', t('start'), { iconName: 'play', cls: 'primary wide big' })}
    `;
}

function addName() {
    const su = view.setup;
    const name = su.nameInput.trim();
    if (!name) return;
    if (su.names.some((n) => n.toLowerCase() === name.toLowerCase())) {
        su.error = t('nameTaken', { name });
        return;
    }
    su.names.push(name);
    su.nameInput = '';
    su.error = '';
}

function startSession() {
    const su = view.setup;
    const st = su.settings;
    let error = '';
    if (st.mode === 'americano') {
        if (su.names.length < 4) error = t('needPlayers');
    } else if (su.names.length % 2 === 1) error = t('oddPlayers');
    else if (su.pairs.length * 2 < su.names.length) error = t('unpaired');
    else if (su.pairs.length < 2) error = t('needPairs');
    if (error) {
        su.error = error;
        return;
    }
    session = S.createSession(st, su.names, su.pairs);
    S.saveLast(storage, session);
    view.screen = 'game';
    view.drafts = {};
    persist();
    window.scrollTo(0, 0);
}

// ---------- игра ----------

function scoreInput(key, target, match) {
    const draft = view.drafts[key];
    if (target) {
        const x = draft ? draft[0] : null;
        const cells = Array.from({ length: target + 1 }, (_, v) => v)
            .map((v) => `<button type="button" class="cell ${v === x ? 'on' : ''}" data-action="pick-target" data-key="${key}" data-value="${v}">${v}</button>`)
            .join('');
        const cols = Math.ceil(Math.sqrt(target + 1));
        return `<div class="score-display">${x === null ? '– : –' : `${x} : ${target - x}`}</div>
                <p class="note center">${t('pointsOf', { name: esc(sideNames(match, 0)) })}</p>
                <div class="target-grid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${cells}</div>`;
    }
    const [x, y] = draft ?? [0, 0];
    const side = (i, v) => `
        <div class="score-side">
            <button type="button" class="btn round big" data-action="score-step" data-key="${key}" data-side="${i}" data-delta="-1" aria-label="−">${icon('minus')}</button>
            <input type="number" inputmode="numeric" min="0" class="score-input" data-input="score" data-key="${key}" data-side="${i}" value="${v}" />
            <button type="button" class="btn round big" data-action="score-step" data-key="${key}" data-side="${i}" data-delta="1" aria-label="+">${icon('plus')}</button>
        </div>`;
    return `<div class="score-free">${side(0, x)}<span class="score-colon">:</span>${side(1, y)}</div>`;
}

function draftScore(key) {
    const d = view.drafts[key];
    if (!d) return null;
    const score = session.settings.targetSum ? scoreFromTarget(d[0], session.settings.targetSum) : d;
    if (!isValidScore(score)) return null;
    if (!session.settings.targetSum && score[0] === 0 && score[1] === 0) return null;
    return score;
}

function teamButton(match, mi, side) {
    const names = sideNames(match, side);
    if (match.score) return `<div class="team">${match.sides[side].map((id) => `<span>${esc(S.playerName(session, id))}</span>`).join('<span class="plus">+</span>')}</div>`;
    if (session.settings.mode === 'americano') {
        return `<div class="team">${match.sides[side]
            .map((id) => `<button type="button" class="name-btn" data-action="open-sub" data-match="${mi}" data-unit="${id}">${esc(S.playerName(session, id))}</button>`)
            .join('<span class="plus">+</span>')}</div>`;

    }
    return `<div class="team"><button type="button" class="name-btn" data-action="open-sub" data-match="${mi}" data-unit="${match.pairs[side]}">${esc(names)}</button></div>`;
}

function matchCard(match, mi, showCourt) {
    const key = `c${mi}`;
    return `
    <article class="card match ${match.score ? 'saved' : ''}">
        ${showCourt ? `<div class="court-label">${t('court', { n: match.court })}</div>` : ''}
        <div class="teams">
            ${teamButton(match, mi, 0)}
            <span class="vs">vs</span>
            ${teamButton(match, mi, 1)}
        </div>
        ${
            match.score
                ? `<div class="score-display">${match.score[0]} : ${match.score[1]}</div>
                   ${btn('open-edit', t('edit'), { iconName: 'pen', cls: 'ghost wide', attrs: `data-round="current" data-match="${mi}"` })}`
                : `${scoreInput(key, session.settings.targetSum, match)}
                   ${btn('save-score', t('save'), { iconName: 'check', cls: 'primary wide big', attrs: `data-key="${key}" data-match="${mi}"`, disabled: !draftScore(key) })}`
        }
    </article>`;
}

function hintLine() {
    const n = S.roundsToEqualHint(session);
    if (n === null) return '';
    return `<p class="hint">${n === 0 ? t('allEqual') : t('roundsToEqual', { n })}</p>`;
}

function wdl(r) {
    const part = (cls, v) => `<span class="${v ? cls : 'zero'}">${v}</span>`;
    return `<span class="wdl">${part('w', r.w)}-${part('d', r.d)}-${part('l', r.l)}</span>`;
}

function signed(n) {
    return n > 0 ? `+${n}` : String(n);
}

function renderTable(compact) {
    const rows = S.table(session);
    const nameHead = session.settings.mode === 'americano' ? t('player') : t('pair');
    const head = compact
        ? `<tr><th>#</th><th class="name">${nameHead}</th><th>${t('colMatches')}</th><th>${t('colWdl')}</th><th class="key">${t('colDiff')}</th></tr>`
        : `<tr><th>#</th><th class="name">${nameHead}</th><th>${t('colMatches')}</th><th>${t('colWdl')}</th><th>${t('colFor')}</th><th>${t('colAgainst')}</th><th class="key">${t('colDiff')}</th></tr>`;
    const body = rows
        .map(
            (r, i) => `<tr class="${r.active ? '' : 'inactive'}">
                <td>${i + 1}</td>
                <td class="name">${esc(r.name)}${r.active ? '' : ` <span class="muted">(${t('withdrawn')})</span>`}</td>
                <td>${r.matches}</td>
                <td>${wdl(r)}</td>
                ${compact ? '' : `<td>${r.gf}</td><td>${r.ga}</td>`}
                <td class="key">${signed(r.diff)}</td>
            </tr>`,
        )
        .join('');
    return `<div class="table-wrap"><table class="standings">${head}${body}</table></div>`;
}

function matchLine(m) {
    return `${esc(sideNames(m, 0))} <span class="vs">vs</span> ${esc(sideNames(m, 1))}`;
}

function renderGame() {
    const s = session;
    if (!s.current) {
        return `<section class="card">
            <p class="error">${icon('circle-exclamation')} ${s.settings.mode === 'americano' ? t('notEnoughPlayers') : t('notEnoughPairs')}</p>
            ${btn('go', t('playersAndCourts'), { iconName: 'users', cls: 'wide', attrs: 'data-screen="settings"' })}
            ${S.canUndo(s) ? btn('undo', t('undo'), { iconName: 'rotate-left', cls: 'ghost wide' }) : ''}
        </section>`;
    }
    const multi = s.settings.courts > 1 || s.current.matches.length > 1;
    const eff = S.effectiveCourts(s);
    const ws = S.isWinnerStays(s);
    const resting = S.restingIds(s);

    let upcoming = '';
    if (ws) {
        upcoming = resting.length
            ? `<section class="card"><h2>${icon('forward')} ${t('queue')}</h2><ol class="plain">${resting.map((id) => `<li>${esc(unitName(id))}</li>`).join('')}</ol></section>`
            : '';
    } else if (s.next) {
        upcoming = `<section class="card"><h2>${icon('forward')} ${t('nextUp')}</h2><ul class="plain">${s.next.matches
            .map((m) => `<li>${s.next.matches.length > 1 ? `<span class="muted">${t('court', { n: m.court })}:</span> ` : ''}${matchLine(m)}</li>`)
            .join('')}</ul></section>`;
    }
    const restingBlock =
        !ws && resting.length
            ? `<section class="card"><h2>${icon('mug-hot')} ${t('resting')}</h2><p>${resting.map((id) => esc(unitName(id))).join(', ')}</p></section>`
            : '';

    const target = S.targetRounds(s);
    return `
    <div class="round-head">
        <h2>${target ? t('roundOf', { n: s.rounds.length + 1, total: target }) : t('round', { n: s.rounds.length + 1 })}</h2>
        ${S.canUndo(s) ? btn('undo', t('undo'), { iconName: 'rotate-left', cls: 'ghost' }) : ''}
    </div>
    ${eff < s.settings.courts && !ws ? `<p class="note">${t('fewerCourts', { n: eff })}</p>` : ''}
    ${s.current.matches.map((m, i) => matchCard(m, i, multi)).join('')}
    ${restingBlock}
    ${upcoming}
    ${!ws && !s.next && target ? `<p class="note center">${icon('flag-checkered')} ${t('lastRound')}</p>` : ''}`;
}

// ---------- таблица и история ----------

function renderResults() {
    const s = session;
    const finished = S.isFinished(s);
    const champs = finished ? S.winners(s) : [];
    const history = s.rounds
        .map((r, ri) => ({ r, ri }))
        .reverse()
        .map(
            ({ r, ri }) => `<li>
                <div class="history-round">${t('round', { n: ri + 1 })}</div>
                ${r.matches
                    .map(
                        (m, mi) => `<div class="history-match">
                            <div>${r.matches.length > 1 ? `<span class="muted">${t('court', { n: m.court })}:</span> ` : ''}${matchLine(m)}</div>
                            <div class="history-score">${m.score[0]} : ${m.score[1]}
                                <button type="button" class="btn round ghost" data-action="open-edit" data-round="${ri}" data-match="${mi}" aria-label="${t('edit')}">${icon('pen')}</button>
                            </div>
                        </div>`,
                    )
                    .join('')}
            </li>`,
        )
        .join('');
    const banner = finished
        ? `<section class="card banner">
               <div class="banner-icon">${icon('trophy')}</div>
               <h2>${t('finished')}</h2>
               <p>${t(champs.length > 1 ? 'winnersAre' : 'winnerIs', { names: champs.map((r) => esc(r.name)).join(', ') })}</p>
           </section>`
        : '';
    return `
    ${banner}
    <section class="card">
        <h2>${icon('ranking-star')} ${t('standings')}</h2>
        ${finished ? '' : hintLine()}
        ${renderTable(false)}
    </section>
    <div class="actions">
        ${finished ? btn('undo', t('undoLast'), { iconName: 'rotate-left', cls: 'wide' }) : ''}
        ${btn('share', t('share'), { iconName: 'share-nodes', cls: 'wide' })}
        ${btn('ask-restart', t('restartSame'), { iconName: 'shuffle', cls: 'accent wide' })}
        ${btn('ask-finish', t('finishTournament'), { iconName: 'flag-checkered', cls: 'danger wide' })}
    </div>
    <section class="card">
        <h2>${icon('clock-rotate-left')} ${t('history')}</h2>
        ${history ? `<ul class="history">${history}</ul>` : `<p class="muted">${t('noMatches')}</p>`}
    </section>`;
}

function shareText() {
    const s = session;
    const lines = [`Padel Dashboard — ${t('resultsWord')}`, `${t('roundsPlayed', { n: s.rounds.length })}`, ''];
    S.table(s).forEach((r, i) => {
        lines.push(`${i + 1}. ${r.name}  ${signed(r.diff)}  (${r.w}-${r.d}-${r.l}, ${r.gf}:${r.ga})`);
    });
    return lines.join('\n');
}

async function share() {
    const text = shareText();
    try {
        if (navigator.share) {
            await navigator.share({ text });
            return;
        }
    } catch (e) {
        if (e?.name === 'AbortError') return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast(t('copied'));
    } catch {
        showToast(t('copyFailed'));
    }
}

function playersPanel() {
    const s = session;
    const isAm = s.settings.mode === 'americano';
    const list = S.units(s)
        .map((u) => {
            const name = isAm ? u.name : S.pairName(s, u);
            return `<li class="${u.active ? '' : 'inactive'}"><span>${esc(name)}${u.active ? '' : ` <span class="muted">(${t('withdrawn')})</span>`}</span>
                ${
                    u.active
                        ? btn('toggle-active', t('withdraw'), { iconName: 'user-slash', cls: 'ghost small', attrs: `data-unit="${u.id}"` })
                        : btn('toggle-active', t('return'), { iconName: 'user-check', cls: 'ghost small', attrs: `data-unit="${u.id}"` })
                }</li>`;
        })
        .join('');
    const addForm = isAm
        ? `<form class="add-row" data-form="add-player">
               <input type="text" name="a" placeholder="${t('nickname')}" autocomplete="off" maxlength="24" />
               <button type="submit" class="btn round primary" aria-label="${t('add')}">${icon('user-plus')}</button>
           </form>`
        : `<form class="add-row" data-form="add-pair">
               <input type="text" name="a" placeholder="${t('nickname')} 1" autocomplete="off" maxlength="24" />
               <input type="text" name="b" placeholder="${t('nickname')} 2" autocomplete="off" maxlength="24" />
               <button type="submit" class="btn round primary" aria-label="${t('add')}">${icon('user-plus')}</button>
           </form>`;
    return `<section class="card"><h2>${icon('users')} ${t('playersAndCourts')}</h2>
        ${
            S.isWinnerStays(s)
                ? ''
                : `<div class="row-between"><h3>${t('courts')}</h3>${stepper('game-courts', s.settings.courts)}</div>`
        }
        <h3>${isAm ? t('addPlayer') : t('addPair')}</h3>
        ${addForm}
        ${view.playersError ? `<p class="error">${view.playersError}</p>` : ''}
        <ul class="name-list">${list}</ul></section>`;
}

function brand() {
    return `<header class="top">
        <div class="brand"><img src="icons/favicon-32x32.png" alt="" width="32" height="32" /><span>Padel Dashboard</span></div>
    </header>`;
}

function renderSettings() {
    return `${brand()}${switches()}${playersPanel()}`;
}

// ---------- диалоги ----------

function renderDialog() {
    const d = view.dialog;
    if (!d) return '';
    const close = btn('close-dialog', '', { iconName: 'xmark', cls: 'round ghost dialog-close', attrs: `aria-label="${t('close')}"` });

    if (d.type === 'edit') {
        const round = d.round === 'current' ? session.current : session.rounds[d.round];
        const m = round.matches[d.match];
        return `${close}<h2>${t('editScore')}</h2>
            <p class="dialog-teams">${matchLine(m)}</p>
            ${scoreInput('edit', session.settings.targetSum, m)}
            ${btn('save-edit', t('save'), { iconName: 'check', cls: 'primary wide big', attrs: 'data-key="edit"', disabled: !draftScore('edit') })}`;
    }

    if (d.type === 'sub') {
        const resting = S.restingIds(session);
        return `${close}<h2>${t('substitute')}</h2>
            <p>${t('substituteFor', { name: esc(unitName(d.unit)) })}</p>
            ${
                resting.length
                    ? `<div class="list-buttons">${resting
                          .map((id) => btn('do-sub', esc(unitName(id)), { iconName: 'right-left', cls: 'wide', attrs: `data-unit="${id}"` }))
                          .join('')}</div>`
                    : `<p class="muted">${t('nobodyResting')}</p>`
            }`;
    }

    if (d.type === 'restart') {
        return `${close}<h2>${t('restartSame')}</h2>
            <p>${t('restartConfirm')}</p>
            ${btn('restart', t('restartSame'), { iconName: 'shuffle', cls: 'primary wide' })}
            ${btn('close-dialog', t('cancel'), { cls: 'ghost wide' })}`;
    }

    if (d.type === 'finish') {
        return `${close}<h2>${t('finishTournament')}</h2>
            <p>${t('finishConfirm')}</p>
            ${btn('finish', t('finishTournament'), { iconName: 'flag-checkered', cls: 'danger wide' })}
            ${btn('close-dialog', t('cancel'), { cls: 'ghost wide' })}`;
    }

    if (d.type === 'corrupt') {
        return `<h2>${icon('circle-exclamation')} ${t('corruptTitle')}</h2>
            <p>${t('corruptText')}</p>
            ${btn('reset-corrupt', t('startOver'), { cls: 'danger wide' })}`;
    }
    return '';
}

// ---------- общий рендер ----------

function renderHeader() {
    const tab = (screen, iconName, label) =>
        `<button type="button" class="tab ${view.screen === screen ? 'on' : ''}" data-action="go" data-screen="${screen}">${icon(iconName)}<span>${label}</span></button>`;
    const tabs = session
        ? `<nav class="tabs">
               ${S.isFinished(session) ? '' : tab('game', 'play', t('game'))}
               ${tab('results', 'trophy', t('results'))}
               ${tab('settings', 'gear', t('settings'))}
           </nav>`
        : '';
    return `${session ? '' : brand()}${tabs}`;
}

function render() {
    document.documentElement.lang = getLang();
    document.title = 'Padel Dashboard';
    const focusedId = document.activeElement?.id;
    if (session && view.screen === 'game' && S.isFinished(session)) view.screen = 'results';
    let body;
    if (!session) body = renderSetup();
    else if (view.screen === 'results') body = renderResults();
    else if (view.screen === 'settings') body = renderSettings();
    else body = renderGame();
    app.innerHTML = `${renderHeader()}<main>${body}</main>${view.toast ? `<div class="toast" role="status">${esc(view.toast)}</div>` : ''}`;
    if (focusedId) document.getElementById(focusedId)?.focus();

    if (view.dialog) {
        dlg.innerHTML = renderDialog();
        if (!dlg.open) dlg.showModal();
    } else if (dlg.open) dlg.close();
    updateWakeLock();
}

function openDialog(d) {
    view.dialog = d;
    render();
}

function closeDialog() {
    view.dialog = null;
    delete view.drafts.edit;
    render();
}

// ---------- события ----------

const actions = {
    go(el) {
        view.screen = el.dataset.screen;
        window.scrollTo(0, 0);
    },

    // настройка
    'set-mode'(el) {
        view.setup.settings.mode = el.dataset.value;
    },
    'set-rotation'(el) {
        view.setup.settings.rotation = el.dataset.value;
    },
    'set-courts'(el) {
        const st = view.setup.settings;
        st.courts = Math.min(8, Math.max(1, st.courts + Number(el.dataset.delta)));
        if (st.courts > 1 && st.rotation === 'winnerstays') st.rotation = 'roundrobin';
    },
    'set-streak'(el) {
        const st = view.setup.settings;
        const v = Math.min(10, Math.max(0, (st.maxStreak ?? 0) + Number(el.dataset.delta)));
        st.maxStreak = v || null;
    },
    'set-end'(el) {
        view.setup.settings.endMode = el.dataset.value;
    },
    'step-end-rounds'(el) {
        const st = view.setup.settings;
        const cur = st.endRounds ?? Math.max(S.defaultEndRounds(view.setup.names.length, st.courts), 1);
        st.endRounds = Math.min(99, Math.max(1, cur + Number(el.dataset.delta)));
    },
    'step-end-circles'(el) {
        const st = view.setup.settings;
        st.endCircles = Math.min(10, Math.max(1, st.endCircles + Number(el.dataset.delta)));
    },
    'set-scoring'(el) {
        const su = view.setup;
        su.settings.targetSum = el.dataset.value === 'target' ? su.targetValue : null;
    },
    'set-target'(el) {
        view.setup.settings.targetSum = view.setup.targetValue = Number(el.dataset.value);
    },
    'step-target'(el) {
        const su = view.setup;
        su.settings.targetSum = su.targetValue = Math.min(99, Math.max(2, su.settings.targetSum + Number(el.dataset.delta)));
    },
    'remove-name'(el) {
        const su = view.setup;
        const name = el.dataset.name;
        su.names = su.names.filter((n) => n !== name);
        su.pairs = su.pairs.filter((p) => !p.includes(name));
        if (su.pickFirst === name) su.pickFirst = null;
    },
    'use-last'() {
        const su = view.setup;
        su.names = [...su.last.names];
        su.pairs = su.settings.mode === 'pairs' ? (su.last.pairs ?? []).map((p) => [...p]) : [];
        su.error = '';
    },
    'pick-partner'(el) {
        const su = view.setup;
        const name = el.dataset.name;
        if (!su.pickFirst) su.pickFirst = name;
        else if (su.pickFirst === name) su.pickFirst = null;
        else {
            su.pairs.push([su.pickFirst, name]);
            su.pickFirst = null;
        }
    },
    'random-pairs'() {
        const su = view.setup;
        const paired = new Set(su.pairs.flat());
        const rest = su.names.filter((n) => !paired.has(n));
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        for (let i = 0; i + 1 < rest.length; i += 2) su.pairs.push([rest[i], rest[i + 1]]);
        su.pickFirst = null;
        if (rest.length % 2 === 1) su.error = t('oddPlayers');
    },
    unpair(el) {
        view.setup.pairs.splice(Number(el.dataset.index), 1);
    },
    start() {
        startSession();
    },

    // игра
    'score-step'(el) {
        const key = el.dataset.key;
        const d = view.drafts[key] ?? [0, 0];
        const i = Number(el.dataset.side);
        d[i] = Math.max(0, (d[i] || 0) + Number(el.dataset.delta));
        view.drafts[key] = d;
    },
    'pick-target'(el) {
        view.drafts[el.dataset.key] = [Number(el.dataset.value)];
    },
    'save-score'(el) {
        const score = draftScore(el.dataset.key);
        if (!score) return;
        S.saveScore(session, Number(el.dataset.match), score);
        view.drafts = {};
        persist();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    undo() {
        S.undo(session);
        view.drafts = {};
        persist();
    },
    'open-edit'(el) {
        const round = el.dataset.round === 'current' ? 'current' : Number(el.dataset.round);
        const m = (round === 'current' ? session.current : session.rounds[round]).matches[Number(el.dataset.match)];
        view.drafts.edit = session.settings.targetSum ? [m.score[0]] : [...m.score];
        openDialog({ type: 'edit', round, match: Number(el.dataset.match) });
        return false;
    },
    'save-edit'() {
        const score = draftScore('edit');
        if (!score) return;
        const d = view.dialog;
        S.editScore(session, d.round === 'current' ? null : d.round, d.match, score);
        persist();
        closeDialog();
        return false;
    },
    'open-sub'(el) {
        openDialog({ type: 'sub', match: Number(el.dataset.match), unit: el.dataset.unit });
        return false;
    },
    'do-sub'(el) {
        const d = view.dialog;
        S.substitute(session, d.match, d.unit, el.dataset.unit);
        persist();
        closeDialog();
        return false;
    },
    'toggle-active'(el) {
        const unit = S.units(session).find((u) => u.id === el.dataset.unit);
        const warning = S.setActive(session, unit.id, !unit.active);
        persist();
        view.playersError = warning === 'noReplacement' ? t('noReplacement') : '';
    },
    'game-courts'(el) {
        S.setCourts(session, Math.min(8, Math.max(1, session.settings.courts + Number(el.dataset.delta))));
        view.drafts = {};
        persist();
    },
    share() {
        share();
        return false;
    },
    'ask-restart'() {
        openDialog({ type: 'restart' });
        return false;
    },
    restart() {
        session = S.restartSameRoster(session);
        S.saveLast(storage, session);
        persist();
        view.screen = 'game';
        view.dialog = null;
        view.drafts = {};
        window.scrollTo(0, 0);
    },
    'ask-finish'() {
        openDialog({ type: 'finish' });
        return false;
    },
    finish() {
        S.saveLast(storage, session);
        S.clearSession(storage);
        session = null;
        view.screen = 'setup';
        view.setup = defaultSetup();
        view.dialog = null;
        view.drafts = {};
        window.scrollTo(0, 0);
    },
    'reset-corrupt'() {
        S.clearSession(storage);
        view.dialog = null;
    },
    'close-dialog'() {
        closeDialog();
        return false;
    },
};

document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    // false — действие уже само вызвало render
    if (fn(el) !== false) render();
});

document.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    if (kind === 'add-name') {
        addName();
        render();
        document.getElementById('name-input')?.focus();
        return;
    }
    const a = form.elements.a?.value.trim() ?? '';
    const b = form.elements.b?.value.trim() ?? '';
    if (kind === 'add-player') {
        if (!a) return;
        if (S.nameTaken(session, a)) view.playersError = t('nameTaken', { name: a });
        else {
            S.addPlayer(session, a);
            view.playersError = '';
        }
    } else if (kind === 'add-pair') {
        if (!a || !b) return;
        const taken = [a, b].find((n) => S.nameTaken(session, n));
        if (taken) view.playersError = t('nameTaken', { name: taken });
        else if (a.toLowerCase() === b.toLowerCase()) view.playersError = t('nameTaken', { name: b });
        else {
            S.addPair(session, a, b);
            view.playersError = '';
        }
    }
    persist();
    render();
});

document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.input === 'name') {
        view.setup.nameInput = el.value;
        return;
    }
    if (el.dataset.input === 'score') {
        const key = el.dataset.key;
        const d = view.drafts[key] ?? [0, 0];
        const v = parseInt(el.value, 10);
        d[Number(el.dataset.side)] = Number.isNaN(v) ? 0 : Math.max(0, v);
        view.drafts[key] = d;
        // без перерисовки, чтобы не сбить ввод; обновляем только доступность кнопки
        const saveBtn = document.querySelector(`[data-action="${key === 'edit' ? 'save-edit' : 'save-score'}"][data-key="${key}"]`);
        if (saveBtn) saveBtn.disabled = !draftScore(key);
    }
});

// системная тема могла смениться (например, авто-тёмная на закате): сверить переключатель и цвет строки состояния
function syncSystemTheme() {
    const toggle = document.querySelector('[data-toggle="theme"]');
    if (toggle && toggle.checked === isDark()) return;
    applyTheme(document.documentElement.dataset.theme ?? null);
    render();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncSystemTheme);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSystemTheme();
});

document.addEventListener('change', (e) => {
    const kind = e.target.dataset.toggle;
    if (kind === 'theme') {
        const theme = e.target.checked ? 'dark' : 'light';
        applyTheme(theme);
        try {
            storage.setItem(THEME_KEY, theme);
        } catch {}
        render();
    } else if (kind === 'lang') {
        const lang = e.target.checked ? 'en' : 'ru';
        setLang(lang);
        try {
            storage.setItem(LANG_KEY, lang);
        } catch {}
        render();
    }
});

dlg.addEventListener('close', () => {
    if (view.dialog && view.dialog.type !== 'corrupt') {
        view.dialog = null;
        delete view.drafts.edit;
        render();
    } else if (view.dialog?.type === 'corrupt') {
        dlg.showModal();
    }
});

// ---------- экран не гаснет ----------

let wakeLock = null;
async function updateWakeLock() {
    const want = session && view.screen === 'game' && document.visibilityState === 'visible';
    try {
        if (want && !wakeLock && 'wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => (wakeLock = null));
        } else if (!want && wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch {
        wakeLock = null;
    }
}
document.addEventListener('visibilitychange', updateWakeLock);

// ---------- старт ----------

function init() {
    let lang = 'ru';
    try {
        lang = storage.getItem(LANG_KEY) === 'en' ? 'en' : 'ru';
    } catch {}
    setLang(lang);
    try {
        applyTheme(storage.getItem(THEME_KEY));
    } catch {
        applyTheme(null);
    }
    view.setup = defaultSetup();
    const loaded = S.loadSession(storage);
    if (loaded.corrupt) view.dialog = { type: 'corrupt' };
    else if (loaded.session) {
        session = loaded.session;
        view.screen = 'game';
    }
    render();
}

init();
