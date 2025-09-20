import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config(); // učitava .env fajl

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Atlas connection using .env
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.x8m3ygf.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

mongoose
  .connect(uri)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// MongoDB schema
const RumSchema = new mongoose.Schema({
  timestamp: { type: Date, required: true }, // bolje kao Date
  inp: { type: Number, required: true },
  element: { type: String, required: true },
  device: String,
  browser: String,
  os: String,
  connection: String,
  pageUrl: String,
});

// Model → kolekcija u bazi biće "rums"
const RumModel = mongoose.model("Rum", RumSchema);

// Memorija za SSE klijente
const clients = [];

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// POST endpoint za čuvanje RUM podataka
app.post("/rum", async (req, res) => {
  try {
    const doc = new RumModel(req.body);
    await doc.save();

    // Push na SSE klijente
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

// GET endpoint za dobijanje svih RUM podataka
app.get("/rum-data", async (req, res) => {
  try {
    const data = await RumModel.find().sort({ timestamp: -1 }).limit(100);
    res.json(data);
  } catch (err) {
    console.error("GET /rum-data error:", err);
    res.status(500).json({ error: err.message });
  }
});

// SSE stream za live podatke
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
