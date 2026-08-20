"use strict";
const fs = require("fs");
const path = require("path");

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
        return JSON.parse(raw);
    } catch (_) {
        return [];
    }
}

function prune(items) {
    const cutoff = Date.now() - RETENTION_MS;
    return items.filter(item => Date.parse(item.saved_at || 0) >= cutoff);
}

function saveReport(symbol, payload) {
    ensureDir();
    const items = prune(readHistory(symbol));
    const record = {
        saved_at: new Date().toISOString(),
        symbol: String(symbol).toUpperCase(),
        report: payload.report,
        data: payload.data,
    };
    items.push(record);
    fs.writeFileSync(fileFor(symbol), JSON.stringify(items, null, 2), "utf8");
    return { saved_at: record.saved_at, retained_records: items.length, retention_days: 7 };
}

function getReports(symbol) {
    const items = prune(readHistory(symbol));
    fs.writeFileSync(fileFor(symbol), JSON.stringify(items, null, 2), "utf8");
    return { symbol: String(symbol).toUpperCase(), retention_days: 7, reports: items };
}

module.exports = { saveReport, getReports };
