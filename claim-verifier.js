// claim-verifier.js
// ============================================================
// CLAIM VERIFIER V4
// Indian Stock Research Evidence Verification Engine
//
// V4 Improvements:
// 1. Broker-specific evidence matching
// 2. Target-price association with correct institution
// 3. Rating/action association with correct institution
// 4. Regulatory claim verification
// 5. Negative/mismatched claim protection
// 6. Sentence-level + nearby-context verification
// 7. Better target-price extraction
// 8. Prevents unrelated numbers from becoming targets
// 9. Confidence + score based verification
// 10. Backward compatible with research-data-engine.js
// ============================================================

"use strict";

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  HIGH_SCORE: 85,
  MEDIUM_SCORE: 60,
  LOW_SCORE: 40,

  CONTEXT_WINDOW: 1000,
  SENTENCE_WINDOW: 4,

  MIN_TARGET_PRICE: 50,
  MAX_TARGET_PRICE: 1000000,

  // ----------------------------------------------------------
  // Financial institutions / brokerages
  // ----------------------------------------------------------

  institutions: [
    "ubs",
    "jpmorgan",
    "jp morgan",
    "jefferies",
    "morgan stanley",
    "goldman sachs",
    "morgan stanley",
    "motilal oswal",
    "motilal oswal financial services",
    "icici securities",
    "hdfc securities",
    "kotak securities",
    "axis securities",
    "nuvama",
    "nuvama wealth",
    "yes securities",
    "prabhudas lilladher",
    "sharekhan",
    "angel one",
    "iifl securities",
    "edelweiss",
    "citi",
    "citigroup",
    "nomura",
    "macquarie",
    "bernstein",
    "hsbc",
    "clsa",
    "jp morgan",
    "bank of america",
    "bofa",
    "credit suisse",
    "barclays",
    "sanford c bernstein",
    "icici direct",
    "axis capital",
    "emkay",
    "emkay global",
    "ambit",
    "incred",
    "prabhudas lilladher",
    "pl capital",
    "ventura",
    "geojit",
    "sbi securities",
    "sharekhan by bnp paribas",
    "dolat capital",
    "jm financial",
    "jm financial services",
    "systematix",
    "choice broking",
    "ashika",
    "anand rathi",
    "anand rathi securities",
    "religare",
    "arihant capital",
    "prakash gabu",
    "keynote capital"
  ],

  // ----------------------------------------------------------
  // Regulators / exchanges
  // ----------------------------------------------------------

  regulators: [
    "sebi",
    "securities and exchange board of india",
    "rbi",
    "reserve bank of india",
    "irda",
    "irdai",
    "pfrda",
    "cci",
    "competition commission of india",
    "nse",
    "bse",
    "mcx",
    "cdsl",
    "nsdl"
  ],

  // ----------------------------------------------------------
  // Ratings
  // ----------------------------------------------------------

  ratings: [
    "strong buy",
    "buy",
    "overweight",
    "outperform",
    "accumulate",
    "add",
    "hold",
    "neutral",
    "market perform",
    "underweight",
    "sell",
    "strong sell",
    "reduce"
  ],

  // ----------------------------------------------------------
  // Upgrade words
  // ----------------------------------------------------------

  upgradeWords: [
    "upgrade",
    "upgraded",
    "upgrades",
    "raised",
    "raises",
    "hiked",
    "increased",
    "improved",
    "moved to",
    "reiterated"
  ],

  // ----------------------------------------------------------
  // Downgrade words
  // ----------------------------------------------------------

  downgradeWords: [
    "downgrade",
    "downgraded",
    "downgrades",
    "cut",
    "cuts",
    "lowered",
    "lowers",
    "reduced",
    "reduction",
    "moved to sell",
    "slashed"
  ],

  // ----------------------------------------------------------
  // Target words
  // ----------------------------------------------------------

  targetWords: [
    "target price",
    "target",
    "price target",
    "tp",
    "target of",
    "target at",
    "target to",
    "targeted",
    "targeting"
  ],

  // ----------------------------------------------------------
  // Regulatory actions
  // ----------------------------------------------------------

  regulatoryActionWords: [
    "proposal",
    "proposed",
    "proposes",
    "approved",
    "approval",
    "notification",
    "circular",
    "directive",
    "rule",
    "rules",
    "regulation",
    "regulations",
    "allow",
    "allowed",
    "allowing",
    "permit",
    "permitted",
    "access",
    "widen",
    "widening",
    "expand",
    "expanded",
    "introduced",
    "announced",
    "mandate",
    "restriction",
    "restrictions",
    "ban",
    "banned",
    "relax",
    "relaxed",
    "amendment",
    "amended",
    "notified",
    "notification",
    "eased",
    "ease"
  ]
};

// ============================================================
// BASIC HELPERS
// ============================================================

function cleanText(value) {
  if (!value) return "";

  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[₹,$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------

function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

// ------------------------------------------------------------

function containsAny(text, words) {
  const normalized = normalizeText(text);

  return words.some(word => {
    const pattern = new RegExp(
      `\\b${escapeRegExp(
        word.toLowerCase()
      )}\\b`,
      "i"
    );

    return pattern.test(normalized);
  });
}

// ------------------------------------------------------------

function findMatches(text, words) {
  const normalized = normalizeText(text);
  const found = [];

  for (const word of words) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(
        word.toLowerCase()
      )}\\b`,
      "i"
    );

    if (pattern.test(normalized)) {
      found.push(word);
    }
  }

  return [...new Set(found)];
}

// ============================================================
// SENTENCE SPLITTING
// ============================================================

function splitSentences(text) {
  const source = cleanText(text);

  if (!source) return [];

  return source
    .split(
      /(?<=[.!?])\s+(?=[A-Z₹Rs])/g
    )
    .map(x => x.trim())
    .filter(Boolean);
}

// ============================================================
// INSTITUTION DETECTION
// ============================================================

function detectInstitutions(text) {
  const normalized = normalizeText(text);

  const found = [];

  for (const name of CONFIG.institutions) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(
        name.toLowerCase()
      )}\\b`,
      "i"
    );

    if (pattern.test(normalized)) {
      found.push(name);
    }
  }

  return [...new Set(found)];
}

// ============================================================
// REGULATOR DETECTION
// ============================================================

function detectRegulators(text) {
  const normalized = normalizeText(text);

  const found = [];

  for (const name of CONFIG.regulators) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(
        name.toLowerCase()
      )}\\b`,
      "i"
    );

    if (pattern.test(normalized)) {
      found.push(name);
    }
  }

  return [...new Set(found)];
}

// ============================================================
// RATING DETECTION
// ============================================================

function detectRatings(text) {
  const normalized = normalizeText(text);

  const found = [];

  // Longer ratings first
  const ratings = [
    ...CONFIG.ratings
  ].sort(
    (a, b) =>
      b.length - a.length
  );

  for (const rating of ratings) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(
        rating.toLowerCase()
      )}\\b`,
      "i"
    );

    if (pattern.test(normalized)) {
      found.push(
        rating.toUpperCase()
      );
    }
  }

  return [...new Set(found)];
}

// ============================================================
// ACTION DETECTION
// ============================================================

function detectActions(text) {
  return {
    upgrades: findMatches(
      text,
      CONFIG.upgradeWords
    ),

    downgrades: findMatches(
      text,
      CONFIG.downgradeWords
    )
  };
}

// ============================================================
// FIND INSTITUTION IN TEXT
// ============================================================

function findInstitutionPosition(
  text,
  institution
) {
  const source = cleanText(text);

  const pattern = new RegExp(
    `\\b${escapeRegExp(
      institution
    )}\\b`,
    "i"
  );

  const match =
    pattern.exec(source);

  return match
    ? match.index
    : -1;
}

// ============================================================
// NORMALIZE INSTITUTION NAME
// ============================================================

function normalizeInstitutionName(
  value
) {
  if (!value) return "";

  return normalizeText(value)
    .replace(
      "financial services",
      ""
    )
    .replace(
      "wealth",
      ""
    )
    .replace(
      "global",
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// INSTITUTION MATCH
// ============================================================

function institutionMatches(
  claimSource,
  detectedInstitution
) {
  const a =
    normalizeInstitutionName(
      claimSource
    );

  const b =
    normalizeInstitutionName(
      detectedInstitution
    );

  if (!a || !b) return false;

  return (
    a === b ||
    a.includes(b) ||
    b.includes(a)
  );
}

// ============================================================
// GET INSTITUTION-SPECIFIC CONTEXT
//
// IMPORTANT:
// This is the main V4 protection.
//
// We don't verify UBS claims against JPMorgan
// evidence elsewhere in the article.
// ============================================================

function getInstitutionContext(
  articleText,
  institution,
  windowSize = CONFIG.CONTEXT_WINDOW
) {
  const text = cleanText(
    articleText
  );

  if (!text || !institution) {
    return "";
  }

  const index =
    findInstitutionPosition(
      text,
      institution
    );

  if (index < 0) {
    return "";
  }

  return text.slice(
    Math.max(
      0,
      index - windowSize
    ),
    Math.min(
      text.length,
      index + windowSize
    )
  );
}

// ============================================================
// GET SENTENCE CONTEXT
// ============================================================

function getSentenceContext(
  articleText,
  keyword,
  radius = 2
) {
  const sentences =
    splitSentences(
      articleText
    );

  if (!sentences.length) {
    return "";
  }

  const normalizedKeyword =
    normalizeText(keyword);

  let index = -1;

  for (
    let i = 0;
    i < sentences.length;
    i++
  ) {
    if (
      normalizeText(
        sentences[i]
      ).includes(
        normalizedKeyword
      )
    ) {
      index = i;
      break;
    }
  }

  if (index < 0) {
    return "";
  }

  return sentences
    .slice(
      Math.max(
        0,
        index - radius
      ),
      Math.min(
        sentences.length,
        index + radius + 1
      )
    )
    .join(" ");
}

// ============================================================
// CLAIM CONTEXT
// ============================================================

function getClaimContext(
  articleText,
  claim,
  windowSize = 900
) {
  const text =
    cleanText(articleText);

  if (!text) return "";

  const claimText =
    normalizeText(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    );

  const keywords =
    claimText
      .split(/\s+/)
      .filter(
        x => x.length >= 4
      )
      .slice(0, 20);

  let bestIndex = -1;

  for (const keyword of keywords) {
    const index =
      normalizeText(text).indexOf(
        keyword
      );

    if (index >= 0) {
      bestIndex = index;
      break;
    }
  }

  if (bestIndex < 0) {
    return text.slice(
      0,
      windowSize * 2
    );
  }

  return text.slice(
    Math.max(
      0,
      bestIndex - windowSize
    ),
    Math.min(
      text.length,
      bestIndex + windowSize
    )
  );
}

// ============================================================
// TARGET PRICE EXTRACTION V4
//
// Only numbers in target-price context.
// ============================================================

function extractTargetPrices(text) {
  const source =
    cleanText(text);

  const results = [];

  if (!source) {
    return results;
  }

  const patterns = [

    // target price of Rs 3,800
    /(?:target\s*price|price\s*target)\s*(?:of|at|to|:|-)?\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)/gi,

    // target of Rs 3,800
    /(?:target)\s*(?:of|at|to|:|-)?\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)/gi,

    // target: ₹3,800
    /(?:target)\s*:\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)/gi,

    // TP 3800
    /(?:\btp\b)\s*(?:of|at|to|:|-)?\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)/gi,

    // Rs 3,800 target
    /(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:target|price\s*target)/gi
  ];

  for (
    const pattern of patterns
  ) {
    let match;

    while (
      (match =
        pattern.exec(source)) !== null
    ) {
      const raw =
        match[1];

      if (!raw) continue;

      const value =
        Number(
          raw.replace(/,/g, "")
        );

      if (
        !Number.isFinite(value)
      ) {
        continue;
      }

      if (
        value <
        CONFIG.MIN_TARGET_PRICE
      ) {
        continue;
      }

      if (
        value >
        CONFIG.MAX_TARGET_PRICE
      ) {
        continue;
      }

      const context =
        source.slice(
          Math.max(
            0,
            match.index - 180
          ),
          Math.min(
            source.length,
            match.index +
              match[0].length +
              220
          )
        );

      results.push({
        value,
        raw,
        index:
          match.index,
        context:
          context.trim()
      });
    }
  }

  // ----------------------------------------------------------
  // Remove duplicates
  // ----------------------------------------------------------

  const unique = [];

  for (
    const item of results
  ) {
    const exists =
      unique.some(
        existing =>
          existing.value ===
            item.value &&
          Math.abs(
            existing.index -
              item.index
          ) < 25
      );

    if (!exists) {
      unique.push(item);
    }
  }

  return unique;
}

// ============================================================
// EXTRACT TARGETS NEAR INSTITUTION
// ============================================================

function extractInstitutionTargets(
  articleText,
  institution
) {
  const context =
    getInstitutionContext(
      articleText,
      institution
    );

  if (!context) {
    return [];
  }

  return extractTargetPrices(
    context
  );
}

// ============================================================
// TARGET MATCH CLAIM
// ============================================================

function targetMatchesClaim(
  claim,
  articleText
) {
  const claimText =
    `${claim.title || ""} ${
      claim.evidence || ""
    }`;

  const claimTargets =
    extractTargetPrices(
      claimText
    );

  const articleTargets =
    extractTargetPrices(
      articleText
    );

  if (
    !claimTargets.length
  ) {
    return {
      match: false,
      detected:
        articleTargets.map(
          x => x.value
        ),
      matched: []
    };
  }

  const claimValues =
    claimTargets.map(
      x => x.value
    );

  const matched =
    articleTargets.filter(
      x =>
        claimValues.includes(
          x.value
        )
    );

  return {
    match:
      matched.length > 0,

    detected:
      articleTargets.map(
        x => x.value
      ),

    matched
  };
}

// ============================================================
// INSTITUTION-SPECIFIC TARGET MATCH
// ============================================================

function institutionTargetMatchesClaim(
  claim,
  articleText,
  institution
) {
  const context =
    getInstitutionContext(
      articleText,
      institution
    );

  const targets =
    extractTargetPrices(
      context
    );

  const claimTargets =
    extractTargetPrices(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    );

  if (
    !targets.length ||
    !claimTargets.length
  ) {
    return {
      match: false,
      detected:
        targets.map(
          x => x.value
        ),
      matched: []
    };
  }

  const claimValues =
    claimTargets.map(
      x => x.value
    );

  const matched =
    targets.filter(
      x =>
        claimValues.includes(
          x.value
        )
    );

  return {
    match:
      matched.length > 0,

    detected:
      targets.map(
        x => x.value
      ),

    matched
  };
}

// ============================================================
// RATING ASSOCIATION
//
// Checks whether rating is connected to same institution.
// ============================================================

function getInstitutionRatingEvidence(
  articleText,
  institution
) {
  const context =
    getInstitutionContext(
      articleText,
      institution
    );

  if (!context) {
    return {
      context: "",
      ratings: [],
      actions: {
        upgrades: [],
        downgrades: []
      }
    };
  }

  return {
    context,

    ratings:
      detectRatings(
        context
      ),

    actions:
      detectActions(
        context
      )
  };
}

// ============================================================
// CLAIM RATING EXTRACTION
// ============================================================

function extractClaimRatings(
  claim
) {
  return detectRatings(
    `${claim.title || ""} ${
      claim.evidence || ""
    }`
  );
}

// ============================================================
// CLAIM ACTION EXTRACTION
// ============================================================

function extractClaimActions(
  claim
) {
  return detectActions(
    `${claim.title || ""} ${
      claim.evidence || ""
    }`
  );
}

// ============================================================
// RATING MATCH
// ============================================================

function ratingMatchesClaim(
  claim,
  articleText,
  institution
) {
  const evidence =
    getInstitutionRatingEvidence(
      articleText,
      institution
    );

  const claimRatings =
    extractClaimRatings(
      claim
    );

  const articleRatings =
    evidence.ratings;

  if (
    !claimRatings.length
  ) {
    return {
      match:
        articleRatings.length > 0,
      detected:
        articleRatings,
      matched:
        []
    };
  }

  const matched =
    articleRatings.filter(
      rating =>
        claimRatings.includes(
          rating
        )
    );

  return {
    match:
      matched.length > 0,

    detected:
      articleRatings,

    matched
  };
}

// ============================================================
// ACTION MATCH
// ============================================================

function actionMatchesClaim(
  claim,
  articleText,
  institution
) {
  const evidence =
    getInstitutionRatingEvidence(
      articleText,
      institution
    );

  const claimActions =
    extractClaimActions(
      claim
    );

  const articleActions =
    evidence.actions;

  const claimUpgrades =
    claimActions.upgrades;

  const claimDowngrades =
    claimActions.downgrades;

  const upgradeMatch =
    claimUpgrades.length > 0 &&
    articleActions.upgrades.length > 0;

  const downgradeMatch =
    claimDowngrades.length > 0 &&
    articleActions.downgrades.length > 0;

  // If claim doesn't specify upgrade/downgrade,
  // presence of any rating action can support it.
  const genericActionMatch =
    claimUpgrades.length === 0 &&
    claimDowngrades.length === 0 &&
    (
      articleActions.upgrades.length >
        0 ||
      articleActions.downgrades.length >
        0
    );

  return {
    match:
      upgradeMatch ||
      downgradeMatch ||
      genericActionMatch,

    upgradeMatch,
    downgradeMatch,

    detected: {
      upgrades:
        articleActions.upgrades,

      downgrades:
        articleActions.downgrades
    }
  };
}

// ============================================================
// BROKERAGE CLAIM VERIFICATION V4
// ============================================================

function verifyBrokerageClaim(
  claim,
  articleText
) {
  const text =
    cleanText(articleText);

  const source =
    claim.source || "";

  const institutions =
    detectInstitutions(text);

  // ----------------------------------------------------------
  // Find matching institution
  // ----------------------------------------------------------

  const matchedInstitution =
    institutions.find(
      institution =>
        institutionMatches(
          source,
          institution
        )
    );

  const institutionFound =
    Boolean(
      matchedInstitution
    );

  if (!institutionFound) {
    return {
      status:
        "UNVERIFIED",

      confidence:
        "LOW",

      score: 0,

      verified: false,

      evidenceChecks: {
        institutionFound: false,
        actionMatch: false,
        targetMatch: false,
        ratingMatch: false,
        contextMatch: false
      },

      detected: {
        institutions,
        ratings: [],
        targetPrices: [],
        matchedTargetPrices: []
      }
    };
  }

  // ----------------------------------------------------------
  // IMPORTANT:
  // Only inspect matched institution context.
  // ----------------------------------------------------------

  const institutionContext =
    getInstitutionContext(
      text,
      matchedInstitution
    );

  const ratingResult =
    ratingMatchesClaim(
      claim,
      text,
      matchedInstitution
    );

  const actionResult =
    actionMatchesClaim(
      claim,
      text,
      matchedInstitution
    );

  const targetResult =
    institutionTargetMatchesClaim(
      claim,
      text,
      matchedInstitution
    );

  const claimRatings =
    extractClaimRatings(
      claim
    );

  const articleRatings =
    ratingResult.detected;

  // ----------------------------------------------------------
  // Check contradictory rating
  // ----------------------------------------------------------

  const claimText =
    normalizeText(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    );

  const articleContextNormalized =
    normalizeText(
      institutionContext
    );

  const contradictorySell =
    /\b(sell|strong sell|reduce|underweight)\b/i.test(
      claimText
    ) &&
    /\b(buy|strong buy|overweight|outperform|accumulate|add)\b/i.test(
      articleContextNormalized
    );

  const contradictoryBuy =
    /\b(buy|strong buy|overweight|outperform|accumulate|add)\b/i.test(
      claimText
    ) &&
    /\b(sell|strong sell|reduce|underweight)\b/i.test(
      articleContextNormalized
    );

  const contradiction =
    contradictorySell ||
    contradictoryBuy;

  // ----------------------------------------------------------
  // Context match
  // ----------------------------------------------------------

  const contextMatch =
    institutionFound &&
    (
      ratingResult.match ||
      targetResult.match ||
      actionResult.match
    ) &&
    !contradiction;

  // ----------------------------------------------------------
  // Score
  // ----------------------------------------------------------

  let score = 0;

  if (institutionFound)
    score += 30;

  if (actionResult.match)
    score += 20;

  if (ratingResult.match)
    score += 25;

  if (targetResult.match)
    score += 20;

  if (contextMatch)
    score += 10;

  if (contradiction)
    score -= 50;

  score = Math.max(
    0,
    Math.min(100, score)
  );

  let status =
    "UNVERIFIED";

  let confidence =
    "LOW";

  let verified =
    false;

  if (
    contextMatch &&
    score >=
      CONFIG.HIGH_SCORE
  ) {
    status =
      "DIRECT_EVIDENCE";

    confidence =
      "HIGH";

    verified =
      true;
  } else if (
    !contradiction &&
    score >=
      CONFIG.MEDIUM_SCORE
  ) {
    status =
      "SUPPORTED";

    confidence =
      "MEDIUM";
  }

  return {
    status,
    confidence,
    score,
    verified,

    evidenceChecks: {
      institutionFound,
      actionMatch:
        actionResult.match,
      targetMatch:
        targetResult.match,
      ratingMatch:
        ratingResult.match,
      contextMatch
    },

    detected: {
      institution:
        matchedInstitution,

      institutions,

      ratings:
        articleRatings,

      claimRatings,

      targetPrices:
        targetResult.detected,

      matchedTargetPrices:
        targetResult.matched
          ? targetResult.matched.map(
              x => x.value
            )
          : [],

      upgradeWords:
        actionResult.detected
          .upgrades,

      downgradeWords:
        actionResult.detected
          .downgrades,

      contradiction
    }
  };
}

// ============================================================
// TARGET PRICE CLAIM V4
// ============================================================

function verifyTargetPriceClaim(
  claim,
  articleText
) {
  const text =
    cleanText(articleText);

  const institutions =
    detectInstitutions(text);

  const claimSource =
    claim.source || "";

  // ----------------------------------------------------------
  // Institution must be found when source exists.
  // ----------------------------------------------------------

  const matchedInstitution =
    claimSource
      ? institutions.find(
          institution =>
            institutionMatches(
              claimSource,
              institution
            )
        )
      : null;

  const institutionFound =
    Boolean(
      matchedInstitution
    );

  // ----------------------------------------------------------
  // If no source is specified, use claim title/evidence.
  // ----------------------------------------------------------

  let targetResult;

  if (matchedInstitution) {
    targetResult =
      institutionTargetMatchesClaim(
        claim,
        text,
        matchedInstitution
      );
  } else {
    targetResult =
      targetMatchesClaim(
        claim,
        text
      );
  }

  const institutionContext =
    matchedInstitution
      ? getInstitutionContext(
          text,
          matchedInstitution
        )
      : text;

  const claimTargetValues =
    extractTargetPrices(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    ).map(
      x => x.value
    );

  const articleTargetValues =
    targetResult.detected || [];

  const targetMatch =
    targetResult.match;

  // ----------------------------------------------------------
  // Target action context
  // ----------------------------------------------------------

  const actionMatch =
    containsAny(
      institutionContext,
      [
        "raised target",
        "raised its target",
        "target price",
        "price target",
        "target of",
        "target at",
        "target to",
        "hiked target",
        "cut target",
        "lowered target",
        "revised target"
      ]
    );

  // ----------------------------------------------------------
  // Score
  // ----------------------------------------------------------

  let score = 0;

  if (
    institutionFound ||
    !claimSource
  ) {
    score += 30;
  }

  if (targetMatch)
    score += 50;

  if (actionMatch)
    score += 20;

  score = Math.min(
    100,
    score
  );

  let status =
    "UNVERIFIED";

  let confidence =
    "LOW";

  let verified =
    false;

  if (
    targetMatch &&
    score >=
      CONFIG.HIGH_SCORE
  ) {
    status =
      "DIRECT_EVIDENCE";

    confidence =
      "HIGH";

    verified =
      true;
  } else if (
    targetMatch &&
    score >=
      CONFIG.MEDIUM_SCORE
  ) {
    status =
      "SUPPORTED";

    confidence =
      "MEDIUM";
  }

  return {
    status,
    confidence,
    score,
    verified,

    evidenceChecks: {
      institutionFound:
        institutionFound ||
        !claimSource,

      actionMatch,

      targetMatch,

      contextMatch:
        targetMatch &&
        (
          institutionFound ||
          !claimSource
        )
    },

    detected: {
      institutions,

      institution:
        matchedInstitution,

      targetPrices:
        articleTargetValues,

      claimTargetPrices:
        claimTargetValues,

      matchedTargetPrices:
        targetResult.matched
          ? targetResult.matched.map(
              x => x.value
            )
          : []
    }
  };
}

// ============================================================
// RATING ACTION CLAIM V4
// ============================================================

function verifyRatingActionClaim(
  claim,
  articleText
) {
  const text =
    cleanText(articleText);

  const institutions =
    detectInstitutions(text);

  const claimSource =
    claim.source || "";

  const matchedInstitution =
    institutions.find(
      institution =>
        institutionMatches(
          claimSource,
          institution
        )
    );

  const institutionFound =
    Boolean(
      matchedInstitution
    );

  if (!institutionFound) {
    return {
      status:
        "UNVERIFIED",

      confidence:
        "LOW",

      score: 0,

      verified: false,

      evidenceChecks: {
        institutionFound: false,
        actionMatch: false,
        targetMatch: false,
        ratingMatch: false,
        contextMatch: false
      },

      detected: {
        institutions,
        ratings: []
      }
    };
  }

  const ratingResult =
    ratingMatchesClaim(
      claim,
      text,
      matchedInstitution
    );

  const actionResult =
    actionMatchesClaim(
      claim,
      text,
      matchedInstitution
    );

  const context =
    getInstitutionContext(
      text,
      matchedInstitution
    );

  const claimText =
    normalizeText(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    );

  const articleContext =
    normalizeText(
      context
    );

  // ----------------------------------------------------------
  // Contradiction detection
  // ----------------------------------------------------------

  const claimBuy =
    /\b(buy|strong buy|overweight|outperform|accumulate|add)\b/i.test(
      claimText
    );

  const claimSell =
    /\b(sell|strong sell|reduce|underweight)\b/i.test(
      claimText
    );

  const articleBuy =
    /\b(buy|strong buy|overweight|outperform|accumulate|add)\b/i.test(
      articleContext
    );

  const articleSell =
    /\b(sell|strong sell|reduce|underweight)\b/i.test(
      articleContext
    );

  const contradiction =
    (
      claimBuy &&
      articleSell
    ) ||
    (
      claimSell &&
      articleBuy
    );

  let score = 0;

  if (institutionFound)
    score += 35;

  if (actionResult.match)
    score += 30;

  if (ratingResult.match)
    score += 30;

  if (!contradiction)
    score += 5;

  if (contradiction)
    score -= 50;

  score = Math.max(
    0,
    Math.min(100, score)
  );

  const contextMatch =
    institutionFound &&
    actionResult.match &&
    ratingResult.match &&
    !contradiction;

  let status =
    "UNVERIFIED";

  let confidence =
    "LOW";

  let verified =
    false;

  if (
    contextMatch &&
    score >=
      CONFIG.HIGH_SCORE
  ) {
    status =
      "DIRECT_EVIDENCE";

    confidence =
      "HIGH";

    verified =
      true;
  } else if (
    !contradiction &&
    score >=
      CONFIG.MEDIUM_SCORE
  ) {
    status =
      "SUPPORTED";

    confidence =
      "MEDIUM";
  }

  return {
    status,
    confidence,
    score,
    verified,

    evidenceChecks: {
      institutionFound,
      actionMatch:
        actionResult.match,
      targetMatch: false,
      ratingMatch:
        ratingResult.match,
      contextMatch
    },

    detected: {
      institutions,

      institution:
        matchedInstitution,

      ratings:
        ratingResult.detected,

      claimRatings:
        extractClaimRatings(
          claim
        ),

      upgradeWords:
        actionResult.detected
          .upgrades,

      downgradeWords:
        actionResult.detected
          .downgrades,

      contradiction
    }
  };
}

// ============================================================
// REGULATORY CLAIM V4
// ============================================================

function verifyRegulatoryClaim(
  claim,
  articleText
) {
  const text =
    cleanText(articleText);

  const regulators =
    detectRegulators(text);

  const claimText =
    normalizeText(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    );

  const claimRegulators =
    detectRegulators(
      claimText
    );

  // ----------------------------------------------------------
  // Match regulator
  // ----------------------------------------------------------

  const regulatorFound =
    claimRegulators.length === 0
      ? regulators.length > 0
      : claimRegulators.some(
          regulator =>
            regulators.includes(
              regulator
            )
        );

  // ----------------------------------------------------------
  // Regulatory actions
  // ----------------------------------------------------------

  const actions =
    findMatches(
      text,
      CONFIG.regulatoryActionWords
    );

  const claimActions =
    findMatches(
      claimText,
      CONFIG.regulatoryActionWords
    );

  const actionMatch =
    claimActions.length === 0
      ? actions.length > 0
      : claimActions.some(
          action =>
            actions.includes(
              action
            )
        );

  // ----------------------------------------------------------
  // Subject / domain context
  // ----------------------------------------------------------

  const derivativeContext =
    containsAny(
      text,
      [
        "derivative",
        "derivatives",
        "commodity",
        "commodity derivatives",
        "physically settled",
        "fpi",
        "fpis",
        "foreign portfolio investor",
        "foreign portfolio investors"
      ]
    );

  const claimDerivativeContext =
    containsAny(
      claimText,
      [
        "derivative",
        "derivatives",
        "commodity",
        "commodity derivatives",
        "physically settled",
        "fpi",
        "fpis",
        "foreign portfolio investor",
        "foreign portfolio investors"
      ]
    );

  const contextMatch =
    regulatorFound &&
    actionMatch &&
    (
      derivativeContext ||
      claimDerivativeContext
    );

  let score = 0;

  if (regulatorFound)
    score += 40;

  if (actionMatch)
    score += 30;

  if (
    derivativeContext ||
    claimDerivativeContext
  )
    score += 20;

  if (
    claimRegulators.length > 0
  )
    score += 10;

  score = Math.min(
    100,
    score
  );

  let status =
    "UNVERIFIED";

  let confidence =
    "LOW";

  let verified =
    false;

  if (
    contextMatch &&
    score >=
      CONFIG.HIGH_SCORE
  ) {
    status =
      "DIRECT_EVIDENCE";

    confidence =
      "HIGH";

    verified =
      true;
  } else if (
    regulatorFound &&
    actionMatch &&
    score >=
      CONFIG.MEDIUM_SCORE
  ) {
    status =
      "SUPPORTED";

    confidence =
      "MEDIUM";
  }

  return {
    status,
    confidence,
    score,
    verified,

    evidenceChecks: {
      regulatorFound,
      actionMatch,
      targetMatch: false,
      contextMatch
    },

    detected: {
      regulators,
      regulatoryActions:
        actions,
      derivativeContext
    }
  };
}

// ============================================================
// GENERIC CLAIM V4
// ============================================================

function verifyGenericClaim(
  claim,
  articleText
) {
  const text =
    normalizeText(
      articleText
    );

  const claimText =
    normalizeText(
      `${claim.title || ""} ${
        claim.evidence || ""
      }`
    );

  const words =
    claimText
      .split(/\s+/)
      .filter(
        x =>
          x.length >= 5
      )
      .filter(
        (word, index, arr) =>
          arr.indexOf(word) ===
          index
      );

  if (!words.length) {
    return {
      status:
        "UNVERIFIED",

      confidence:
        "LOW",

      score: 0,

      verified: false,

      evidenceChecks: {
        institutionFound: false,
        actionMatch: false,
        targetMatch: false,
        contextMatch: false
      },

      detected: {}
    };
  }

  let matched = 0;

  for (
    const word of words
  ) {
    if (
      text.includes(word)
    ) {
      matched++;
    }
  }

  const ratio =
    matched /
    words.length;

  let score =
    Math.round(
      ratio * 100
    );

  score =
    Math.min(
      100,
      score
    );

  let status =
    "UNVERIFIED";

  let confidence =
    "LOW";

  let verified =
    false;

  if (
    score >=
    CONFIG.HIGH_SCORE
  ) {
    status =
      "DIRECT_EVIDENCE";

    confidence =
      "HIGH";

    verified =
      true;
  } else if (
    score >=
    CONFIG.MEDIUM_SCORE
  ) {
    status =
      "SUPPORTED";

    confidence =
      "MEDIUM";
  }

  return {
    status,
    confidence,
    score,
    verified,

    evidenceChecks: {
      institutionFound: false,
      actionMatch: false,
      targetMatch: false,
      contextMatch:
        score >=
        CONFIG.MEDIUM_SCORE
    },

    detected: {
      matchedWords:
        words.filter(
          word =>
            text.includes(word)
        )
    }
  };
}

// ============================================================
// MAIN CLAIM VERIFIER
// ============================================================

function verifyClaim(
  claim,
  articleText
) {
  if (!claim) {
    return {
      status:
        "UNVERIFIED",

      confidence:
        "LOW",

      score: 0,

      verified: false,

      error:
        "Claim missing"
    };
  }

  const text =
    cleanText(
      articleText
    );

  if (!text) {
    return {
      status:
        "UNVERIFIED",

      confidence:
        "LOW",

      score: 0,

      verified: false,

      error:
        "Article text missing"
    };
  }

  const type =
    String(
      claim.type ||
        "GENERIC"
    )
      .toUpperCase()
      .replace(
        /[^A-Z_]/g,
        ""
      );

  switch (type) {

    case "BROKERAGE_VIEW":

      return verifyBrokerageClaim(
        claim,
        text
      );

    case "TARGET_PRICE":

      return verifyTargetPriceClaim(
        claim,
        text
      );

    case "RATING_ACTION":

      return verifyRatingActionClaim(
        claim,
        text
      );

    case "REGULATORY":

      return verifyRegulatoryClaim(
        claim,
        text
      );

    default:

      return verifyGenericClaim(
        claim,
        text
      );
  }
}

// ============================================================
// SAFE CLAIM BUILDER
// ============================================================

function buildSafeClaim(
  claim,
  verification
) {
  if (
    !verification ||
    verification.verified !== true
  ) {
    return null;
  }

  return {
    ...claim,

    verification: {
      status:
        verification.status,

      confidence:
        verification.confidence,

      score:
        verification.score,

      verified:
        true,

      evidenceChecks:
        verification.evidenceChecks,

      detected:
        verification.detected
    }
  };
}

// ============================================================
// VERIFY CLAIM LIST
// ============================================================

function verifyClaims(
  claims,
  articleText
) {
  const results = [];

  const safeClaims = [];

  const warnings = [];

  for (
    const claim of claims || []
  ) {

    try {

      const verification =
        verifyClaim(
          claim,
          articleText
        );

      const result = {
        ...claim,
        verification
      };

      results.push(
        result
      );

      if (
        verification.verified ===
        true
      ) {

        const safeClaim =
          buildSafeClaim(
            claim,
            verification
          );

        if (safeClaim) {
          safeClaims.push(
            safeClaim
          );
        }

      } else {

        warnings.push(
          `Unverified claim: ${
            claim.title ||
            claim.evidence ||
            "Unknown claim"
          }`
        );
      }

    } catch (error) {

      results.push({
        ...claim,

        verification: {
          status:
            "UNVERIFIED",

          confidence:
            "LOW",

          score: 0,

          verified: false,

          error:
            error.message
        }
      });

      warnings.push(
        `Verification error: ${
          claim.title ||
          "Unknown claim"
        }`
      );
    }
  }

  return {
    results,

    safeClaims,

    warnings
  };
}

// ============================================================
// FULL EVIDENCE SUMMARY
// ============================================================

function buildEvidenceSummary(
  verificationResult
) {
  const results =
    verificationResult &&
    verificationResult.results
      ? verificationResult.results
      : [];

  const safeClaims =
    verificationResult &&
    verificationResult.safeClaims
      ? verificationResult.safeClaims
      : [];

  const warnings =
    verificationResult &&
    verificationResult.warnings
      ? verificationResult.warnings
      : [];

  const highConfidence =
    safeClaims.filter(
      claim =>
        claim.verification &&
        claim.verification.confidence ===
          "HIGH"
    );

  const mediumConfidence =
    results.filter(
      claim =>
        claim.verification &&
        claim.verification.confidence ===
          "MEDIUM"
    );

  return {
    total:
      results.length,

    verified:
      safeClaims.length,

    highConfidence:
      highConfidence.length,

    mediumConfidence:
      mediumConfidence.length,

    unverified:
      results.length -
      safeClaims.length,

    warnings
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  CONFIG,

  cleanText,
  normalizeText,
  escapeRegExp,

  containsAny,
  findMatches,

  splitSentences,

  detectInstitutions,
  detectRegulators,
  detectRatings,
  detectActions,

  findInstitutionPosition,
  normalizeInstitutionName,
  institutionMatches,

  getInstitutionContext,
  getSentenceContext,
  getClaimContext,

  extractTargetPrices,
  extractInstitutionTargets,

  targetMatchesClaim,
  institutionTargetMatchesClaim,

  getInstitutionRatingEvidence,
  extractClaimRatings,
  extractClaimActions,

  ratingMatchesClaim,
  actionMatchesClaim,

  verifyBrokerageClaim,
  verifyTargetPriceClaim,
  verifyRatingActionClaim,
  verifyRegulatoryClaim,
  verifyGenericClaim,

  verifyClaim,

  buildSafeClaim,
  verifyClaims,

  buildEvidenceSummary
};