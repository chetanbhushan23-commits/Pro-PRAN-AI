"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HISTORY_DIR = path.join(__dirname, "data", "report-history");
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir() {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function fileFor(symbol) {
    const safe = String(symbol || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
    return path.join(HISTORY_DIR, `${safe}.json`);
}

function readHistory(symbol) {
    ensureDir();
    try {
        const raw = fs.readFileSync(fileFor(symbol), "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function prune(items) {
    const cutoff = Date.now() - RETENTION_MS;
    return items.filter(item => Date.parse(item.saved_at || 0) >= cutoff);
}

function canonicalJson(value) {
    return JSON.stringify(value, Object.keys(value || {}).sort());
}

function saveReport(symbol, payload) {
    ensureDir();
    const items = prune(readHistory(symbol));
    const savedAt = new Date().toISOString();
    const normalizedSymbol = String(symbol).toUpperCase();
    const data = payload.data || {};
    const report = String(payload.report || "");
    const dataHash = crypto.createHash("sha256").update(canonicalJson(data)).digest("hex");
    const reportHash = crypto.createHash("sha256").update(report).digest("hex");
    const record = {
        report_id: crypto.randomUUID(),
        saved_at: savedAt,
        symbol: normalizedSymbol,
        report: payload.report,
        data,
        traceability: {
            data_hash_sha256: dataHash,
            report_hash_sha256: reportHash,
            source_count: Array.isArray(data.sources) ? data.sources.length : 0,
            generated_at: data.traceability?.generated_at || savedAt,
            news_lookback_days: data.traceability?.news_lookback_days ?? 7,
            history_retention_days: 7,
        },
    };
    items.push(record);
    fs.writeFileSync(fileFor(symbol), JSON.stringify(items, null, 2), "utf8");
    return {
        report_id: record.report_id,
        saved_at: record.saved_at,
        retained_records: items.length,
        retention_days: 7,
        data_hash_sha256: dataHash,
        report_hash_sha256: reportHash,
    };
}

function getReports(symbol) {
    const items = prune(readHistory(symbol));
    fs.writeFileSync(fileFor(symbol), JSON.stringify(items, null, 2), "utf8");
    return {
        symbol: String(symbol).toUpperCase(),
        retention_days: 7,
        count: items.length,
        reports: items,
    };
}

module.exports = { saveReport, getReports };
