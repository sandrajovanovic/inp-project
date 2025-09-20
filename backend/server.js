import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";

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
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

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

// Koristi kolekciju inpValues
const RumModel = mongoose.model("RumModel", RumSchema, "inpValues");

// SSE clients
const clients = [];

// Serve frontend
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

// GET /rum-data (može filter po URL-u)
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

// GET /analyze (synthetic)
app.get("/analyze", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const syntheticMetrics = [
    { name: "INP (lab)", value: 219, status: "Needs Improvement" },
    { name: "TBT", value: 142, status: "Good" },
    { name: "JS blocking time", value: 213, status: "High" },
    { name: "Long tasks count", value: 5, status: "Needs Improvement" },
  ];

  res.json({
    url,
    testRun: new Date().toISOString(),
    device: "Desktop (Chrome, 4G, 1920x1080)",
    metrics: syntheticMetrics,
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
