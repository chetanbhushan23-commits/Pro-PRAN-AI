// =====================================================
// SOURCE VALIDATOR
// Trusted-source scoring for Indian Stock AI
// =====================================================

const SOURCE_SCORES = {
  "NSE": 100,
  "BSE": 100,
  "SEBI": 100,

  "MCX": 100,

  "CRISIL": 98,
  "ICRA": 98,
  "CARE Ratings": 98,
  "India Ratings": 98,

  "S&P": 98,
  "Moody's": 98,
  "Fitch": 98,

  "Reuters": 95,
  "Bloomberg": 95,

  "UBS": 92,
  "JPMorgan": 92,
  "Jefferies": 92,
  "Morgan Stanley": 92,
  "Goldman Sachs": 92,

  "Economic Times": 90,
  "Business Standard": 90,
  "BusinessLine": 90,
  "Moneycontrol": 88,

  "News API": 70,
  "Other": 50
};

// -----------------------------------------------------
// Normalize source name
// -----------------------------------------------------

function normalizeSource(source) {
  return String(source || "")
    .trim()
    .toLowerCase();
}

// -----------------------------------------------------
// Get source score
// -----------------------------------------------------

function getSourceScore(source) {

  const normalized =
    normalizeSource(source);

  for (const key of Object.keys(SOURCE_SCORES)) {

    if (
      normalized.includes(
        key.toLowerCase()
      )
    ) {
      return SOURCE_SCORES[key];
    }
  }

  return SOURCE_SCORES.Other;
}

// -----------------------------------------------------
// Source category
// -----------------------------------------------------

function getSourceCategory(source) {

  const score =
    getSourceScore(source);

  if (score >= 98) {
    return "OFFICIAL / RATING";
  }

  if (score >= 92) {
    return "BROKERAGE / INSTITUTION";
  }

  if (score >= 88) {
    return "MAJOR FINANCIAL MEDIA";
  }

  if (score >= 70) {
    return "NEWS";
  }

  return "OTHER";
}

// -----------------------------------------------------
// Validate article
// -----------------------------------------------------

function validateArticle(article) {

  const source =
    article?.source || "Other";

  const score =
    getSourceScore(source);

  return {
    ...article,

    sourceScore: score,

    sourceCategory:
      getSourceCategory(source),

    trusted:
      score >= 88
  };
}

// -----------------------------------------------------
// Validate news list
// -----------------------------------------------------

function validateNews(articles = []) {

  return articles
    .map(validateArticle)
    .sort(
      (a, b) =>
        b.sourceScore -
        a.sourceScore
    );
}

// -----------------------------------------------------
// Remove duplicate news
// -----------------------------------------------------

function deduplicateNews(
  articles = []
) {

  const seen = new Set();

  return articles.filter(article => {

    const key =
      String(article.title || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    if (!key) {
      return false;
    }

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

// -----------------------------------------------------
// Build trusted evidence
// -----------------------------------------------------

function buildTrustedEvidence(
  news = []
) {

  const unique =
    deduplicateNews(news);

  const validated =
    validateNews(unique);

  return {
    total: validated.length,

    trusted:
      validated.filter(
        item => item.trusted
      ),

    all: validated
  };
}

// -----------------------------------------------------
// Export
// -----------------------------------------------------

module.exports = {
  SOURCE_SCORES,
  getSourceScore,
  getSourceCategory,
  validateArticle,
  validateNews,
  deduplicateNews,
  buildTrustedEvidence
};