"use strict";

/**
 * Step 6 — Decision-grade risk engine.
 * Deterministic and evidence-first: it never invents targets, support,
 * resistance, OI/F&O, sector or macro facts that are not present in input.
 */

function finite(v) {
    return typeof v === "number" && Number.isFinite(v);
}

function clamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, v));
}

function buildDecisionRisk(symbol, quantData, sentimentData = {}, researchQuality = {}) {
    const t = quantData?.technicals || {};
    const i = t.indicators || {};
    const f = quantData?.fundamentals?.values || {};

    const warnings = [];
    const riskFactors = [];
    let risk = 50;

    if (finite(i.RSI_14)) {
        if (i.RSI_14 >= 70) { risk += 15; riskFactors.push("RSI is in overbought territory."); }
        else if (i.RSI_14 >= 65) { risk += 8; riskFactors.push("RSI is elevated; momentum is strong but pullback risk is higher."); }
        else if (i.RSI_14 < 30) { risk += 12; riskFactors.push("RSI is oversold; downside momentum may be stretched, but reversal is not guaranteed."); }
    } else warnings.push("RSI unavailable.");

    if (finite(i.Volume_Ratio)) {
        if (i.Volume_Ratio >= 1.5) risk -= 5;
        else if (i.Volume_Ratio < 0.75) { risk += 7; riskFactors.push("Volume confirmation is weak versus the recent average."); }
    } else warnings.push("Volume ratio unavailable.");

    if (finite(i.MACD_Histogram)) {
        if (i.MACD_Histogram > 0) risk -= 5;
        else if (i.MACD_Histogram < 0) { risk += 8; riskFactors.push("MACD histogram is negative."); }
    } else warnings.push("MACD histogram unavailable.");

    const price = t.current_price;
    const ema20 = i.EMA_20;
    const ema50 = i.EMA_50;
    const ema200 = i.EMA_200;
    if ([price, ema20, ema50, ema200].every(finite)) {
        if (price > ema20 && ema20 > ema50 && ema50 > ema200) risk -= 10;
        else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
            risk += 15;
            riskFactors.push("Price and moving averages show a bearish stacked structure.");
        } else {
            risk += 3;
            riskFactors.push("Moving-average structure is mixed.");
        }
    } else warnings.push("Complete EMA structure unavailable.");

    if (finite(f.debt_to_equity)) {
        if (f.debt_to_equity > 2) { risk += 10; riskFactors.push("Debt/equity is elevated."); }
        else if (f.debt_to_equity < 0.5) risk -= 3;
    } else warnings.push("Debt/equity unavailable.");

    const newsScore = finite(sentimentData.score) ? sentimentData.score : null;
    if (newsScore != null) {
        if (newsScore <= 3) { risk += 8; riskFactors.push("News sentiment score is weak."); }
        else if (newsScore >= 8) risk -= 4;
    } else warnings.push("News sentiment score unavailable.");

    const quality = finite(researchQuality?.news_quality?.quality_score)
        ? researchQuality.news_quality.quality_score : null;
    if (quality != null && quality < 50) {
        risk += 8;
        riskFactors.push("Recent news evidence quality is limited.");
    }

    const riskScore = Math.round(clamp(risk));
    const riskLevel = riskScore >= 70 ? "HIGH" : riskScore >= 50 ? "MODERATE" : "LOW";

    const technicalTrend = String(t.trend || "UNKNOWN").toUpperCase();
    let action = "WAIT";
    if (technicalTrend === "BULLISH" && riskScore < 50) action = "BUY BIAS";
    else if (technicalTrend === "BEARISH" && riskScore >= 60) action = "SELL BIAS";
    else if (technicalTrend === "BULLISH") action = "BUY WITH CAUTION";
    else if (technicalTrend === "BEARISH") action = "SELL WITH CAUTION";

    const confidenceInputs = [finite(price), finite(i.RSI_14), finite(i.EMA_20), finite(i.EMA_50), finite(i.EMA_200), finite(i.MACD_Histogram), finite(i.Volume_Ratio), finite(f.debt_to_equity), newsScore != null, quality != null];
    const evidenceCoverage = Math.round(confidenceInputs.filter(Boolean).length / confidenceInputs.length * 100);
    const confidence = evidenceCoverage >= 80 ? "HIGH" : evidenceCoverage >= 60 ? "MEDIUM" : "LOW";

    if (warnings.length) warnings.unshift("Decision quality is limited by unavailable fields; no estimates were used.");

    return {
        generated_at: new Date().toISOString(),
        symbol: String(symbol || "").toUpperCase(),
        decision: {
            action,
            risk_score: riskScore,
            risk_level: riskLevel,
            confidence,
            evidence_coverage_percent: evidenceCoverage
        },
        risk_factors: [...new Set(riskFactors)],
        warnings: [...new Set(warnings)],
        guardrails: [
            "Do not treat BUY/SELL bias as a guaranteed return forecast.",
            "Do not generate a target or stop-loss unless price levels are supplied by a verified module.",
            "Do not infer support/resistance, OI/F&O, FII/DII, sector or macro conclusions from missing data.",
            "When evidence coverage is LOW, prefer WAIT over a high-conviction trade call."
        ]
    };
}

module.exports = { buildDecisionRisk };
