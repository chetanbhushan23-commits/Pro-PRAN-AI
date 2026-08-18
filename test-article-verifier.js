// =====================================================
// ARTICLE VERIFIER TEST
// =====================================================

const {
  verifyArticle
} = require(
  "./article-verifier"
);

const article = {

  source:
    "The Times of India",

  title:
    "UBS upgrades MCX rating to Buy with Rs 3,800 target price",

  description:
    "UBS upgraded MCX to Buy from Neutral and raised its target price to Rs 3,800.",

  publishedAt:
    "2026-08-13T07:37:59Z",

  url:
    "https://economictimes.indiatimes.com/markets/stocks/news/ubs-upgrades-mcx-raises-target-price/articleshow/133203886.cms"
};

const claims = [

  {
    type:
      "BROKERAGE_VIEW",

    source:
      "UBS",

    title:
      article.title,

    evidence:
      "UBS upgraded MCX to Buy from Neutral."
  },

  {
    type:
      "TARGET_PRICE",

    source:
      "UBS",

    title:
      article.title,

    evidence:
      "UBS raised MCX target price to Rs 3,800."
  }

];

async function main() {

  console.log(
    "\n=========================================="
  );

  console.log(
    "🔬 ARTICLE VERIFIER TEST"
  );

  console.log(
    "=========================================="
  );

  const result =
    await verifyArticle(
      article,
      claims
    );

  console.log(
    "\n========== VERIFICATION RESULT =========="
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (
    result.success
  ) {

    console.log(
      "\n✅ ARTICLE FETCH SUCCESS"
    );

  } else {

    console.log(
      "\n❌ ARTICLE FETCH FAILED"
    );

  }

  console.log(
    "\n=========================================="
  );

  console.log(
    "🔬 ARTICLE VERIFIER TEST COMPLETE"
  );

  console.log(
    "=========================================="
  );
}

main();