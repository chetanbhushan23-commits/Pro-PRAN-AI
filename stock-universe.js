// =====================================================
// INDIAN STOCK UNIVERSE
// Top-1000 ready architecture
// =====================================================

const STOCK_UNIVERSE = [
  // Large / widely traded
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "ITC",
  "SBIN",
  "BHARTIARTL",
  "LT",
  "AXISBANK",
  "KOTAKBANK",
  "HINDUNILVR",
  "BAJFINANCE",
  "MARUTI",
  "SUNPHARMA",
  "TITAN",
  "M&M",
  "HCLTECH",
  "ADANIENT",
  "ADANIPORTS",
  "NTPC",
  "POWERGRID",
  "TATASTEEL",
  "TATAMOTORS",
  "TATACONSUM",
  "ONGC",
  "COALINDIA",
  "WIPRO",
  "TECHM",
  "ULTRACEMCO",
  "ASIANPAINT",
  "NESTLEIND",
  "BAJAJFINSV",
  "JSWSTEEL",
  "INDUSINDBK",
  "GRASIM",
  "CIPLA",
  "DRREDDY",
  "EICHERMOT",
  "HEROMOTOCO",
  "BAJAJ-AUTO",
  "APOLLOHOSP",
  "DIVISLAB",
  "BRITANNIA",
  "BPCL",
  "HINDALCO",
  "SHRIRAMFIN",
  "LTIM",
  "TCS",
  "MCX",

  // Banking / Financial
  "BANKBARODA",
  "PNB",
  "CANBK",
  "UNIONBANK",
  "IDFCFIRSTB",
  "FEDERALBNK",
  "INDIANB",
  "BANKINDIA",
  "YESBANK",
  "RBLBANK",
  "AUBANK",
  "BANDHANBNK",
  "UCOBANK",
  "CENTRALBK",
  "IOB",
  "MAHABANK",
  "LICHSGFIN",
  "PFC",
  "RECLTD",
  "IRFC",
  "HUDCO",
  "NBCC",
  "MUTHOOTFIN",
  "MANAPPURAM",
  "CHOLAFIN",
  "M&MFIN",
  "L&TFH",
  "ABCAPITAL",
  "MFSL",
  "SBICARD",
  "HDFCLIFE",
  "SBILIFE",
  "ICICIPRULI",
  "ICICIGI",
  "LICI",

  // IT / Technology
  "MPHASIS",
  "PERSISTENT",
  "COFORGE",
  "LTTS",
  "KPITTECH",
  "TATAELXSI",
  "CYIENT",
  "OFSS",
  "TANLA",
  "INTELLECT",
  "SONATSOFTW",
  "ZENSARTECH",
  "BIRLASOFT",
  "HAPPSTMNDS",
  "MASTEK",
  "BSOFT",

  // Pharma / Healthcare
  "LUPIN",
  "AUROPHARMA",
  "BIOCON",
  "TORNTPHARM",
  "ALKEM",
  "GLENMARK",
  "ZYDUSLIFE",
  "LAURUSLABS",
  "GRANULES",
  "NATCOPHARM",
  "IPCALAB",
  "ABBOTINDIA",
  "SANOFI",
  "PFIZER",
  "GLAXO",
  "ERIS",
  "JUBLPHARMA",
  "MEDANTA",
  "MAXHEALTH",
  "FORTIS",
  "SYNGENE",
  "METROPOLIS",
  "LALPATHLAB",

  // Auto
  "TVSMOTOR",
  "ASHOKLEY",
  "BHARATFORG",
  "BOSCHLTD",
  "MOTHERSON",
  "MRF",
  "BALKRISIND",
  "EXIDEIND",
  "APOLLOTYRE",
  "CEAT",
  "ENDURANCE",
  "SONACOMS",
  "UNOMINDA",
  "CRAFTSMAN",
  "TIINDIA",

  // FMCG / Consumer
  "DABUR",
  "GODREJCP",
  "MARICO",
  "COLPAL",
  "JUBLFOOD",
  "VBL",
  "EMAMILTD",
  "RADICO",
  "UNITDSPR",
  "TATACOFFEE",
  "DMART",
  "TRENT",
  "NYKAA",
  "KALYANKJIL",
  "PAGEIND",
  "V-MART",
  "DEVYANI",
  "WESTLIFE",
  "JYOTHYLAB",

  // Energy / Power / Oil
  "IOC",
  "HINDPETRO",
  "GAIL",
  "OIL",
  "PETRONET",
  "IGL",
  "MGL",
  "ATGL",
  "TORNTPOWER",
  "NHPC",
  "SJVN",
  "CESC",
  "TATAPOWER",
  "JSWENERGY",
  "ADANIGREEN",
  "ADANIENSOL",
  "SUZLON",
  "INOXWIND",

  // Metals / Mining
  "VEDL",
  "NMDC",
  "SAIL",
  "JINDALSTEL",
  "NATIONALUM",
  "HINDZINC",
  "APLAPOLLO",
  "RATNAMANI",
  "WELCORP",
  "JSL",
  "MOIL",

  // Capital Goods / Engineering
  "ABB",
  "SIEMENS",
  "BEL",
  "HAL",
  "BHEL",
  "BEML",
  "RVNL",
  "IRCON",
  "CONCOR",
  "CUMMINSIND",
  "THERMAX",
  "KEI",
  "POLYCAB",
  "HAVELLS",
  "VOLTAS",
  "CROMPTON",
  "DIXON",
  "KAYNES",
  "SUYOG",
  "ASTRAL",

  // Chemicals
  "SRF",
  "PIDILITIND",
  "DEEPAKNTR",
  "NAVINFLUOR",
  "AARTIIND",
  "AARTIDRUGS",
  "ALKYLAMINE",
  "CLEAN",
  "FINEORG",
  "FLUOROCHEM",
  "TATACHEM",
  "COROMANDEL",
  "UPL",
  "PIIND",
  "SUMICHEM",
  "BALRAMCHIN",

  // Cement / Construction
  "AMBUJACEM",
  "ACC",
  "DALBHARAT",
  "RAMCOCEM",
  "JKCEMENT",
  "BIRLACORPN",
  "RVNL",
  "KNRCON",
  "LTCON",
  "IRB",
  "ASHOKA",
  "PNCINFRA",

  // Telecom / Media
  "IDEA",
  "ZEEL",
  "SUNTV",
  "NETWORK18",
  "PVRINOX",

  // Hotels / Travel / Aviation
  "INDHOTEL",
  "LEMONTREE",
  "EIH",
  "ITDC",
  "IRCTC",
  "INDIGO",
  "JUBLINGREA",
  "DELHIVERY",

  // Logistics
  "BLUEDART",
  "TCI",
  "DELHIVERY",
  "GATI",
  "VRLLOG",
  "ALLCARGO",
  "MAHLOG",

  // Insurance / Asset Management
  "HDFCAMC",
  "NAM-INDIA",
  "ICICIGI",
  "ICICIPRULI",
  "NIACL",
  "GICRE",
  "STARHEALTH",

  // Real Estate
  "DLF",
  "LODHA",
  "GODREJPROP",
  "OBEROIRLTY",
  "PRESTIGE",
  "SOBHA",
  "BRIGADE",
  "PHOENIXLTD",
  "SUNTECK",

  // Defence / Aerospace
  "MAZDOCK",
  "COCHINSHIP",
  "GRSE",
  "BDL",
  "MIDHANI",
  "DATAPATTNS",
  "PARAS",
  "MTARTECH",

  // Electronics / Manufacturing
  "AMBER",
  "PGEL",
  "SYRMA",
  "ELECTRONICS",
  "ELIN",
  "GENUSPOWER",
  "NETWEB",

  // Specialty / Other
  "CDSL",
  "BSE",
  "KAYNES",
  "IEX",
  "IREDA",
  "INOXINDIA",
  "HFCL",
  "TITAGARH",
  "JWL",
  "JAMNAAUTO",
  "APARINDS",
  "KIRLOSBROS",
  "KIRLOSENG",
  "KIRLFER",
  "GRINDWELL",
  "TIMKEN",
  "SCHAEFFLER",
  "SKFINDIA",
  "3MINDIA",
  "ASTRAZEN",
  "BAYERCROP",
  "BASF",
  "FDC",
  "AJANTAPHARM",
  "NAVA",
  "TRIDENT",
  "JKTYRE",
  "JINDALSAW",
  "TITAGARH",
  "RITES",
  "JYOTICNC",
  "WAAREEENER",
  "KFINTECH",
  "TBO TEK"
];

// =====================================================
// CLEAN + UNIQUE
// =====================================================

function cleanSymbol(symbol) {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getUniqueStocks() {
  return [
    ...new Set(
      STOCK_UNIVERSE
        .map(cleanSymbol)
        .filter(Boolean)
    )
  ];
}

// =====================================================
// YAHOO SYMBOL
// =====================================================

function toYahooSymbol(symbol, exchange = "NSE") {
  const clean = cleanSymbol(symbol);

  if (
    clean.endsWith(".NS") ||
    clean.endsWith(".BO")
  ) {
    return clean;
  }

  return exchange === "BSE"
    ? `${clean}.BO`
    : `${clean}.NS`;
}

// =====================================================
// STOCK RECORDS
// =====================================================

function getStockRecords() {
  return getUniqueStocks().map((symbol, index) => ({
    id: index + 1,
    symbol,
    exchange: "NSE",
    yahooSymbol: toYahooSymbol(symbol, "NSE")
  }));
}

// =====================================================
// SEARCH STOCK
// =====================================================

function findStock(query) {
  const q = cleanSymbol(query);

  return getStockRecords().filter(stock =>
    stock.symbol.includes(q) ||
    stock.yahooSymbol.includes(q)
  );
}

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  STOCK_UNIVERSE,
  cleanSymbol,
  getUniqueStocks,
  toYahooSymbol,
  getStockRecords,
  findStock
};