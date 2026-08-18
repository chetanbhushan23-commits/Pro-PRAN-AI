"use strict";

const {
  verifyClaim,
  extractTargetPrices
} = require("./claim-verifier-v3");

const articleText = `
UBS upgraded MCX to Buy from Neutral and raised its
target price to Rs 3,800.

The brokerage expects strong trading volumes.

SEBI proposed widening foreign portfolio investor access
to physically settled non-agricultural commodity derivatives.
`;

// ============================================================
// TEST 1
// ============================================================

console.log("\n==========================================");
console.log("🔬 CLAIM VERIFIER V3 TEST");
console.log("==========================================");

const brokerageClaim = {
  type: "BROKERAGE_VIEW",
  source: "UBS",
  title: "UBS upgrades MCX rating to Buy",
  evidence:
    "UBS upgraded MCX to Buy from Neutral."
};

console.log("\n📌 BROKERAGE CLAIM");

console.log(
  JSON.stringify(
    verifyClaim(
      brokerageClaim,
      articleText
    ),
    null,
    2
  )
);

// ============================================================
// TEST 2
// ============================================================

const targetClaim = {
  type: "TARGET_PRICE",
  source: "UBS",
  title: "UBS target price Rs 3,800",
  evidence:
    "UBS raised MCX target price to Rs 3,800."
};

console.log("\n📌 TARGET PRICE CLAIM");

console.log(
  JSON.stringify(
    verifyClaim(
      targetClaim,
      articleText
    ),
    null,
    2
  )
);

// ============================================================
// TEST 3
// ============================================================

const regulatoryClaim = {
  type: "REGULATORY",
  source: "SEBI",
  title: "SEBI proposal for commodity derivatives",
  evidence:
    "SEBI proposed widening foreign portfolio investor access to physically settled non-agricultural commodity derivatives."
};

console.log("\n📌 REGULATORY CLAIM");

console.log(
  JSON.stringify(
    verifyClaim(
      regulatoryClaim,
      articleText
    ),
    null,
    2
  )
);

// ============================================================
// TEST 4
// ============================================================

console.log("\n📌 TARGET PRICE EXTRACTION");

console.log(
  JSON.stringify(
    extractTargetPrices(articleText),
    null,
    2
  )
);

console.log("\n==========================================");
console.log("✅ CLAIM VERIFIER V3 TEST COMPLETE");
console.log("==========================================\n");