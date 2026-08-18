// =====================================================
// ARTICLE VERIFIER V1
// Verifies article URL + publisher + claim evidence
// =====================================================

const https = require("https");
const http = require("http");

// -----------------------------------------------------
// Fetch webpage
// -----------------------------------------------------

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
          Accept: "text/html,application/xhtml+xml"
        }
      },
      (response) => {
        let data = "";

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            finalUrl: response.headers.location || url,
            html: data
          });
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(15000, () => {
      request.destroy(new Error("Request timeout"));
    });
  });
}

// -----------------------------------------------------
// HTML -> Text
// -----------------------------------------------------

function htmlToText(html) {
  return String(html || "")
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

// -----------------------------------------------------
// Normalize text
// -----------------------------------------------------

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// -----------------------------------------------------
// Extract title
// -----------------------------------------------------

function extractTitle(html) {
  const match = String(html || "").match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (!match) {
    return null;
  }

  return htmlToText(match[1]);
}

// -----------------------------------------------------
// Check keyword
// -----------------------------------------------------

function containsKeyword(text, keyword) {
  return normalize(text).includes(normalize(keyword));
}

// -----------------------------------------------------
// Verify claim
// -----------------------------------------------------

function verifyClaim(articleText, claim) {
  const text = normalize(articleText);

  const evidence = normalize(claim.evidence);
  const title = normalize(claim.title);

  const checks = {
    sourceMentioned: claim.source
      ? containsKeyword(text, claim.source)
      : false,

    titleKeywords:
      title
        .split(" ")
        .filter((word) => word.length > 4)
        .slice(0, 8)
        .filter((word) => text.includes(word)).length >= 2,

    evidenceKeywords:
      evidence
        .split(" ")
        .filter((word) => word.length > 4)
        .filter((word) => text.includes(word)).length >= 2
  };

  let status = "UNVERIFIED";
  let confidence = "LOW";

  const matched = Object.values(checks).filter(Boolean).length;

  if (matched >= 3) {
    status = "DIRECT_EVIDENCE";
    confidence = "HIGH";
  } else if (matched >= 2) {
    status = "SUPPORTED";
    confidence = "MEDIUM";
  }

  return {
    status,
    confidence,
    checks,
    verified: status === "DIRECT_EVIDENCE"
  };
}

// -----------------------------------------------------
// Verify complete article
// -----------------------------------------------------

async function verifyArticle(article, claims = []) {
  if (!article || !article.url) {
    return {
      success: false,
      status: "NO_URL",
      claims: []
    };
  }

  try {
    console.log(`Verifying article: ${article.url}`);

    const page = await fetchPage(article.url);

    if (page.statusCode < 200 || page.statusCode >= 400) {
      return {
        success: false,
        status: `HTTP_${page.statusCode}`,
        url: article.url,
        claims: []
      };
    }

    const text = htmlToText(page.html);
    const title = extractTitle(page.html);

    const verifiedClaims = claims.map((claim) => {
      return {
        ...claim,
        verification: verifyClaim(text, claim)
      };
    });

    return {
      success: true,
      status: "ARTICLE_FETCHED",
      url: article.url,
      finalUrl: page.finalUrl,
      httpStatus: page.statusCode,
      pageTitle: title,
      contentLength: text.length,
      claims: verifiedClaims
    };
  } catch (error) {
    return {
      success: false,
      status: "FETCH_ERROR",
      error: error.message,
      url: article.url,
      claims: []
    };
  }
}

// -----------------------------------------------------
// Export
// -----------------------------------------------------

module.exports = {
  fetchPage,
  htmlToText,
  extractTitle,
  verifyClaim,
  verifyArticle
};