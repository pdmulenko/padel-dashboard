// Подсчёт и турнирная таблица. Чистые функции без DOM.

// Счёт при заданной сумме очков: очки одной пары -> полный счёт
export function scoreFromTarget(x, target) {
    return [x, target - x];
}

export function isValidScore(score) {
    return Array.isArray(score) && score.length === 2 && score.every((v) => Number.isInteger(v) && v >= 0);
}

// Результат матча для стороны side (0/1): 'w' | 'd' | 'l'
export function outcome(score, side) {
    const my = score[side];
    const their = score[1 - side];
    return my > their ? 'w' : my < their ? 'l' : 'd';
}

// Все сыгранные матчи (со счётом) из истории и текущего тура
export function scoredMatches(rounds, current) {
    const list = rounds.flatMap((r) => r.matches);
    if (current) list.push(...current.matches);
    return list.filter((m) => m.score);
}

// entries: [{ id, name, active }]; sideKeys(match, side) -> id строк таблицы, получающих счёт стороны
export function computeTable(entries, matches, sideKeys) {
    const rows = new Map(
        entries.map((e) => [e.id, { id: e.id, name: e.name, active: e.active, matches: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, diff: 0 }]),
    );
    for (const m of matches) {
        for (const side of [0, 1]) {
            for (const key of sideKeys(m, side)) {
                const row = rows.get(key);
                if (!row) continue;
                row.matches++;
                row[outcome(m.score, side)]++;
                row.gf += m.score[side];
                row.ga += m.score[1 - side];
            }
        }
    }
    const list = [...rows.values()];
    for (const r of list) r.diff = r.gf - r.ga;
    // разница мячей ↓, затем разница побед и поражений ↓, затем забито ↓, затем по нику
    list.sort((a, b) => b.diff - a.diff || winDiff(b) - winDiff(a) || b.gf - a.gf || a.name.localeCompare(b.name));
    return list;
}

export const winDiff = (r) => r.w - r.l;

const sameRank = (a, b) => a.diff === b.diff && winDiff(a) === winDiff(b) && a.gf === b.gf;

// Первые три места: группы строк, делящих место по всем критериям
export function podium(rows) {
    const groups = [];
    for (const r of rows) {
        const last = groups[groups.length - 1];
        if (last && sameRank(last[0], r)) last.push(r);
        else if (groups.length < 3) groups.push([r]);
        else break;
    }
    return groups;
}

// Какие дополнительные критерии понадобились, чтобы развести места на подиуме (и следующее за ним):
// wins — при равной разнице мячей решила разница побед, goals — при равенстве и её решили забитые
export function podiumTiebreaks(rows) {
    const shown = podium(rows).flat().length;
    const used = { wins: false, goals: false };
    for (let i = 0; i < Math.min(shown, rows.length - 1); i++) {
        const [a, b] = [rows[i], rows[i + 1]];
        if (a.diff !== b.diff || sameRank(a, b)) continue;
        if (winDiff(a) !== winDiff(b)) used.wins = true;
        else used.goals = true;
    }
    return used;
}

export const americanoKeys = (m, side) => m.sides[side];
export const pairsKeys = (m, side) => [m.pairs[side]];
