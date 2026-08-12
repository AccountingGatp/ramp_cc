import express from "express";
import multer from "multer";

import { processRampStatement } from "./rampImport.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

/** Allow all origins (e.g. https://ramp-cc.vercel.app) */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json());

/** Keep the CSV in memory only — never write to disk */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");

    if (isCsv) {
      cb(null, true);
      return;
    }

    cb(new Error("Only CSV files are allowed"));
  },
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No CSV file uploaded" });
    return;
  }

  // Buffer only — never persisted to disk
  const { originalname, mimetype, size, buffer } = req.file;

  try {
    const text = buffer.toString("utf-8");
    const processed = processRampStatement(text);

    res.json({
      message: processed.summary.balanced
        ? processed.summary.flaggedCount > 0
          ? `Import sheet generated (balanced) — ${processed.summary.flaggedCount} flagged row(s) marked in Reference`
          : "Import sheet generated — Total Debit = Total Credit (balanced)"
        : "Import sheet generated — WARNING: Debit and Credit totals do not match",
      file: {
        name: originalname,
        mimetype,
        size,
        bytesInMemory: buffer.length,
      },
      summary: processed.summary,
      importCsv: processed.importCsv,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to process CSV",
    });
  }
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(400).json({ error: err.message || "Upload failed" });
  },
);

// Local / traditional Node host only — Vercel uses the exported app
if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;
