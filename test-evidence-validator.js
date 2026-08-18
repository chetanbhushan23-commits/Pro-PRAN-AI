const {
  buildAISafeEvidence
} = require("./evidence-validator");

const testNews = [

  {
    title:
      "UBS upgrades MCX rating to Buy with Rs 3,800 target price",

    description:
      "UBS upgraded MCX to Buy from Neutral and raised its target price to Rs 3,800.",

    source:
      "The Times of India",

    publishedAt:
      "2026-08-13T07:37:59Z",

    url:
      "https://economictimes.indiatimes.com/markets/stocks/news/ubs-upgrades-mcx-raises-target-price/articleshow/133203886.cms"
  },

  {
    title:
      "MCX shares rise after SEBI proposal",

    description:
      "SEBI proposed widening foreign portfolio investor access to physically settled non-agricultural commodity derivatives.",

    source:
      "The Times of India",

    publishedAt:
      "2026-08-12T05:10:52Z",

    url:
      "https://economictimes.indiatimes.com/markets/stocks/news/mcx-shares-rise-2-as-jpmorgan-upgrades-raises-target-price-after-this-sebi-proposal/articleshow/133171178.cms"
  },

  {
    title:
      "Random website says MCX will double",

    description:
      "MCX may double soon.",

    source:
      "Unknown Blog",

    publishedAt:
      "2026-08-13T10:00:00Z",

    url:
      "https://example.com/random"
  }

];

console.log(
  "\n=========================================="
);

console.log(
  "🔎 EVIDENCE VALIDATOR TEST"
);

console.log(
  "=========================================="
);

const result =
  buildAISafeEvidence(testNews);

console.log(
  "\n📊 TOTAL:",
  result.totalArticles
);

console.log(
  "\n✅ VERIFIED ARTICLES:"
);

console.log(
  JSON.stringify(
    result.verifiedArticles,
    null,
    2
  )
);

console.log(
  "\n🎯 IMPORTANT CLAIMS:"
);

console.log(
  JSON.stringify(
    result.importantClaims,
    null,
    2
  )
);

console.log(
  "\n🛡 SAFE CLAIMS:"
);

console.log(
  JSON.stringify(
    result.safeClaims,
    null,
    2
  )
);

console.log(
  "\n⚠️ WARNINGS:"
);

console.log(
  JSON.stringify(
    result.warnings,
    null,
    2
  )
);

console.log(
  "\n=========================================="
);

console.log(
  "✅ EVIDENCE VALIDATOR TEST COMPLETE"
);

console.log(
  "=========================================="
);