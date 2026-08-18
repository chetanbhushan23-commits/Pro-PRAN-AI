const { analyzeStock } = require('./technical-provider.js');

async function runFallbackTest() {
  console.log("🚀 Starting Technical Provider Fallback Test...\n");
  
  // NSE stock ke liye RELIANCE.NS use kar rahe hain
  const symbol = "RELIANCE.NS"; 

  try {
    console.log(`⏳ Analyzing ${symbol}...`);
    const result = await analyzeStock(symbol);

    if (result.success) {
      console.log(`\n✅ Success! Technical Analysis generated for ${result.symbol}`);
      console.log(`🏢 Provider Used: ${result.provider}\n`);
      
      console.log("📊 Technical Indicators Snapshot:");
      console.log(`   - Current Price : ₹${result.technical.price}`);
      console.log(`   - RSI (14)      : ${result.technical.rsi14}`);
      console.log(`   - EMA (20)      : ₹${result.technical.ema20}`);
      console.log(`   - Trend         : ${result.technical.trend}`);
      
      if (result.technical.macd) {
         console.log(`   - MACD Line     : ${result.technical.macd.line}`);
      }
      
      console.log(`   - Support       : ₹${result.technical.support}`);
      console.log(`   - Resistance    : ₹${result.technical.resistance}`);
      console.log(`\n📈 Total Data Points Analyzed: ${result.dataPoints} days`);
      
    } else {
      console.log(`\n❌ Failed to analyze:`, result.error);
    }

  } catch (error) {
    console.error("\n❌ Test execution crashed:", error);
  }
}

runFallbackTest();