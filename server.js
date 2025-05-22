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

console.log(API_KEY);

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

// get current btc price data
app.get("/btc-data", async (req, res) => {
  const now = Date.now();
  if (cachedBtcData && now - lastFetchTime < CACHE_DURATION_MS) {
    // Return cached data if still valid
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
  // Expecting date param in dd-mm-yyyy format, e.g. 19-05-2025
  const date = req.params.date;

  // Validate date format (basic check)
  if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Invalid date format. Use dd-mm-yyyy." });
  }

  try {
    // Check cache first
    const cached = getPriceFromCache(date);
    if (cached) {
      return res.json(cached);
    }

    // Not cached, fetch from CoinGecko
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${date}&localization=false&x_cg_demo_api_key=${apiKey}`
    );
    if (!response.ok) {
      throw new Error(`CoinGecko responded with status ${response.status}`);
    }

    const data = await response.json();

    // Cache it for next time
    savePriceToCache(date, data);

    return res.json(data);
  } catch (error) {
    console.error("Error fetching historical BTC price:", error);
    return res.status(500).json({ error: "Failed to fetch BTC price history" });
  }
});

app.listen(PORT, () => {
  console.log(`BTC data backend running on http://localhost:${PORT}`);
});
