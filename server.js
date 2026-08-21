// server.js
"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { analyzeSentiment } = require("./sentiment.js");
const { saveReport, getReports } = require("./report-history.js");
const { buildResearchQuality } = require("./research-quality.js");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    : null;

const geminiModel = genAI
    ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
    : null;


/* =========================================================
   PYTHON QUANT PIPELINE
========================================================= */

function runPython(command, args) {
    return new Promise((resolve) => {
        execFile(
            command,
            args,
            {
                cwd: __dirname,
                timeout: 60000,
                maxBuffer: 5 * 1024 * 1024,
                windowsHide: true,
                env: process.env
            },
            (error, stdout, stderr) => {
                resolve({
                    error,
                    stdout: stdout || "",
                    stderr: stderr || "",
                    command
                });
            }
        );
    });
}


function parsePythonJson(stdout) {
    const text = String(stdout || "").trim();

    if (!text) {
        throw new Error("Python returned empty output");
    }

    try {
        return JSON.parse(text);
    } catch (_) {
        const lines = text
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean);

        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                return JSON.parse(lines[i]);
            } catch (_) {}
        }

        throw new Error(
            `Python output was not valid JSON: ${text.slice(0, 1000)}`
        );
    }
}


function normalizeInputSymbol(symbol) {
    return String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/\.NSE$/i, "")
        .replace(/\.NS$/i, "")
        .replace(/\.BSE$/i, "")
        .replace(/\.BO$/i, "")
        .replace(/[^A-Z0-9]/g, "");
}


async function getQuantData(symbol) {
    const safeSymbol = normalizeInputSymbol(symbol);

    if (!safeSymbol) {
        return {
            status: "FAILED",
            error: "Invalid stock symbol."
        };
    }

    const configuredPython = process.env.PYTHON_EXECUTABLE;

    const commands = configuredPython
        ? [configuredPython]
        : process.platform === "win32"
            ? ["python.exe", "py.exe", "python3.exe"]
            : ["python3", "python"];

    const pipelinePath = path.join(__dirname, "quant-pipeline.py");

    const attempts = [];

    for (const command of commands) {
        const result = await runPython(command, [
            pipelinePath,
            safeSymbol
        ]);

        attempts.push({
            command,
            exit_error: result.error
                ? result.error.message
                : null,
            stderr: result.stderr
                ? result.stderr.slice(0, 2000)
                : null
        });

        if (!result.error && result.stdout.trim()) {
            try {
                const parsed = parsePythonJson(result.stdout);

                if (parsed?.status === "SUCCESS") {
                    console.log(
                        `📊 Quant pipeline SUCCESS via ${command}: ${safeSymbol}`
                    );

                    return parsed;
                }

                attempts.push({
                    command,
                    pipeline_status: parsed?.status || "UNKNOWN",
                    pipeline_error: parsed?.error || null
                });

            } catch (parseError) {
                attempts.push({
                    command,
                    parse_error: parseError.message,
                    stdout: result.stdout.slice(0, 2000)
                });
            }
        }
    }

    console.error(
        "❌ Quant pipeline failed:",
        JSON.stringify(attempts, null, 2)
    );

    return {
        status: "FAILED",
        error: "Validated quant pipeline could not be executed successfully.",
        attempts,
        hint: "Run: python quant-pipeline.py SYMBOL"
    };
}


/* =========================================================
   VERIFIED TECHNICAL FACTS
========================================================= */

function buildVerifiedTechnicalFacts(quantData) {
    const t = quantData?.technicals;
    const i = t?.indicators;

    if (!t || !i) {
        return {
            status: "UNAVAILABLE"
        };
    }

    const price = t.current_price;
    const ema20 = i.EMA_20;
    const ema50 = i.EMA_50;
    const ema200 = i.EMA_200;

    const bullishStack =
        [price, ema20, ema50, ema200].every((v) => v != null) &&
        price > ema20 &&
        ema20 > ema50 &&
        ema50 > ema200;

    const bearishStack =
        [price, ema20, ema50, ema200].every((v) => v != null) &&
        price < ema20 &&
        ema20 < ema50 &&
        ema50 < ema200;

    return {
        status: "VERIFIED",

        price,

        previous_close: t.previous_close,

        trend: t.trend,

        ema_stack:
            bullishStack
                ? "BULLISH: Price > EMA20 > EMA50 > EMA200"
                : bearishStack
                    ? "BEARISH: Price < EMA20 < EMA50 < EMA200"
                    : "MIXED",

        rsi: i.RSI_14,

        macd_histogram: i.MACD_Histogram,

        volume_ratio: i.Volume_Ratio,

        hard_rule:
            bullishStack
                ? "Do not describe this setup as bearish or below moving averages."
                : bearishStack
                    ? "Do not describe this setup as bullish or above moving averages."
                    : "Describe the verified setup as mixed only."
    };
}


/* =========================================================
   DETERMINISTIC SCORE
========================================================= */

function buildDeterministicScore(quantData, sentimentData) {
    const i = quantData?.technicals?.indicators;
    const f = quantData?.fundamentals?.values;

    if (!i) {
        return {
            status: "INCOMPLETE",
            technical: null,
            fundamental: null,
            sentiment: null,
            market_sector: null
        };
    }

    let technical = 5;

    if (quantData.technicals.trend === "BULLISH") {
        technical += 2;
    }

    if (quantData.technicals.trend === "BEARISH") {
        technical -= 2;
    }

    if (
        i.RSI_14 != null &&
        i.RSI_14 >= 50 &&
        i.RSI_14 < 70
    ) {
        technical += 1;
    }

    if (
        i.RSI_14 != null &&
        i.RSI_14 < 30
    ) {
        technical -= 1;
    }

    if (
        i.MACD_Histogram != null &&
        i.MACD_Histogram > 0
    ) {
        technical += 1;
    }

    if (
        i.MACD_Histogram != null &&
        i.MACD_Histogram < 0
    ) {
        technical -= 1;
    }

    if (
        i.Volume_Ratio != null &&
        i.Volume_Ratio >= 1.5
    ) {
        technical += 1;
    }

    technical = Math.max(
        0,
        Math.min(10, technical)
    );

    let fundamental = null;

    if (
        f &&
        [
            f.PE_ratio,
            f.PB_ratio,
            f.ROE,
            f.debt_to_equity
        ].some((v) => v != null)
    ) {
        fundamental = 5;

        if (
            f.debt_to_equity != null &&
            f.debt_to_equity < 1
        ) {
            fundamental += 1.5;
        }

        if (
            f.ROE != null &&
            f.ROE >= 15
        ) {
            fundamental += 1.5;
        }

        if (
            f.PE_ratio != null &&
            f.PE_ratio > 0 &&
            f.PE_ratio < 35
        ) {
            fundamental += 1;
        }

        if (
            f.PB_ratio != null &&
            f.PB_ratio > 0 &&
            f.PB_ratio < 8
        ) {
            fundamental += 1;
        }

        fundamental = Math.min(
            10,
            fundamental
        );
    }

    return {
        status: "PARTIAL",

        technical: Number(
            technical.toFixed(2)
        ),

        fundamental:
            fundamental == null
                ? null
                : Number(fundamental.toFixed(2)),

        sentiment:
            sentimentData?.score ?? null,

        market_sector: null,

        note:
            "Unavailable components remain N/A; no estimates."
    };
}


/* =========================================================
   SOURCE COLLECTION
========================================================= */

function collectSources(
    quantData,
    sentimentData
) {
    const sources = [];

    if (quantData?.data_source?.url) {
        sources.push({
            ...quantData.data_source,
            type: "market_data"
        });
    }

    if (quantData?.fundamentals?.source?.url) {
        sources.push({
            ...quantData.fundamentals.source,
            type: "fundamentals"
        });
    }

    for (
        const article of sentimentData?.articles || []
    ) {
        if (!article.url) {
            continue;
        }

        sources.push({
            type: "news",

            provider:
                article.provider ||
                "News source",

            publisher:
                article.source ||
                "Unknown publisher",

            source_tier:
                article.source_tier ||
                "UNKNOWN",

            relevance:
                article.relevance ||
                "UNKNOWN",

            url:
                article.url,

            published_at:
                article.publishedAt ||
                null,

            retrieved_at:
                article.retrievedAt ||
                null,

            title:
                article.title ||
                null
        });
    }

    return sources;
}


/* =========================================================
   FALLBACK REPORT
========================================================= */

function buildFallbackReport(
    symbol,
    quantData,
    verified,
    score,
    sentimentData,
    sources,
    researchQuality
) {
    const i =
        quantData.technicals.indicators || {};

    const f =
        quantData.fundamentals?.values || {};

    const rec =
        score.technical >= 7
            ? "BUY"
            : score.technical <= 3
                ? "SELL"
                : "WAIT";

    const trace =
        sentimentData?.traceability || {};

    const newsLines =
        (sentimentData?.articles || [])
            .slice(0, 15)
            .map(
                (a, n) =>
                    `${n + 1}. **${a.title}** — ${a.source || "Unknown"} | ${a.relevance || "UNKNOWN"} | ${a.publishedAt || "date N/A"}\n   ${a.url}`
            )
            .join("\n");

    const sourceLines =
        sources.length
            ? sources
                .map(
                    (s, n) =>
                        `${n + 1}. ${s.provider || s.type} | ${s.publisher || ""} | ${s.relevance || ""} | ${s.url}${s.title ? ` — ${s.title}` : ""}`
                )
                .join("\n")
            : "- No verified source URL available";

    return `# ${symbol} — Verified Quant Research Report

## Executive Summary

- Recommendation: **${rec}**
- Evidence status: **${researchQuality.overall_status}**
- Data completeness: **${researchQuality.data_completeness.completeness_percent}%**
- Technical state: **${quantData.technicals.trend || "N/A"}**
- News sentiment: **${sentimentData?.sentiment || "N/A"} (${sentimentData?.score ?? "N/A"}/10)**
- News evidence quality: **${researchQuality.news_quality.quality_label} (${researchQuality.news_quality.quality_score}/100)**
- Research rule: only verified supplied data is used; missing fields remain N/A.

## Data Snapshot

- Price: ${quantData.technicals.current_price ?? "N/A"}
- Previous Close: ${quantData.technicals.previous_close ?? "N/A"}
- Trend: ${quantData.technicals.trend ?? "N/A"}
- RSI(14): ${i.RSI_14 ?? "N/A"}
- EMA20 / EMA50 / EMA200: ${i.EMA_20 ?? "N/A"} / ${i.EMA_50 ?? "N/A"} / ${i.EMA_200 ?? "N/A"}
- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}
- ATR(14): ${i.ATR_14 ?? "N/A"}
- Volume Ratio: ${i.Volume_Ratio ?? "N/A"}

## Technical Analysis

- Verified EMA structure: ${verified.ema_stack}
- RSI: ${i.RSI_14 ?? "N/A"}
- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}
- Volume ratio: ${i.Volume_Ratio ?? "N/A"}

## Fundamentals

- Market Cap: ${f.market_cap ?? "N/A"}
- PE: ${f.PE_ratio ?? "N/A"}
- PB: ${f.PB_ratio ?? "N/A"}
- ROE: ${f.ROE ?? "N/A"}
- Debt/Equity: ${f.debt_to_equity ?? "N/A"}

## Verified News & Sentiment — Last 7 Days

${sentimentData?.summary || "No verified recent news available."}

- Direct company articles: ${trace.direct_company_articles ?? "N/A"}
- Market-context articles: ${trace.market_context_articles ?? "N/A"}
- Tier-1 publisher articles: ${trace.tier1_articles ?? "N/A"}
- NewsAPI articles: ${trace.newsapi_articles ?? "N/A"}
- Google News discovery/context articles: ${trace.google_news_articles ?? "N/A"}

${newsLines || "No verified articles available."}

## Research Quality & Traceability

- Directly relevant news: ${researchQuality.news_quality.directly_relevant_count}/${researchQuality.news_quality.article_count}
- Publishers: ${researchQuality.news_quality.publisher_count}
- Providers: ${researchQuality.news_quality.provider_count}
- Average relevance: ${researchQuality.news_quality.average_relevance_score}/100
- Warnings: ${researchQuality.warnings.length ? researchQuality.warnings.join(" | ") : "None"}

## Risk Factors & Conflicting Signals

${
    (sentimentData?.negative_drivers || [])
        .map((x) => `- ${x}`)
        .join("\n") ||
    "- No model-generated negative driver available."
}

${
    (sentimentData?.conflicting_signals || [])
        .map((x) => `- Conflict: ${x}`)
        .join("\n") ||
    "- No conflicting signal reported by the news model."
}

## Quant Score

- Technical: ${score.technical ?? "N/A"}/10
- Fundamental: ${score.fundamental ?? "N/A"}/10
- Sentiment: ${score.sentiment ?? "N/A"}/10
- Market/Sector: N/A

## Final Recommendation

**${rec}** — based only on verified data. This is not a guarantee of future returns.

## Source Traceability

${sourceLines}
`;
}


/* =========================================================
   ANALYZE API
========================================================= */

app.get(
    "/api/analyze",
    async (req, res) => {
        const symbol =
            String(req.query.symbol || "")
                .trim()
                .toUpperCase();

        if (!symbol) {
            return res.status(400).json({
                success: false,
                error: "Stock symbol is required."
            });
        }

        console.log(
            `\n🚀 UI Request Received for: ${symbol}`
        );

        try {
            const quantData =
                await getQuantData(symbol);

            let sentimentData;

            try {
                sentimentData =
                    await analyzeSentiment(symbol);

            } catch (e) {
                sentimentData = {
                    sentiment: "N/A",
                    score: null,
                    summary:
                        "News sentiment unavailable.",
                    articles: [],
                    source_status: "UNAVAILABLE",
                    error: e.message
                };
            }

            if (
                !quantData ||
                quantData.status !== "SUCCESS"
            ) {
                console.error(
                    "❌ Validated quant data unavailable:",
                    JSON.stringify(
                        quantData,
                        null,
                        2
                    )
                );

                return res.status(502).json({
                    success: false,
                    error:
                        "Validated market data unavailable. Report generation stopped.",
                    quantData
                });
            }

            const verifiedTechnicalFacts =
                buildVerifiedTechnicalFacts(
                    quantData
                );

            const deterministicScore =
                buildDeterministicScore(
                    quantData,
                    sentimentData
                );

            const researchQuality =
                buildResearchQuality(
                    symbol,
                    quantData,
                    sentimentData
                );

            const sources =
                collectSources(
                    quantData,
                    sentimentData
                );

            const fullContext = {
                symbol,

                quantData,

                verifiedTechnicalFacts,

                deterministicScore,

                sentimentData,

                sources,

                researchQuality,

                traceability: {
                    news_lookback_days: 7,

                    generated_at:
                        new Date().toISOString(),

                    history_retention_days: 7
                }
            };

            let finalReport;

            if (geminiModel) {
                try {
                    const systemPrompt = `
You are an evidence-first Indian Stock Market Quant Research Analyst.

Analyze ONLY the supplied JSON for ${symbol}.

Never invent or estimate.

null means N/A.

Never claim Dhan.

Never contradict verifiedTechnicalFacts.

Never manufacture 52-week, OI/F&O, FII/DII, sector, support/resistance, targets, market-share, earnings, macro or regulatory claims unless supplied.

News claims ONLY from supplied articles.

Treat DIRECT_COMPANY articles as primary relevance and MARKET_CONTEXT as contextual evidence.

Treat TIER_1 publishers as higher-quality than DISCOVERY results, but do not call a discovery article false merely because of its tier.

Distinguish directly company-specific news from broader market or sector news.

Use researchQuality as an evidence-quality signal, not as a return forecast.

If sources conflict, report the conflict instead of choosing an unsupported side.

Every important number must be sourced or clearly described as calculated from supplied Yahoo Finance OHLCV.

Do not create a complete score when components are unavailable.

Produce a deep, readable report with:

Executive Summary

Data Snapshot

Technical Analysis

Fundamental Analysis

Business/Market Context only when supplied

Verified News & Sentiment (last 7 days with publisher/date/relevance/provider/URL)

Positive Drivers

Negative Drivers & Conflicting Signals

Research Quality & Traceability

Risk Factors

Quant Score

Final Recommendation

Numbered Source Traceability section

Explicitly mention missing data and evidence limitations.

Keep source URLs intact.

Use simple Hinglish where useful.

RAW VERIFIED DATA:

${JSON.stringify(
    fullContext,
    null,
    2
)}
`;

                    const result =
                        await geminiModel.generateContent(
                            systemPrompt
                        );

                    finalReport =
                        result.response.text();

                } catch (aiError) {
                    console.error(
                        "⚠️ Gemini failed; using deterministic verified report:",
                        aiError.message
                    );

                    finalReport =
                        buildFallbackReport(
                            symbol,
                            quantData,
                            verifiedTechnicalFacts,
                            deterministicScore,
                            sentimentData,
                            sources,
                            researchQuality
                        );
                }

            } else {
                finalReport =
                    buildFallbackReport(
                        symbol,
                        quantData,
                        verifiedTechnicalFacts,
                        deterministicScore,
                        sentimentData,
                        sources,
                        researchQuality
                    );
            }

            const history =
                saveReport(
                    symbol,
                    {
                        report: finalReport,
                        data: fullContext
                    }
                );

            res.json({
                success: true,
                report: finalReport,
                data: fullContext,
                history
            });

            console.log(
                `✅ Source-backed deep report sent and saved for ${symbol}`
            );

        } catch (error) {
            console.error(
                "API Error:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "AI Engine failed to generate report.",
                detail: error.message
            });
        }
    }
);


/* =========================================================
   RESEARCH QUALITY API
========================================================= */

app.get(
    "/api/research-quality",
    async (req, res) => {
        const symbol =
            String(req.query.symbol || "")
                .trim()
                .toUpperCase();

        if (!symbol) {
            return res.status(400).json({
                success: false,
                error: "Stock symbol is required."
            });
        }

        try {
            const quantData =
                await getQuantData(symbol);

            if (
                !quantData ||
                quantData.status !== "SUCCESS"
            ) {
                return res.status(502).json({
                    success: false,
                    error:
                        "Validated market data unavailable.",
                    quantData
                });
            }

            let sentimentData;

            try {
                sentimentData =
                    await analyzeSentiment(symbol);

            } catch (e) {
                sentimentData = {
                    articles: [],
                    lookback_days: 7,
                    error: e.message
                };
            }

            return res.json({
                success: true,

                researchQuality:
                    buildResearchQuality(
                        symbol,
                        quantData,
                        sentimentData
                    )
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   HISTORY API
========================================================= */

app.get(
    "/api/history",
    (req, res) => {
        const symbol =
            String(req.query.symbol || "")
                .trim()
                .toUpperCase();

        if (!symbol) {
            return res.status(400).json({
                success: false,
                error: "Stock symbol is required."
            });
        }

        try {
            return res.json({
                success: true,
                ...getReports(symbol)
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) =>
        res.json({
            success: true,

            server: "running",

            data_engine:
                "validated-python-yahoo",

            dhan_dependency: false,

            news_lookback_days: 7,

            history_enabled: true,

            research_quality_enabled: true
        })
);


/* =========================================================
   SERVER START
========================================================= */

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {
        console.log(
            `\n======================================`
        );

        console.log(
            `🌐 AI TRADING SERVER RUNNING ON PORT ${PORT}`
        );

        console.log(
            `📊 Data engine: validated quant-pipeline.py`
        );

        console.log(
            `📰 News: NewsAPI + Google News RSS (7-day)`
        );

        console.log(
            `🔎 Research quality: relevance + freshness + source diversity`
        );

        console.log(
            `💾 Report history: 7-day local traceability store`
        );

        console.log(
            `🚫 Dhan dependency: OFF`
        );

        console.log(
            `======================================\n`
        );
    }
);