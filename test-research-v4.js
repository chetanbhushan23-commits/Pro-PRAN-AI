"use strict";

const {
  processResearch
} = require("./research-data-engine-v2");

async function main() {

  console.log(`
==========================================
🔬 RESEARCH DATA ENGINE V4 TEST
==========================================
`);

  const articles = [

    {
      source: "The Economic Times",

      title:
        "UBS upgrades MCX rating to Buy with Rs 3,800 target price",

      description:
        "UBS upgraded MCX to Buy from Neutral and raised its target price to Rs 3,800.",

      publishedAt:
        "2026-08-13T07:37:59Z",

      url:
        "https://economictimes.indiatimes.com/markets/stocks/news/ubs-upgrades-mcx-raises-target-price/articleshow/133203886.cms"
    },

    {
      source: "The Economic Times",

      title:
        "MCX shares rise after SEBI proposal",

      description:
        "SEBI proposed widening foreign portfolio investor access to physically settled non-agricultural commodity derivatives.",

      publishedAt:
        "2026-08-12T05:10:52Z",

      url:
        "https://economictimes.indiatimes.com/markets/stocks/news/mcx-shares-rise-2-as-jpmorgan-upgrades-raises-target-price-after-this-sebi-proposal/articleshow/133171178.cms"
    }

  ];

  try {

    const result =
      await processResearch(
        articles
      );

    console.log(`
==========================================
📊 FINAL RESULT
==========================================
`);

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    console.log(`
==========================================
📈 SUMMARY
==========================================

Articles:
${result.articlesProcessed}

Total Claims:
${result.totalClaims}

Verified Claims:
${result.verifiedClaims}

Unverified Claims:
${result.unverifiedClaims}

Warnings:
${result.warnings.length}

==========================================
`);

  } catch (error) {

    console.error(`
==========================================
❌ TEST FAILED
==========================================
`);

    console.error(error);

  }

}

main();