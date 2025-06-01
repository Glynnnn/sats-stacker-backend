// server.js or backend.js
import express from "express";
import fetch from "node-fetch"; // or built-in fetch if Node >=18
import cors from "cors";
import db from "./db.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = 3000;

const API_KEY = process.env.API_KEY;

function getPriceFromCache(date) {
  const row = db
    .prepare("SELECT price_data, timestamp FROM btc_price_cache WHERE date = ?")
    .get(date);
  if (row) {
    const age = Date.now() - row.timestamp;
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (age < oneDayMs) {
      return JSON.parse(row.price_data);
    }
  }
  return null;
}

function pruneOldCacheEntries(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const deleted = db
    .prepare("DELETE FROM btc_price_cache WHERE timestamp < ?")
    .run(cutoff);
  console.log(`Pruned ${deleted.changes} old cache entries`);
}

function savePriceToCache(date, priceData) {
  const timestamp = Date.now();
  db.prepare(
    `
    INSERT OR REPLACE INTO btc_price_cache (date, price_data, timestamp)
    VALUES (?, ?, ?)
  `
  ).run(date, JSON.stringify(priceData), timestamp);
}

app.use(cors()); // allow cross-origin requests from your frontend

// Cache object and cache duration (e.g., 5 minutes)
let cachedBtcData = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000;

setInterval(() => pruneOldCacheEntries(), 5 * 60 * 60 * 1000); // every 5 hours

// get current btc price data
app.get("/btc-data", async (req, res) => {
  const now = Date.now();
  if (cachedBtcData && now - lastFetchTime < CACHE_DURATION_MS) {
    // Return cached data if still valid
    console.log("Price from cache");
    return res.json(cachedBtcData);
  }

  try {
    const currencies = ["usd", "aud", "gbp", "eur", "cad"];
    const currencyParams = currencies.join(",");

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currencyParams}&include_market_cap=true&include_24hr_change=true&x_cg_demo_api_key=${API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.statusText}`);
    }
    console.log("Price from API");
    const data = await response.json();

    // Format response same as your frontend expects
    const btcData = {};
    currencies.forEach((currency) => {
      const upper = currency.toUpperCase();
      btcData[upper] = {
        price: data.bitcoin[currency],
        percentChange24h: data.bitcoin[`${currency}_24h_change`],
        marketCap: data.bitcoin[`${currency}_market_cap`],
      };
    });

    // Cache the data and timestamp
    cachedBtcData = btcData;
    lastFetchTime = now;

    res.json(btcData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch BTC data" });
  }
});

// get historical btc price data then cache in db for 24 hours
app.get("/btc-price-history/:date", async (req, res) => {
  console.log("Get historical data");
  const date = req.params.date; // e.g. "19-05-2025"
  const currencyParam = req.query.currency?.toString().toLowerCase();
  const supportedCurrencies = ["usd", "aud", "cad", "eur", "gbp"];

  // Validate date format (dd-mm-yyyy)
  if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Invalid date format. Use dd-mm-yyyy." });
  }

  // Determine if user requested a single supported currency or all
  const isSingleCurrency =
    currencyParam && supportedCurrencies.includes(currencyParam);
  const currenciesToReturn = isSingleCurrency
    ? [currencyParam]
    : supportedCurrencies;

  try {
    console.log("Trying to get historical data");
    // Use combined currency key for cache
    const cacheKey = `${date}-${currenciesToReturn.join(",")}`;
    const cached = getPriceFromCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Fetch from CoinGecko
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${date}&localization=false&x_cg_demo_api_key=${API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko responded with status ${response.status}`);
    }
    console.log("Response: " + response);
    const data = await response.json();
    const allPrices = data?.market_data?.current_price;

    if (!allPrices) {
      return res
        .status(400)
        .json({ error: "Price data not available for this date" });
    }

    // Extract and filter only supported currencies
    const filteredPrices = {};
    for (const currency of currenciesToReturn) {
      if (allPrices[currency]) {
        filteredPrices[currency] = allPrices[currency];
      }
    }

    if (Object.keys(filteredPrices).length === 0) {
      return res
        .status(400)
        .json({ error: "No supported currencies found for this date" });
    }

    const result = {
      date,
      prices: filteredPrices,
    };

    savePriceToCache(cacheKey, result);
    return res.json(result);
  } catch (error) {
    console.error("Error fetching BTC historical price:", error);
    return res.status(500).json({ error: "Failed to fetch BTC price history" });
  }
});

app.listen(PORT, () => {
  console.log(`BTC data backend running on http://localhost:${PORT}`);
});
