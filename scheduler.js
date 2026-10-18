// Алгоритмы расписания. Чистые функции без DOM.
//
// Формат тура: { matches: [{ court, sides: [[p1, p2], [p3, p4]], pairs?: [pairA, pairB], score }] }
// sides — всегда id игроков; pairs — id пар (только в режиме фиксированных пар).

// ---------- случайность ----------

// mulberry32: детерминированный генератор, чтобы тесты были воспроизводимыми
export function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function pick(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
}

export function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function inc(map, key, by = 1) {
    map.set(key, (map.get(key) ?? 0) + by);
}

// ---------- общая статистика по истории ----------

// units: [{ id, joinedRound }]; unitsOf(match) -> id участников матча
// played — сыгранные матчи, bench — туров подряд на скамейке, streak — туров подряд на корте
export function unitStats(units, rounds, unitsOf) {
    const played = new Map();
    const bench = new Map();
    const streak = new Map();
    for (const u of units) {
        played.set(u.id, 0);
        bench.set(u.id, 0);
        streak.set(u.id, 0);
    }
    rounds.forEach((round, ri) => {
        const inRound = new Set(round.matches.flatMap(unitsOf));
        for (const u of units) {
            if ((u.joinedRound ?? 0) > ri) continue;
            if (inRound.has(u.id)) {
                inc(played, u.id);
                bench.set(u.id, 0);
                inc(streak, u.id);
            } else {
                inc(bench, u.id);
                streak.set(u.id, 0);
            }
        }
    });
    return { played, bench, streak };
}

// Сколько участников реально задействовано за тур
export function americanoCourts(activeCount, courts) {
    return Math.min(courts, Math.floor(activeCount / 4));
}

export function pairsCourts(activePairs, courts) {
    return Math.min(courts, Math.floor(activePairs / 2));
}

// Минимальное число туров, после которого у всех поровну матчей (null, если не сходится)
export function roundsToEqual(counts, perRound, limit = 500) {
    if (counts.length === 0 || perRound <= 0 || perRound > counts.length) return null;
    const c = [...counts].sort((a, b) => a - b);
    for (let t = 0; t <= limit; t++) {
        if (c[0] === c[c.length - 1]) return t;
        for (let i = 0; i < perRound; i++) c[i]++;
        c.sort((a, b) => a - b);
    }
    return null;
}

// ---------- американо ----------

function americanoHistory(rounds) {
    const partner = new Map();
    const opponent = new Map();
    for (const round of rounds) {
        for (const m of round.matches) {
            const [a, b] = m.sides;
            inc(partner, pairKey(a[0], a[1]));
            inc(partner, pairKey(b[0], b[1]));
            for (const x of a) for (const y of b) inc(opponent, pairKey(x, y));
        }
    }
    return { partner, opponent };
}

function matchPenalty(sides, hist) {
    const [a, b] = sides;
    let p = 10 * ((hist.partner.get(pairKey(a[0], a[1])) ?? 0) + (hist.partner.get(pairKey(b[0], b[1])) ?? 0));
    for (const x of a) for (const y of b) p += hist.opponent.get(pairKey(x, y)) ?? 0;
    return p;
}

// Все разбиения списка (длина кратна 4) на матчи 2×2
function allPartitions(ids) {
    if (ids.length === 0) return [[]];
    const [x, ...rest] = ids;
    const out = [];
    for (let i = 0; i < rest.length; i++) {
        const y = rest[i];
        const others = rest.filter((_, k) => k !== i);
        for (let j = 0; j < others.length; j++) {
            for (let k = j + 1; k < others.length; k++) {
                const z = others[j];
                const w = others[k];
                const remain = others.filter((_, q) => q !== j && q !== k);
                for (const tail of allPartitions(remain)) out.push([[[x, y], [z, w]], ...tail]);
            }
        }
    }
    return out;
}

function partitionPenalty(partition, hist) {
    return partition.reduce((s, m) => s + matchPenalty(m, hist), 0);
}

// Лучшее разбиение выбранных игроков на матчи: полный перебор до 2 кортов, иначе случайный поиск
function bestPartition(ids, hist, rng) {
    let candidates;
    if (ids.length <= 8) {
        candidates = allPartitions(ids);
    } else {
        candidates = [];
        for (let s = 0; s < 400; s++) {
            const sh = shuffle(ids, rng);
            const part = [];
            for (let i = 0; i < sh.length; i += 4) part.push([[sh[i], sh[i + 1]], [sh[i + 2], sh[i + 3]]]);
            candidates.push(part);
        }
    }
    let best = Infinity;
    let bestList = [];
    for (const part of candidates) {
        const p = partitionPenalty(part, hist);
        if (p < best) {
            best = p;
            bestList = [part];
        } else if (p === best) bestList.push(part);
    }
    return { penalty: best, partition: pick(bestList, rng) };
}

function combinations(arr, k, limit) {
    const out = [];
    const cur = [];
    (function rec(start) {
        if (out.length >= limit) return;
        if (cur.length === k) {
            out.push([...cur]);
            return;
        }
        for (let i = start; i <= arr.length - (k - cur.length); i++) {
            cur.push(arr[i]);
            rec(i + 1);
            cur.pop();
        }
    })(0);
    return out;
}

function binom(n, k) {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
    return r;
}

// players: [{ id, active, joinedRound }]; rounds: сыгранные (или зафиксированные) туры
// Возвращает тур или null, если активных игроков меньше 4
export function nextAmericanoRound(players, rounds, courts, rng) {
    const active = players.filter((p) => p.active);
    const m = americanoCourts(active.length, courts);
    if (m < 1) return null;
    const need = 4 * m;
    const { played, bench } = unitStats(active, rounds, (match) => match.sides.flat());
    const hist = americanoHistory(rounds);

    // жёсткий приоритет — меньше матчей; «дольше на скамейке» учитывается мягко ниже,
    // иначе при 8 игроках одни и те же четвёрки играли бы вместе всю сессию
    const cmp = (a, b) => played.get(a) - played.get(b);
    const sorted = shuffle(
        active.map((p) => p.id),
        rng,
    ).sort(cmp);
    const boundary = sorted[need - 1];
    const mandatory = sorted.filter((id) => cmp(id, boundary) < 0);
    const tied = sorted.filter((id) => cmp(id, boundary) === 0);
    const r = need - mandatory.length;

    // среди равных по приоритету выбираем тех, кого можно разбить с наименьшим штрафом
    let groups;
    if (binom(tied.length, r) <= 200) groups = combinations(tied, r, 200);
    else groups = Array.from({ length: 200 }, () => shuffle(tied, rng).slice(0, r));

    // взгляд на тур вперёд: если оставшиеся из равных ровно заполнят следующий тур,
    // их состав уже предопределён, и его штраф тоже учитывается
    const lookahead = tied.length - r === need;

    let best = Infinity;
    let bestList = [];
    for (const g of groups) {
        const res = bestPartition([...mandatory, ...g], hist, rng);
        // штраф за повторы главнее; при равенстве — берём тех, кто дольше отдыхал
        let penalty = res.penalty * 1000 - g.reduce((s, id) => s + bench.get(id), 0);
        if (lookahead) {
            const chosen = new Set(g);
            penalty +=
                1000 *
                bestPartition(
                    tied.filter((id) => !chosen.has(id)),
                    hist,
                    rng,
                ).penalty;
        }
        if (penalty < best) {
            best = penalty;
            bestList = [res.partition];
        } else if (penalty === best) bestList.push(res.partition);
    }
    const partition = pick(bestList, rng);
    return {
        matches: partition.map((sides, i) => ({ court: i + 1, sides, score: null })),
    };
}

// ---------- фиксированные пары: по кругу ----------

// pairs: [{ id, players: [p1, p2], active, joinedRound }]
// Текущий цикл: множество уже сыгранных сочетаний среди активных пар
export function roundRobinPlayed(pairs, rounds) {
    const activeIds = pairs.filter((p) => p.active).map((p) => p.id);
    const all = [];
    for (let i = 0; i < activeIds.length; i++)
        for (let j = i + 1; j < activeIds.length; j++) all.push(pairKey(activeIds[i], activeIds[j]));
    let played = new Set();
    for (const round of rounds) {
        for (const m of round.matches) {
            const [a, b] = m.pairs;
            const key = pairKey(a, b);
            if (all.includes(key)) played.add(key);
        }
        if (all.length > 0 && all.every((k) => played.has(k))) played = new Set();
    }
    return played;
}

export function nextRoundRobinRound(pairs, rounds, courts, rng) {
    const active = pairs.filter((p) => p.active);
    const m = pairsCourts(active.length, courts);
    if (m < 1) return null;
    const { played, bench, streak } = unitStats(active, rounds, (match) => match.pairs);
    const cyclePlayed = roundRobinPlayed(pairs, rounds);

    const matchCost = (a, b) => {
        const viol = courts === 1 && (streak.get(a) >= 2 || streak.get(b) >= 2) ? 1 : 0;
        return viol * 1e6 + (played.get(a) + played.get(b)) * 1e3 - (bench.get(a) + bench.get(b));
    };

    // лучший набор из size непересекающихся матчей среди кандидатов
    const bestSet = (cands, size) => {
        let best = Infinity;
        let bestList = [];
        let count = 0;
        const cur = [];
        const used = new Set();
        (function rec(start, cost) {
            if (count > 20000) return;
            if (cur.length === size) {
                count++;
                if (cost < best) {
                    best = cost;
                    bestList = [[...cur]];
                } else if (cost === best) bestList.push([...cur]);
                return;
            }
            for (let i = start; i < cands.length; i++) {
                const [a, b] = cands[i];
                if (used.has(a) || used.has(b)) continue;
                used.add(a);
                used.add(b);
                cur.push(cands[i]);
                rec(i + 1, cost + matchCost(a, b));
                cur.pop();
                used.delete(a);
                used.delete(b);
            }
        })(0, 0);
        return bestList.length ? pick(bestList, rng) : null;
    };

    const ids = shuffle(
        active.map((p) => p.id),
        rng,
    );
    const combos = (list) => {
        const out = [];
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
        return out;
    };
    const unplayed = combos(ids).filter(([a, b]) => !cyclePlayed.has(pairKey(a, b)));

    // сколько матчей можно взять из текущего цикла; остальные корты — из нового цикла
    let chosen = [];
    for (let s = m; s >= 0; s--) {
        const set = s === 0 ? [] : bestSet(unplayed, s);
        if (set) {
            chosen = set;
            break;
        }
    }
    if (chosen.length < m) {
        const used = new Set(chosen.flat());
        const fresh = combos(ids.filter((id) => !used.has(id)));
        chosen = [...chosen, ...(bestSet(fresh, m - chosen.length) ?? [])];
    }

    const byId = new Map(pairs.map((p) => [p.id, p]));
    return {
        matches: chosen.map(([a, b], i) => ({
            court: i + 1,
            pairs: [a, b],
            sides: [[...byId.get(a).players], [...byId.get(b).players]],
            score: null,
        })),
    };
}

// ---------- фиксированные пары: победитель остаётся (1 корт) ----------

// ws = { court: [a, b], queue: [...], streak: { id: n }, entered: { id: { round, order } }, round }
// entered.round — номер матча, с которого пара на корте; order — 0/1, если вышли одновременно

export function initWinnerStays(pairIds) {
    const ws = { court: [], queue: [...pairIds], streak: {}, entered: {}, round: 0 };
    fillCourt(ws);
    return ws;
}

function fillCourt(ws) {
    let order = 0;
    while (ws.court.length < 2 && ws.queue.length > 0) {
        const id = ws.queue.shift();
        ws.court.push(id);
        ws.streak[id] = 0;
        ws.entered[id] = { round: ws.round, order: order++ };
    }
}

function cloneWs(ws) {
    return JSON.parse(JSON.stringify(ws));
}

// Кто уходит при ничьей: дольше на корте; если вышли одновременно — тот, кто вышел вторым
function drawLeaver(ws) {
    const [a, b] = ws.court;
    const ea = ws.entered[a];
    const eb = ws.entered[b];
    if (ea.round !== eb.round) return ea.round < eb.round ? a : b;
    return ea.order > eb.order ? a : b;
}

export function applyWinnerStays(wsIn, score, maxStreak) {
    const ws = cloneWs(wsIn);
    const [a, b] = ws.court;
    const [sa, sb] = score;
    let loser;
    if (sa > sb) loser = b;
    else if (sb > sa) loser = a;
    else loser = drawLeaver(ws);
    const winner = loser === a ? b : a;

    ws.round++;
    ws.streak[winner] = (ws.streak[winner] ?? 0) + 1;
    ws.court = [winner];
    ws.queue.push(loser);
    delete ws.streak[loser];
    delete ws.entered[loser];

    if (maxStreak && ws.streak[winner] >= maxStreak) {
        ws.court = [];
        ws.queue.push(winner);
        delete ws.streak[winner];
        delete ws.entered[winner];
    }
    fillCourt(ws);
    return ws;
}

export function wsRemovePair(wsIn, id) {
    const ws = cloneWs(wsIn);
    ws.queue = ws.queue.filter((x) => x !== id);
    if (ws.court.includes(id)) {
        ws.court = ws.court.filter((x) => x !== id);
        delete ws.streak[id];
        delete ws.entered[id];
        // оставшаяся пара считается вышедшей раньше, новая — второй
        const order = ws.court.length;
        const nid = ws.queue.shift();
        if (nid !== undefined) {
            ws.court.push(nid);
            ws.streak[nid] = 0;
            ws.entered[nid] = { round: ws.round, order };
        }
    }
    return ws;
}

export function wsAddPair(wsIn, id) {
    const ws = cloneWs(wsIn);
    ws.queue.push(id);
    fillCourt(ws);
    return ws;
}

// Замена пары на корте парой из очереди; заменённая встаёт в начало очереди
export function wsSubstitute(wsIn, outId, inId) {
    const ws = cloneWs(wsIn);
    const i = ws.court.indexOf(outId);
    if (i < 0) return ws;
    ws.queue = ws.queue.filter((x) => x !== inId);
    ws.queue.unshift(outId);
    ws.court[i] = inId;
    ws.streak[inId] = 0;
    ws.entered[inId] = { ...ws.entered[outId] };
    delete ws.streak[outId];
    delete ws.entered[outId];
    return ws;
}

export function wsRound(ws, pairs) {
    if (ws.court.length < 2) return null;
    const byId = new Map(pairs.map((p) => [p.id, p]));
    const [a, b] = ws.court;
    return {
        matches: [{ court: 1, pairs: [a, b], sides: [[...byId.get(a).players], [...byId.get(b).players]], score: null }],
    };
}
