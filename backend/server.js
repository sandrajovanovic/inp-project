import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { chromium, devices } from "playwright";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uri = "mongodb://127.0.0.1:27017/inpProjectDB";
mongoose
  .connect(uri)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

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

app.use(express.static(path.join(__dirname, "../frontend")));

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

// GET /rum-data
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

// Playwright synthetic metrics with realistic user simulation
async function analyzePage(url) {
  const browser = await chromium.launch({ headless: true });
  const motoG4 = devices["Moto G4"];
  const context = await browser.newContext({
    ...motoG4,
    viewport: motoG4.viewport,
    userAgent: motoG4.userAgent,
  });

  const page = await context.newPage();

  // Start PerformanceObserver pre-load
  await page.addInitScript(() => {
    window.longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.longTasks.push(entry.duration);
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  });

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 200,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  try {
    await page.goto(url, { waitUntil: "load" });
  } catch (err) {
    console.error("Page.goto failed:", err.message);
    await browser.close();
    throw new Error("Page failed to load");
  }

  // ~5 sekunds
  const simulateInteractions = async () => {
    const startTime = Date.now();
    while (Date.now() - startTime < 5000) {
      const clickable = await page.$$(
        'button, a, [role="button"], input[type="checkbox"]'
      );
      for (const el of clickable) {
        await el.click().catch(() => {});
        await page.waitForTimeout(100 + Math.random() * 200);
      }

      const inputs = await page.$$('input[type="text"], textarea');
      for (const input of inputs) {
        await input.focus().catch(() => {});
        await page.keyboard.type("Test INP").catch(() => {});
        await page.waitForTimeout(100 + Math.random() * 200);
      }

      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 300);
        const start = performance.now();
        while (performance.now() - start < 50 + Math.random() * 50) {}
      });

      await page.waitForTimeout(200 + Math.random() * 300);
    }
  };

  await simulateInteractions();

  const longTasks = await page.evaluate(() => window.longTasks || []);
  const tbt = longTasks.reduce((sum, task) => sum + task, 0);
  const inp = longTasks.length > 0 ? Math.max(...longTasks) : 0;

  // Thresholds
  const metrics = [
    {
      name: "INP (lab)",
      value: Math.round(inp) + " ms",
      status: inp <= 200 ? "Good" : inp <= 500 ? "Needs Improvement" : "Poor",
    },
    {
      name: "TBT",
      value: Math.round(tbt) + " ms",
      status: tbt <= 200 ? "Good" : tbt <= 600 ? "Needs Improvement" : "Poor",
    },
    {
      name: "Long tasks count",
      value: longTasks.length,
      status:
        longTasks.length <= 5
          ? "Good"
          : longTasks.length <= 15
          ? "Needs Improvement"
          : "Poor",
    },
  ];

  await browser.close();
  return metrics;
}

// GET /analyze
app.get("/analyze", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const metrics = await analyzePage(url);

    res.json({
      url,
      testRun: new Date().toISOString(),
      device: "Moto G4 (Mobile, 4G throttled, CPU slowed)",
      metrics,
    });
  } catch (err) {
    console.error("Error analyzing page:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
