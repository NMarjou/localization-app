/**
 * Append-only JSONL log of every billed Claude call, plus aggregators for
 * the /cost endpoint.
 *
 * Each line is one CostEntry. Persisted to data/cost-log.jsonl so it
 * survives restarts. Aggregations are computed on demand by reading the
 * file — fine for our volumes (< 100k entries / yr expected).
 */
import { appendFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { getLogger } from "./logger.js";
import { calculateCost, formatUsd } from "./cost.js";
const COST_LOG_PATH = join(process.cwd(), "data", "cost-log.jsonl");
let logger;
function log() {
    if (!logger)
        logger = getLogger();
    return logger;
}
/**
 * Record a single Claude call's usage + computed cost. Failures to write
 * the file are logged but never thrown — cost tracking must never block
 * a translation push.
 */
export async function recordCost(args) {
    try {
        const breakdown = calculateCost(args.usage, args.model, args.isBatch);
        // Round to 6 decimals to kill float-multiply noise (e.g. 0.030065999...).
        const round6 = (n) => Math.round(n * 1_000_000) / 1_000_000;
        const entry = {
            timestamp: Date.now(),
            jobId: args.jobId,
            projectId: args.projectId,
            targetLanguage: args.targetLanguage,
            model: args.model,
            isBatch: args.isBatch,
            freshInputTokens: breakdown.freshInputTokens,
            cacheWriteTokens: breakdown.cacheWriteTokens,
            cacheReadTokens: breakdown.cacheReadTokens,
            outputTokens: breakdown.outputTokens,
            totalUsd: round6(breakdown.totalUsd),
            listUsd: round6(breakdown.listUsd),
        };
        if (!existsSync(dirname(COST_LOG_PATH))) {
            await mkdir(dirname(COST_LOG_PATH), { recursive: true });
        }
        await appendFile(COST_LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
        log().debug({
            jobId: args.jobId,
            projectId: args.projectId,
            targetLanguage: args.targetLanguage,
            model: args.model,
            isBatch: args.isBatch,
            totalUsd: breakdown.totalUsd,
        }, "Cost recorded");
        return entry;
    }
    catch (err) {
        log().warn({ error: err instanceof Error ? err.message : String(err) }, "Failed to record cost (non-fatal)");
        return undefined;
    }
}
async function readAllEntries() {
    if (!existsSync(COST_LOG_PATH))
        return [];
    const content = await readFile(COST_LOG_PATH, "utf-8");
    const out = [];
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            out.push(JSON.parse(trimmed));
        }
        catch {
            // Skip malformed lines
        }
    }
    return out;
}
const emptyAgg = () => ({
    calls: 0,
    freshInputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalUsd: 0,
    listUsd: 0,
});
function addInto(agg, e) {
    agg.calls++;
    agg.freshInputTokens += e.freshInputTokens;
    agg.cacheWriteTokens += e.cacheWriteTokens;
    agg.cacheReadTokens += e.cacheReadTokens;
    agg.outputTokens += e.outputTokens;
    agg.totalUsd += e.totalUsd;
    agg.listUsd += e.listUsd;
}
function fmtNum(n) {
    return n.toLocaleString("en-US");
}
function decorate(agg) {
    return {
        ...agg,
        totalUsdFormatted: formatUsd(agg.totalUsd),
        listUsdFormatted: formatUsd(agg.listUsd),
        freshInputTokensFormatted: fmtNum(agg.freshInputTokens),
        cacheReadTokensFormatted: fmtNum(agg.cacheReadTokens),
        outputTokensFormatted: fmtNum(agg.outputTokens),
    };
}
function decorateEntry(e) {
    return {
        ...e,
        timestampIso: new Date(e.timestamp).toISOString(),
        totalUsdFormatted: formatUsd(e.totalUsd),
    };
}
/** Render the aggregate as a plaintext block, suitable for `curl | less`. */
function renderText(total, byProjectAndLanguage, byProjectAndModel, projectName) {
    const lines = [];
    lines.push("─── Cost summary ───────────────────────────────────────");
    lines.push(`Calls         : ${fmtNum(total.calls)}`);
    lines.push(`Input tokens  : ${fmtNum(total.freshInputTokens)} (cache reads: ${fmtNum(total.cacheReadTokens)})`);
    lines.push(`Output tokens : ${fmtNum(total.outputTokens)}`);
    lines.push(`Total         : ${formatUsd(total.totalUsd)}`);
    if (total.totalUsd !== total.listUsd) {
        const saved = total.listUsd - total.totalUsd;
        lines.push(`(list ${formatUsd(total.listUsd)}, saved ${formatUsd(saved)} via batch)`);
    }
    lines.push("");
    for (const [pid, langs] of Object.entries(byProjectAndLanguage)) {
        lines.push(`▸ ${projectName(pid)}  (${pid})`);
        // Sort languages by spend, biggest first
        const sortedLangs = Object.entries(langs).sort((a, b) => b[1].totalUsd - a[1].totalUsd);
        for (const [lang, agg] of sortedLangs) {
            const avg = agg.calls > 0 ? agg.totalUsd / agg.calls : 0;
            lines.push(`   ${lang.padEnd(22)} ${formatUsd(agg.totalUsd).padStart(10)}  ` +
                `${fmtNum(agg.calls).padStart(5)} calls  ` +
                `(avg ${formatUsd(avg)}/call)`);
        }
        const models = byProjectAndModel[pid] ?? {};
        if (Object.keys(models).length) {
            const parts = Object.entries(models)
                .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
                .map(([m, agg]) => `${m} ${formatUsd(agg.totalUsd)}`);
            lines.push(`   models: ${parts.join(", ")}`);
        }
        lines.push("");
    }
    lines.push("Tip: use ?format=text on /cost for this view, ?projectId=… to scope, ?since=<ms-epoch> for windows.");
    return lines.join("\n");
}
export async function summarizeCosts(filter, projectNameLookup) {
    const all = await readAllEntries();
    const filtered = all.filter((e) => {
        if (filter?.projectId && e.projectId !== filter.projectId)
            return false;
        if (filter?.since && e.timestamp < filter.since)
            return false;
        if (filter?.until && e.timestamp > filter.until)
            return false;
        return true;
    });
    const total = emptyAgg();
    const byProjectRaw = {};
    const byProjectAndLanguageRaw = {};
    const byProjectAndModelRaw = {};
    for (const e of filtered) {
        addInto(total, e);
        const pKey = e.projectId ?? "_none";
        if (!byProjectRaw[pKey])
            byProjectRaw[pKey] = emptyAgg();
        addInto(byProjectRaw[pKey], e);
        if (!byProjectAndLanguageRaw[pKey])
            byProjectAndLanguageRaw[pKey] = {};
        const lKey = e.targetLanguage ?? "_none";
        if (!byProjectAndLanguageRaw[pKey][lKey])
            byProjectAndLanguageRaw[pKey][lKey] = emptyAgg();
        addInto(byProjectAndLanguageRaw[pKey][lKey], e);
        if (!byProjectAndModelRaw[pKey])
            byProjectAndModelRaw[pKey] = {};
        const mKey = `${e.model}${e.isBatch ? "+batch" : ""}`;
        if (!byProjectAndModelRaw[pKey][mKey])
            byProjectAndModelRaw[pKey][mKey] = emptyAgg();
        addInto(byProjectAndModelRaw[pKey][mKey], e);
    }
    const decorateMap = (raw, fn) => {
        const out = {};
        for (const [k, v] of Object.entries(raw))
            out[k] = fn(v);
        return out;
    };
    const byProject = decorateMap(byProjectRaw, decorate);
    const byProjectAndLanguage = {};
    for (const [pid, langs] of Object.entries(byProjectAndLanguageRaw)) {
        byProjectAndLanguage[pid] = decorateMap(langs, decorate);
    }
    const byProjectAndModel = {};
    for (const [pid, models] of Object.entries(byProjectAndModelRaw)) {
        byProjectAndModel[pid] = decorateMap(models, decorate);
    }
    const recent = filtered.slice(-50).reverse().map(decorateEntry);
    const lookup = projectNameLookup ?? ((id) => id);
    const formatted = renderText(total, byProjectAndLanguageRaw, byProjectAndModelRaw, lookup);
    return {
        total: decorate(total),
        byProject,
        byProjectAndLanguage,
        byProjectAndModel,
        recent,
        formatted,
    };
}
//# sourceMappingURL=cost-log.js.map