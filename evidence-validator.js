// =====================================================
// EVIDENCE VALIDATOR V2
// Indian Stock Research AI
// =====================================================

const TRUSTED_DOMAINS = {
  official: [
    "nseindia.com",
    "bseindia.com",
    "sebi.gov.in",
    "msei.in",
    "mcxindia.com"
  ],

  ratingAgencies: [
    "crisil.com",
    "icra.in",
    "careratings.com",
    "indiaratings.co.in",
    "spglobal.com",
    "moodys.com",
    "fitchratings.com"
  ],

  brokerages: [
    "ubs.com",
    "jpmorgan.com",
    "jefferies.com",
    "morganstanley.com",
    "goldmansachs.com"
  ],

  financialMedia: [
    "reuters.com",
    "bloomberg.com",
    "economictimes.indiatimes.com",
    "business-standard.com",
    "thehindubusinessline.com",
    "moneycontrol.com",
    "livemint.com",
    "financialexpress.com"
  ]
};

// -----------------------------------------------------
// Normalize
// -----------------------------------------------------

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// -----------------------------------------------------
// Get hostname
// -----------------------------------------------------

function getHostname(url) {

  if (!url) return null;

  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

// -----------------------------------------------------
// Domain match
// -----------------------------------------------------

function domainMatches(
  hostname,
  domains
) {

  if (!hostname) return false;

  return domains.some(domain =>
    hostname === domain ||
    hostname.endsWith("." + domain)
  );
}

// -----------------------------------------------------
// Detect source category
// -----------------------------------------------------

function detectSourceType(
  source,
  url
) {

  const sourceText =
    normalize(source);

  const hostname =
    getHostname(url);

  // Official

  if (
    TRUSTED_DOMAINS.official
      .some(domain =>
        hostname &&
        (
          hostname === domain ||
          hostname.endsWith("." + domain)
        )
      )
  ) {
    return "OFFICIAL";
  }

  // Rating agency

  if (
    TRUSTED_DOMAINS.ratingAgencies
      .some(domain =>
        hostname &&
        (
          hostname === domain ||
          hostname.endsWith("." + domain)
        )
      )
  ) {
    return "RATING_AGENCY";
  }

  // Brokerage

  if (
    TRUSTED_DOMAINS.brokerages
      .some(domain =>
        hostname &&
        (
          hostname === domain ||
          hostname.endsWith("." + domain)
        )
      )
  ) {
    return "BROKERAGE";
  }

  // Financial media

  if (
    TRUSTED_DOMAINS.financialMedia
      .some(domain =>
        hostname &&
        (
          hostname === domain ||
          hostname.endsWith("." + domain)
        )
      )
  ) {
    return "FINANCIAL_MEDIA";
  }

  // Fallback to source name

  if (
    sourceText.includes("nse") ||
    sourceText.includes("bse") ||
    sourceText.includes("sebi")
  ) {
    return "OFFICIAL";
  }

  if (
    sourceText.includes("crisil") ||
    sourceText.includes("icra") ||
    sourceText.includes("care ratings") ||
    sourceText.includes("india ratings") ||
    sourceText.includes("moodys") ||
    sourceText.includes("fitch")
  ) {
    return "RATING_AGENCY";
  }

  if (
    sourceText.includes("ubs") ||
    sourceText.includes("jpmorgan") ||
    sourceText.includes("jefferies") ||
    sourceText.includes("morgan stanley")
  ) {
    return "BROKERAGE";
  }

  if (
    sourceText.includes("reuters") ||
    sourceText.includes("bloomberg") ||
    sourceText.includes("economic times") ||
    sourceText.includes("business standard") ||
    sourceText.includes("businessline") ||
    sourceText.includes("moneycontrol")
  ) {
    return "FINANCIAL_MEDIA";
  }

  return "OTHER";
}

// -----------------------------------------------------
// Score
// -----------------------------------------------------

function sourceScore(type) {

  switch (type) {

    case "OFFICIAL":
      return 100;

    case "RATING_AGENCY":
      return 98;

    case "BROKERAGE":
      return 95;

    case "FINANCIAL_MEDIA":
      return 90;

    default:
      return 40;
  }
}

// -----------------------------------------------------
// URL validation
// -----------------------------------------------------

function validateUrl(url) {

  if (!url) {
    return {
      valid: false,
      hostname: null,
      reason: "URL missing"
    };
  }

  try {

    const parsed =
      new URL(url);

    const validProtocol =
      parsed.protocol === "http:" ||
      parsed.protocol === "https:";

    return {

      valid:
        validProtocol,

      hostname:
        parsed.hostname
          .toLowerCase()
          .replace(/^www\./, ""),

      reason:
        validProtocol
          ? null
          : "Invalid protocol"
    };

  } catch {

    return {
      valid: false,
      hostname: null,
      reason: "Invalid URL"
    };
  }
}

// -----------------------------------------------------
// Date validation
// -----------------------------------------------------

function validateDate(
  publishedAt
) {

  if (!publishedAt) {
    return {
      valid: false,
      date: null
    };
  }

  const date =
    new Date(publishedAt);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return {
      valid: false,
      date: null
    };
  }

  return {
    valid: true,
    date: date.toISOString()
  };
}

// -----------------------------------------------------
// Validate article
// -----------------------------------------------------

function validateArticle(
  article
) {

  const source =
    article?.source ||
    "Unknown";

  const title =
    String(
      article?.title || ""
    ).trim();

  const description =
    String(
      article?.description || ""
    ).trim();

  const urlResult =
    validateUrl(
      article?.url
    );

  const dateResult =
    validateDate(
      article?.publishedAt
    );

  const type =
    detectSourceType(
      source,
      article?.url
    );

  const score =
    sourceScore(type);

  const validTitle =
    title.length >= 10;

  const validDescription =
    description.length >= 10;

  const hasMetadata =
    validTitle &&
    dateResult.valid;

  const trustedDomain =
    type !== "OTHER";

  /*
   * Important:
   * A reputable publisher URL is enough to establish
   * source quality, but NOT enough to prove every claim.
   */

  const verifiedSource =
    score >= 90 &&
    trustedDomain &&
    urlResult.valid &&
    hasMetadata;

  return {

    source,

    sourceType:
      type,

    sourceScore:
      score,

    title,

    description,

    url:
      article?.url || null,

    hostname:
      urlResult.hostname,

    publishedAt:
      dateResult.date,

    urlValid:
      urlResult.valid,

    dateValid:
      dateResult.valid,

    trustedDomain,

    status:
      verifiedSource
        ? "VERIFIED_SOURCE"
        : "UNVERIFIED",

    canUseForSourceEvidence:
      verifiedSource,

    /*
     * Claim verification is separate.
     * A source being trusted does NOT automatically
     * prove the claim.
     */
    claimNeedsVerification:
      true
  };
}

// -----------------------------------------------------
// Validate news
// -----------------------------------------------------

function validateNews(
  articles = []
) {

  return articles
    .map(validateArticle)
    .sort(
      (a, b) =>
        b.sourceScore -
        a.sourceScore
    );
}

// -----------------------------------------------------
// Detect claim type
// -----------------------------------------------------

function detectClaimTypes(
  article
) {

  const text =
    normalize(
      `${article.title} ${article.description}`
    );

  const claims = [];

  // Brokerage

  if (
    text.includes("upgrade") ||
    text.includes("downgrade") ||
    text.includes("buy") ||
    text.includes("sell") ||
    text.includes("overweight") ||
    text.includes("underweight")
  ) {

    claims.push(
      "BROKERAGE_VIEW"
    );
  }

  // Target

  if (
    text.includes("target") ||
    text.includes("target price")
  ) {

    claims.push(
      "TARGET_PRICE"
    );
  }

  // Rating

  if (
    text.includes("rating")
  ) {

    claims.push(
      "RATING_ACTION"
    );
  }

  // Regulatory

  if (
    text.includes("sebi") ||
    text.includes("regulatory") ||
    text.includes("regulation") ||
    text.includes("proposal")
  ) {

    claims.push(
      "REGULATORY"
    );
  }

  return claims;
}

// -----------------------------------------------------
// Extract claims
// -----------------------------------------------------

function extractImportantClaims(
  articles = []
) {

  const claims = [];

  for (
    const article of articles
  ) {

    const types =
      detectClaimTypes(
        article
      );

    for (
      const type of types
    ) {

      claims.push({

        type,

        source:
          article.source,

        sourceType:
          article.sourceType,

        title:
          article.title,

        evidence:
          article.description,

        url:
          article.url,

        sourceVerified:
          article.canUseForSourceEvidence,

        /*
         * At this stage the source is verified.
         * The AI may use the article as evidence,
         * but must attribute the claim to the article.
         */

        verified:
          article.canUseForSourceEvidence,

        confidence:
          article.canUseForSourceEvidence
            ? "HIGH"
            : "LOW"
      });
    }
  }

  return claims;
}

// -----------------------------------------------------
// Build AI-safe evidence
// -----------------------------------------------------

function buildAISafeEvidence(
  articles = []
) {

  const validated =
    validateNews(
      articles
    );

  const claims =
    extractImportantClaims(
      validated
    );

  const safeClaims =
    claims.filter(
      claim =>
        claim.verified
    );

  return {

    totalArticles:
      validated.length,

    verifiedArticles:
      validated.filter(
        item =>
          item.status ===
          "VERIFIED_SOURCE"
      ),

    unverifiedArticles:
      validated.filter(
        item =>
          item.status !==
          "VERIFIED_SOURCE"
      ),

    importantClaims:
      claims,

    safeClaims,

    warnings:
      claims
        .filter(
          claim =>
            !claim.verified
        )
        .map(
          claim =>
            `Unverified source: ${claim.title}`
        )
  };
}

// -----------------------------------------------------
// Export
// -----------------------------------------------------

module.exports = {

  normalize,

  getHostname,

  domainMatches,

  detectSourceType,

  sourceScore,

  validateUrl,

  validateDate,

  validateArticle,

  validateNews,

  detectClaimTypes,

  extractImportantClaims,

  buildAISafeEvidence
};