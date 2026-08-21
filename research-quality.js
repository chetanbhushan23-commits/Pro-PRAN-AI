// research-quality.js
"use strict";

function ageHours(value, now = Date.now()) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (now - ts) / 3600000);
}

function relevanceScore(article, symbol) {
  const text = `${article?.title || ""} ${article?.description || ""}`.toLowerCase();
  const clean = String(symbol || "").toLowerCase().replace(/\.(ns|bo)$/i, "");
  const aliases = {
    mcx: ["mcx", "multi commodity exchange"],
    hdfcbank: ["hdfc bank", "hdfcbank"],
    reliance: ["reliance industries", "reliance"],
    infy: ["infosys", "infy"],
    tcs: ["tcs", "tata consultancy services"],
  }[clean] || [clean];

  const direct = aliases.some(x => text.includes(x));
  const marketContext = /nifty|sensex|yield|crude|rupee|fed|geopolit|market|sector/.test(text);
  const companyEvent = /earnings|result|revenue|profit|margin|dividend|buyback|order|contract|listing|regulat|management|stake|promoter/.test(text);

  return {
    direct_company_match: direct,
    market_context: marketContext,
    company_event_signal: companyEvent,
    score: Math.min(100, (direct ? 60 : 0) + (companyEvent ? 25 : 0) + (marketContext ? 15 : 0)),
  };
}

function assessNews(articles, symbol, lookbackDays = 7) {
  const list = Array.isArray(articles) ? articles : [];
  const enriched = list.map(article => {
    const relevance = relevanceScore(article, symbol);
    const hours = ageHours(article.publishedAt);
    return {
      title: article.title || null,
      publisher: article.source || "Unknown publisher",
      provider: article.provider || "Unknown provider",
      published_at: article.publishedAt || null,
      url: article.url || null,
      age_hours: hours,
      freshness: hours == null ? "UNKNOWN" : hours <= 24 ? "VERY_RECENT" : hours <= 72 ? "RECENT" : "OLDER",
      ...relevance,
    };
  });

  const direct = enriched.filter(x => x.direct_company_match);
  const providers = [...new Set(enriched.map(x => x.provider).filter(Boolean))];
  const publishers = [...new Set(enriched.map(x => x.publisher).filter(Boolean))];
  const missingUrls = enriched.filter(x => !x.url).length;
  const avgRelevance = enriched.length ? enriched.reduce((sum, x) => sum + x.score, 0) / enriched.length : 0;

  let quality = 0;
  quality += Math.min(30, direct.length * 6);
  quality += Math.min(25, publishers.length * 5);
  quality += Math.min(20, providers.length * 10);
  quality += Math.min(15, enriched.filter(x => x.freshness === "VERY_RECENT" || x.freshness === "RECENT").length * 3);
  quality += Math.min(10, Math.round(avgRelevance / 10));
  quality = Math.min(100, quality);

  return {
    lookback_days: lookbackDays,
    article_count: enriched.length,
    directly_relevant_count: direct.length,
    publisher_count: publishers.length,
    provider_count: providers.length,
    missing_url_count: missingUrls,
    average_relevance_score: Number(avgRelevance.toFixed(1)),
    quality_score: quality,
    quality_label: quality >= 80 ? "HIGH" : quality >= 60 ? "MEDIUM" : quality > 0 ? "LOW" : "NO_DATA",
    articles: enriched,
  };
}

function assessDataCompleteness(quantData, sentimentData) {
  const required = [
    ["price", quantData?.technicals?.current_price],
    ["previous_close", quantData?.technicals?.previous_close],
    ["trend", quantData?.technicals?.trend],
    ["RSI_14", quantData?.technicals?.indicators?.RSI_14],
    ["EMA_20", quantData?.technicals?.indicators?.EMA_20],
    ["EMA_50", quantData?.technicals?.indicators?.EMA_50],
    ["EMA_200", quantData?.technicals?.indicators?.EMA_200],
    ["MACD_Histogram", quantData?.technicals?.indicators?.MACD_Histogram],
    ["Volume_Ratio", quantData?.technicals?.indicators?.Volume_Ratio],
    ["market_cap", quantData?.fundamentals?.values?.market_cap],
    ["PE_ratio", quantData?.fundamentals?.values?.PE_ratio],
    ["PB_ratio", quantData?.fundamentals?.values?.PB_ratio],
    ["debt_to_equity", quantData?.fundamentals?.values?.debt_to_equity],
  ];
  const available = required.filter(([, value]) => value !== null && value !== undefined).length;
  const newsCount = sentimentData?.articles?.length || 0;
  return {
    available_fields: available,
    total_core_fields: required.length,
    completeness_percent: Number((available / required.length * 100).toFixed(1)),
    unavailable_fields: required.filter(([, value]) => value === null || value === undefined).map(([name]) => name),
    news_articles: newsCount,
    status: available === required.length ? "COMPLETE" : "PARTIAL",
  };
}

function buildResearchQuality(symbol, quantData, sentimentData) {
  const news = assessNews(sentimentData?.articles || [], symbol, sentimentData?.lookback_days || 7);
  const data = assessDataCompleteness(quantData, sentimentData);
  const warnings = [];
  if (news.directly_relevant_count === 0) warnings.push("No directly company-matched news was found; market-context articles should not be treated as company-specific events.");
  if (data.unavailable_fields.length) warnings.push(`Unavailable fields remain N/A: ${data.unavailable_fields.join(", ")}.`);
  if (news.provider_count < 2) warnings.push("News provider diversity is limited.");

  return {
    generated_at: new Date().toISOString(),
    symbol,
    overall_status: data.completeness_percent >= 75 && news.quality_score >= 60 ? "GOOD" : "LIMITED",
    data_completeness: data,
    news_quality: news,
    warnings,
    methodology: "Scores describe evidence quality and completeness; they do not predict returns and do not replace the deterministic quant score.",
  };
}

module.exports = { buildResearchQuality, assessNews, assessDataCompleteness };
