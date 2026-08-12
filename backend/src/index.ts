import cors from "cors";
import express from "express";
import multer from "multer";

import { processRampStatement } from "./rampImport.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
  }),
);
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);
});
