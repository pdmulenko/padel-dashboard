// Модель сессии и хранение. Без DOM: хранилище передаётся параметром (localStorage в браузере).

import {
    makeRng,
    pairKey,
    shuffle,
    unitStats,
    roundsToEqual,
    americanoCourts,
    pairsCourts,
    nextAmericanoRound,
    nextRoundRobinRound,
    initWinnerStays,
    applyWinnerStays,
    wsAddPair,
    wsRemovePair,
    wsSubstitute,
    wsRound,
} from './scheduler.js';
import { scoredMatches, computeTable, americanoKeys, pairsKeys, podium } from './scoring.js';

export const VERSION = 1;
export const SESSION_KEY = 'pd-session';
export const LAST_KEY = 'pd-last';
export const ARCHIVE_KEY = 'pd-archive';

export const DEFAULT_SETTINGS = {
    mode: 'americano', // 'americano' | 'pairs'
    rotation: 'roundrobin', // 'roundrobin' | 'winnerstays'
    courts: 1,
    targetSum: null, // null — свободный счёт
    maxStreak: 3, // null — без лимита
    endMode: 'free', // 'free' | 'rounds' | 'circles' (только американо)
    endRounds: null, // число туров; null — по числу игроков
    endCircles: 1, // число кругов
    circleRounds: null, // туров в круге; null — полная игра по формуле
};

// ---------- хранение ----------

function isSessionShape(s) {
    return (
        s &&
        typeof s === 'object' &&
        s.version === VERSION &&
        s.settings &&
        Array.isArray(s.players) &&
        Array.isArray(s.pairs) &&
        Array.isArray(s.rounds)
    );
}

// { session } — есть сессия; { session: null } — нет; { corrupt: true } — данные битые
export function loadSession(storage) {
    let raw;
    try {
        raw = storage.getItem(SESSION_KEY);
    } catch {
        return { session: null };
    }
    if (raw == null) return { session: null };
    try {
        const s = JSON.parse(raw);
        if (!isSessionShape(s)) return { corrupt: true };
        if (!s.id) s.id = `s${s.seed.toString(36)}`;
        return { session: s };
    } catch {
        return { corrupt: true };
    }
}

export function saveSession(storage, s) {
    try {
        storage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
        // хранилище недоступно (приватный режим и т. п.) — работаем без сохранения
    }
}

export function clearSession(storage) {
    try {
        storage.removeItem(SESSION_KEY);
    } catch {}
}

// ---------- архив завершённых турниров ----------

export function loadArchive(storage) {
    try {
        const v = JSON.parse(storage.getItem(ARCHIVE_KEY));
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}

function saveArchive(storage, list) {
    try {
        storage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, 100)));
    } catch {}
}

function archiveEntry(s, finishedAt) {
    const side = (m, i) => m.sides[i].map((id) => playerName(s, id)).join(' + ');
    return {
        id: s.id,
        finishedAt,
        settings: s.settings,
        participants: s.settings.mode === 'americano' ? s.players.length : s.pairs.length,
        rows: table(s),
        rounds: s.rounds
            .map((r) => r.matches.filter((m) => m.score).map((m) => ({ court: m.court, a: side(m, 0), b: side(m, 1), score: m.score })))
            .filter((r) => r.length),
    };
}

// Завершённый турнир лежит в архиве (и обновляется при правках), незавершённый — нет
export function syncArchive(storage, s, now = new Date().toISOString()) {
    if (!s.id) return;
    const list = loadArchive(storage);
    const i = list.findIndex((e) => e.id === s.id);
    if (isFinished(s)) {
        const entry = archiveEntry(s, i >= 0 ? list[i].finishedAt : now);
        if (i >= 0) list[i] = entry;
        else list.unshift(entry);
        saveArchive(storage, list);
    } else if (i >= 0) {
        list.splice(i, 1);
        saveArchive(storage, list);
    }
}

// Доигранный турнир, который завершился давно (по умолчанию больше 12 часов назад):
// при открытии приложения его не показываем, он уже лежит в «Истории»
export const STALE_FINISHED_MS = 12 * 60 * 60 * 1000;

export function isStaleFinished(storage, s, now = Date.now()) {
    if (!isFinished(s)) return false;
    const entry = loadArchive(storage).find((e) => e.id === s.id);
    if (!entry) return false;
    return now - Date.parse(entry.finishedAt) > STALE_FINISHED_MS;
}

export function removeFromArchive(storage, id) {
    saveArchive(
        storage,
        loadArchive(storage).filter((e) => e.id !== id),
    );
}

export function loadLast(storage) {
    try {
        const v = JSON.parse(storage.getItem(LAST_KEY));
        return v && Array.isArray(v.names) ? v : null;
    } catch {
        return null;
    }
}

export function saveLast(storage, s) {
    try {
        const names = s.players.map((p) => p.name);
        const pairs = s.settings.mode === 'pairs' ? s.pairs.map((pr) => pr.players.map((id) => playerName(s, id))) : [];
        storage.setItem(LAST_KEY, JSON.stringify({ names, pairs, settings: s.settings }));
    } catch {}
}

// ---------- создание ----------

// pairNames — [[имя, имя], ...] для режима пар
export function createSession(settings, names, pairNames = [], seed = Math.floor(Math.random() * 2 ** 31)) {
    const rng = makeRng(seed);
    const s = {
        version: VERSION,
        id: `s${Date.now().toString(36)}${seed.toString(36)}`,
        seed,
        settings: { ...DEFAULT_SETTINGS, ...settings },
        players: [],
        pairs: [],
        rounds: [],
        current: null,
        next: null,
        ws: null,
        seq: 0,
        nextId: 1,
    };
    if (s.settings.mode !== 'pairs' || s.settings.courts > 1) {
        if (s.settings.rotation === 'winnerstays') s.settings.rotation = 'roundrobin';
    }
    if (s.settings.mode === 'americano') {
        for (const name of shuffle(names, rng)) s.players.push(newPlayer(s, name, 0));
        if (s.settings.endRounds == null) s.settings.endRounds = defaultEndRounds(names.length, s.settings.courts);
        if (s.settings.circleRounds == null) s.settings.circleRounds = fullPlay(names.length, s.settings.courts)?.rounds ?? null;
        planSeed(s);
    } else {
        for (const [a, b] of shuffle(pairNames, rng)) {
            const pa = newPlayer(s, a, 0);
            const pb = newPlayer(s, b, 0);
            s.players.push(pa, pb);
            s.pairs.push({ id: `t${s.nextId++}`, players: [pa.id, pb.id], active: true, joinedRound: 0 });
        }
        if (isWinnerStays(s)) s.ws = initWinnerStays(s.pairs.map((p) => p.id));
    }
    refill(s);
    return s;
}

function newPlayer(s, name, joinedRound) {
    return { id: `p${s.nextId++}`, name, active: true, joinedRound };
}

// ---------- запросы ----------

export const isWinnerStays = (s) => s.settings.mode === 'pairs' && s.settings.rotation === 'winnerstays';

export function playerName(s, id) {
    return s.players.find((p) => p.id === id)?.name ?? '?';
}

export function pairName(s, pair) {
    return pair.players.map((id) => playerName(s, id)).join(' + ');
}

// Участники расписания: игроки в американо, пары в режиме пар
export function units(s) {
    return s.settings.mode === 'americano' ? s.players : s.pairs;
}

const unitsOf = (s) => (s.settings.mode === 'americano' ? (m) => m.sides.flat() : (m) => m.pairs);

export function effectiveCourts(s) {
    const active = units(s).filter((u) => u.active).length;
    if (isWinnerStays(s)) return active >= 2 ? 1 : 0;
    return s.settings.mode === 'americano' ? americanoCourts(active, s.settings.courts) : pairsCourts(active, s.settings.courts);
}

export function currentUnitIds(s) {
    return s.current ? s.current.matches.flatMap(unitsOf(s)) : [];
}

// Отдыхающие (в порядке приоритета на следующий тур)
export function restingIds(s) {
    if (isWinnerStays(s)) return [...s.ws.queue];
    const inCurrent = new Set(currentUnitIds(s));
    const active = units(s).filter((u) => u.active && !inCurrent.has(u.id));
    const { played, bench } = unitStats(units(s), s.rounds, unitsOf(s));
    return active
        .sort((a, b) => played.get(a.id) - played.get(b.id) || bench.get(b.id) - bench.get(a.id))
        .map((u) => u.id);
}

export function table(s) {
    const matches = scoredMatches(s.rounds, s.current);
    if (s.settings.mode === 'americano') return computeTable(s.players, matches, americanoKeys);
    const entries = s.pairs.map((p) => ({ id: p.id, name: pairName(s, p), active: p.active }));
    return computeTable(entries, matches, pairsKeys);
}

// Подсказка «до равного числа игр: N туров» (null — не показывать)
export function roundsToEqualHint(s) {
    if (isWinnerStays(s)) return null;
    const m = effectiveCourts(s);
    if (m < 1) return null;
    const list = units(s);
    const { played } = unitStats(list, s.rounds, unitsOf(s));
    const counts = list.filter((u) => u.active).map((u) => played.get(u.id));
    const perRound = (s.settings.mode === 'americano' ? 4 : 2) * m;
    return roundsToEqual(counts, perRound);
}

// ---------- окончание турнира ----------

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

// Туров по умолчанию: n − 1, если никто не отдыхает (игроков ровно на все корты) —
// тогда каждый побывает в паре с каждым; иначе по числу игроков
export function defaultEndRounds(players, courts) {
    if (players >= 4 && players % 4 === 0 && courts >= players / 4) return players - 1;
    return players;
}

// Полная игра: каждый побывал в паре с каждым одинаковое число раз.
// За тур играют 4m человек, нужно n(n−1)·x «мест», откуда туров n(n−1)/НОД(4m, n(n−1)), x = 4m/НОД
export function fullPlay(players, courts) {
    const m = americanoCourts(players, courts);
    if (m < 1) return null;
    const slots = players * (players - 1);
    const g = gcd(4 * m, slots);
    const times = (4 * m) / g;
    return { rounds: slots / g, times, matches: (players - 1) * times, courts: m };
}

// Что даст заданное число туров: поровну ли игр, сколько, и сколько раз каждый с каждым
export function roundsSummary(players, courts, rounds) {
    const full = fullPlay(players, courts);
    if (!full || !rounds) return null;
    const slots = 4 * full.courts * rounds;
    const pairSlots = players * (players - 1);
    return {
        equal: slots % players === 0,
        perPlayer: Math.floor(slots / players),
        pairTimes: slots % pairSlots === 0 ? slots / pairSlots : null,
        full,
    };
}

// Сколько туров в турнире (null — без ограничения)
export function targetRounds(s) {
    const st = s.settings;
    if (st.mode !== 'americano' || st.endMode === 'free') return null;
    if (st.endMode === 'rounds') return st.endRounds;
    const perCircle = st.circleRounds ?? fullPlay(s.players.filter((p) => p.active).length, st.courts)?.rounds;
    return perCircle ? st.endCircles * perCircle : null;
}

// Расписание строится тур за туром и к концу может зайти в тупик. Если число туров известно,
// заранее прогоняем несколько вариантов (seed) и берём тот, где напарники распределены ровнее всего
function planSeed(s) {
    const R = targetRounds(s);
    if (!R || R > 150) return;
    const ids = s.players.map((p) => p.id);
    const summary = roundsSummary(ids.length, s.settings.courts, R);
    const goal = summary?.pairTimes != null ? 0 : 1;
    const deadline = Date.now() + 1500;
    let best = null;
    for (let k = 0; k < 40; k++) {
        const seed = (s.seed + k * 104729) >>> 0;
        const rounds = [];
        for (let t = 0; t < R; t++) {
            const r = nextAmericanoRound(s.players, rounds, s.settings.courts, makeRng((seed + t * 7919) >>> 0));
            if (!r) break;
            rounds.push(r);
        }
        const spread = partnerSpread(ids, rounds);
        if (!best || spread < best.spread) best = { seed, spread };
        if (spread <= goal || Date.now() > deadline) break;
    }
    if (best) s.seed = best.seed;
}

// Разница между самым частым и самым редким сочетанием напарников
export function partnerSpread(ids, rounds) {
    const count = new Map();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) count.set(pairKey(ids[i], ids[j]), 0);
    for (const r of rounds) for (const m of r.matches) for (const side of m.sides) count.set(pairKey(...side), count.get(pairKey(...side)) + 1);
    const v = [...count.values()];
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
}

export function isFinished(s) {
    if (s.finished) return true;
    const target = targetRounds(s);
    return target != null && s.rounds.length >= target;
}

// Завершить турнир досрочно: сохранённые матчи текущего тура засчитываются, остальные отбрасываются
export function finishNow(s) {
    if (s.current?.matches.some((m) => m.score)) s.rounds.push(s.current);
    s.current = null;
    s.next = null;
    s.finished = true;
}

// Первые три места (с учётом дележа мест по разнице и забитым)
export function podiumOf(s) {
    return podium(table(s));
}

// Победители: все, кто делит первое место
export function winners(s) {
    return podiumOf(s)[0] ?? [];
}

// Новый турнир тем же составом: активные игроки (пары) и те же настройки, порядок перемешивается заново
export function restartSameRoster(s, seed) {
    const settings = { ...s.settings };
    if (settings.mode === 'americano') {
        return createSession(settings, s.players.filter((p) => p.active).map((p) => p.name), [], seed);
    }
    const pairNames = s.pairs.filter((p) => p.active).map((p) => p.players.map((id) => playerName(s, id)));
    return createSession(settings, [], pairNames, seed);
}

export function canUndo(s) {
    return s.rounds.length > 0 || (s.current?.matches.some((m) => m.score) ?? false);
}

// ---------- генерация туров ----------

function rngFor(s, roundsLen) {
    return makeRng((s.seed + roundsLen * 7919) >>> 0);
}

function generate(s, rounds) {
    const rng = rngFor(s, rounds.length);
    if (isWinnerStays(s)) return wsRound(s.ws, s.pairs);
    if (s.settings.mode === 'americano') return nextAmericanoRound(s.players, rounds, s.settings.courts, rng);
    return nextRoundRobinRound(s.pairs, rounds, s.settings.courts, rng);
}

// Заполнить текущий тур и прогноз; прогноз фиксируется и потом становится текущим
export function refill(s) {
    if (isFinished(s)) {
        s.current = null;
        s.next = null;
        return;
    }
    if (isWinnerStays(s)) {
        if (!s.current) s.current = generate(s, s.rounds);
        s.next = null;
        return;
    }
    if (!s.current) s.current = s.next ?? generate(s, s.rounds);
    const target = targetRounds(s);
    const hasNext = s.current && (target == null || s.rounds.length + 1 < target);
    s.next = hasNext ? generate(s, [...s.rounds, s.current]) : null;
}

function invalidateForecast(s) {
    s.next = null;
    refill(s);
}

// ---------- действия ----------

export function saveScore(s, matchIndex, score) {
    const m = s.current.matches[matchIndex];
    m.score = score;
    m.seq = ++s.seq;
    if (s.current.matches.every((x) => x.score)) completeRound(s);
}

function completeRound(s) {
    const round = s.current;
    if (isWinnerStays(s)) {
        round.ws = s.ws;
        s.ws = applyWinnerStays(s.ws, round.matches[0].score, s.settings.maxStreak);
    }
    s.rounds.push(round);
    s.current = null;
    refill(s);
}

function unscoreLast(round) {
    const scored = round.matches.filter((m) => m.score);
    const last = scored.reduce((a, b) => (b.seq > a.seq ? b : a));
    last.score = null;
    delete last.seq;
}

export function undo(s) {
    s.finished = false;
    if (s.current?.matches.some((m) => m.score)) {
        unscoreLast(s.current);
        return true;
    }
    if (s.rounds.length === 0) return false;
    const round = s.rounds.pop();
    unscoreLast(round);
    if (round.ws) {
        s.ws = round.ws;
        delete round.ws;
    }
    s.current = round;
    invalidateForecast(s);
    return true;
}

// roundIndex === null — матч текущего тура
export function editScore(s, roundIndex, matchIndex, score) {
    const round = roundIndex === null ? s.current : s.rounds[roundIndex];
    round.matches[matchIndex].score = score;
}

function currentHasScores(s) {
    return s.current?.matches.some((m) => m.score) ?? false;
}

// Сумму очков (или свободный счёт) можно поменять, пока не сохранено ни одного результата
export function canChangeScoring(s) {
    return s.rounds.length === 0 && !currentHasScores(s);
}

export function setTargetSum(s, targetSum) {
    if (canChangeScoring(s)) s.settings.targetSum = targetSum;
}

export function setCourts(s, n) {
    s.settings.courts = n;
    if (!currentHasScores(s)) s.current = null;
    invalidateForecast(s);
}

// Замена в несыгранном матче текущего тура: outId -> inId (игроки в американо, пары в режиме пар)
export function substitute(s, matchIndex, outId, inId) {
    const m = s.current.matches[matchIndex];
    if (m.score) return;
    if (s.settings.mode === 'americano') {
        m.sides = m.sides.map((side) => side.map((id) => (id === outId ? inId : id)));
    } else {
        const pair = s.pairs.find((p) => p.id === inId);
        const i = m.pairs.indexOf(outId);
        m.pairs[i] = inId;
        m.sides[i] = [...pair.players];
        if (isWinnerStays(s)) s.ws = wsSubstitute(s.ws, outId, inId);
    }
    invalidateForecast(s);
}

// Возвращает 'noReplacement', если выбывшего некем заменить в уже идущем туре
export function setActive(s, unitId, active) {
    const unit = units(s).find((u) => u.id === unitId);
    if (!unit || unit.active === active) return null;
    unit.active = active;
    let warning = null;

    if (isWinnerStays(s)) {
        s.ws = active ? wsAddPair(s.ws, unitId) : wsRemovePair(s.ws, unitId);
        if (!currentHasScores(s)) s.current = wsRound(s.ws, s.pairs);
        refill(s);
        return null;
    }

    if (!active && s.current) {
        const mi = s.current.matches.findIndex((m) => !m.score && unitsOf(s)(m).includes(unitId));
        if (mi >= 0) {
            const replacement = restingIds(s)[0];
            if (replacement) {
                substitute(s, mi, unitId, replacement);
            } else if (!currentHasScores(s)) {
                s.current = null;
            } else {
                warning = 'noReplacement';
            }
        }
    }
    invalidateForecast(s);
    return warning;
}

function joinedRoundNow(s) {
    return s.rounds.length + (s.current ? 1 : 0);
}

export function nameTaken(s, name) {
    const n = name.trim().toLowerCase();
    return s.players.some((p) => p.name.toLowerCase() === n);
}

export function addPlayer(s, name) {
    const p = newPlayer(s, name.trim(), joinedRoundNow(s));
    s.players.push(p);
    invalidateForecast(s);
    return p;
}

export function addPair(s, nameA, nameB) {
    const joined = joinedRoundNow(s);
    const pa = newPlayer(s, nameA.trim(), joined);
    const pb = newPlayer(s, nameB.trim(), joined);
    s.players.push(pa, pb);
    const pair = { id: `t${s.nextId++}`, players: [pa.id, pb.id], active: true, joinedRound: joined };
    s.pairs.push(pair);
    if (isWinnerStays(s)) {
        s.ws = wsAddPair(s.ws, pair.id);
        if (!s.current) s.current = wsRound(s.ws, s.pairs);
    }
    invalidateForecast(s);
    return pair;
}
