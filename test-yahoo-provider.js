const yahoo = require('./yahoo-provider.js');

async function testYahoo() {
  console.log("🚀 Starting Yahoo Provider Tests...\n");
  
  const testSymbol = "RELIANCE.NS"; 
  
  try {
    // 1. Test Single Fetch (Quote)
    console.log(`[Test 1] Fetching Quote for ${testSymbol}...`);
    const quoteStart = Date.now();
    const quote = await yahoo.getQuote(testSymbol);
    const quoteEnd = Date.now();
    
    if (quote.success) {
      console.log(`✅ Success! Price: ₹${quote.data.price}`);
      console.log(`⏱️ Time taken: ${quoteEnd - quoteStart}ms\n`);
    } else {
      console.log(`❌ Failed:`, quote.error);
    }

    // 2. Test Single Fetch (History)
    console.log(`[Test 2] Fetching History for ${testSymbol}...`);
    const history = await yahoo.getHistory(testSymbol, "1mo", "1d");
    if (history.success) {
      console.log(`✅ Success! Fetched ${history.count} candles.`);
      console.log(`   Latest Close: ₹${history.candles[history.candles.length-1]?.close}\n`);
    } else {
      console.log(`❌ Failed:`, history.error);
    }

    // 3. Test Caching (Should be very fast)
    console.log(`[Test 3] Testing Cache (Fetching quote again)...`);
    const cacheStart = Date.now();
    const cachedQuote = await yahoo.getQuote(testSymbol);
    const cacheEnd = Date.now();
    
    if (cachedQuote.success) {
      console.log(`✅ Cache hit!`);
      console.log(`⏱️ Time taken: ${cacheEnd - cacheStart}ms (Should be much faster than Test 1)\n`);
    }

  } catch (err) {
    console.error("Test execution failed:", err);
  }
}

testYahoo();