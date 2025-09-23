import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.x8m3ygf.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

mongoose
  .connect(uri)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// RUM Schema
const RumSchema = new mongoose.Schema({
  timestamp: { type: String, required: true },
  inp: { type: Number, required: true },
  element: { type: String, required: true },
  device: String,
  browser: String,
  os: String,
  connection: String,
  pageUrl: String,
});

const RumModel = mongoose.model("RumModel", RumSchema, "inpValues");

// SSE clients
const clients = [];

// Serve frontend static files
app.use(express.static(path.join(__dirname, "../frontend")));

// Fallback route for /
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// POST /rum
app.post("/rum", async (req, res) => {
  try {
    const doc = new RumModel(req.body);
    await doc.save();

    const dataString = JSON.stringify(req.body);
    clients.forEach((client) => {
      try {
        client.res.write(`data: ${dataString}\n\n`);
      } catch (err) {
        console.error("SSE send error:", err);
      }
    });

    res.json({ status: "ok" });
  } catch (err) {
    console.error("POST /rum error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /rum-data (filter po URL-u)
app.get("/rum-data", async (req, res) => {
  try {
    const filter = {};
    if (req.query.url) filter.pageUrl = req.query.url;

    const data = await RumModel.find(filter).sort({ timestamp: 1 });
    res.json(data);
  } catch (err) {
    console.error("GET /rum-data error:", err);
    res.status(500).json({ error: err.message });
  }
});

// SSE /rum-stream
app.get("/rum-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on("close", () => {
    const index = clients.indexOf(newClient);
    if (index !== -1) clients.splice(index, 1);
  });
});

// Helper functions for status
function getWebVitalStatus(name, value) {
  if (name === "INP (lab)" || name === "TBT") {
    if (value < 200) return "Good";
    if (value <= 500) return "Needs Improvement";
    return "Poor";
  }
  return "Unknown";
}

function getJSMetricStatus(name, value) {
  if (name === "JS blocking time") {
    if (value < 200) return "Low";
    if (value <= 500) return "Medium";
    return "High";
  }
  if (name === "Long tasks count") {
    if (value < 10) return "Low";
    if (value <= 50) return "Medium";
    return "High";
  }
  return "Unknown";
}

// GET /analyze - Playwright metrics (Render-ready)
app.get("/analyze", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"], // cloud safe
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 60000 }); // 60s timeout

    // INP preko Web Vitals
    const metrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        const result = { INP: 0 };
        const script = document.createElement("script");
        script.src =
          "https://unpkg.com/web-vitals@3.3.0/dist/web-vitals.iife.js";
        script.onload = () => {
          webVitals.onINP((m) => {
            result.INP = m.value;
            resolve(result);
          });
        };
        document.head.appendChild(script);
      });
    });

    // Long tasks i JS blocking
    const jsMetrics = await page.evaluate(() => {
      let totalBlockingTime = 0;
      let longTasksCount = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          totalBlockingTime += entry.duration;
          longTasksCount++;
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ jsBlocking: totalBlockingTime, longTasks: longTasksCount });
        }, 1000);
      });
    });

    await browser.close();

    const syntheticMetrics = [
      {
        name: "INP (lab)",
        value: Math.round(metrics.INP || 0),
        status: getWebVitalStatus("INP (lab)", metrics.INP || 0),
      },
      {
        name: "TBT",
        value: Math.round(jsMetrics.jsBlocking || 0),
        status: getWebVitalStatus("TBT", jsMetrics.jsBlocking || 0),
      },
      {
        name: "JS blocking time",
        value: Math.round(jsMetrics.jsBlocking || 0),
        status: getJSMetricStatus(
          "JS blocking time",
          jsMetrics.jsBlocking || 0
        ),
      },
      {
        name: "Long tasks count",
        value: jsMetrics.longTasks || 0,
        status: getJSMetricStatus("Long tasks count", jsMetrics.longTasks || 0),
      },
    ];

    res.json({
      url,
      testRun: new Date().toISOString(),
      device: "Desktop (Chromium, 1920x1080)",
      metrics: syntheticMetrics,
    });
  } catch (err) {
    console.error("Error in /analyze:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
