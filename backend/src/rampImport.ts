import { getField, parseCsv, toCsv } from "./csv.js";
import { LOCATION_CONFIG, type LocationConfig } from "./locationConfig.js";
import { lookupVendorGl, extractGlCode } from "./vendorGlLookup.js";

export const IMPORT_HEADERS = [
  "Property Abbreviation",
  "Date",
  "GL Account Number",
  "Description",
  "Debit",
  "Credit",
  "Accounting Basis",
  "Line-Item Description",
  "Reversal Date",
  "Reference",
] as const;

export const FLAGGED_HEADERS = [
  "Date",
  "Amount",
  "Merchant Description",
  "Ramp Location",
  "External ID",
  "Issue",
] as const;

export type ImportRow = Record<(typeof IMPORT_HEADERS)[number], string>;
export type FlaggedRow = Record<(typeof FLAGGED_HEADERS)[number], string>;

export type ProcessSummary = {
  transactionCount: number;
  importLineCount: number;
  flaggedCount: number;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  propertyCode: string;
  periodYYYYMM: string;
  importCsvFileName: string;
  importXlsxFileName: string;
  skippedNonTransactionCount: number;
  properties: string[];
};

export type ProcessResult = {
  importCsv: string;
  importRows: ImportRow[];
  flaggedRows: FlaggedRow[];
  summary: ProcessSummary;
};

function loadLocationConfig(): Record<string, LocationConfig> {
  return LOCATION_CONFIG;
}

function normalizeLocationKey(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Initials from Ramp Location words (letters only): "Rio Springs" → "RS". */
export function derivePropertyAbbreviation(location: string): string {
  const words = location
    .trim()
    .split(/[\s/_-]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);

  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join("");
}

function resolveLocationConfig(location: string): LocationConfig | null {
  const map = loadLocationConfig();
  const key = normalizeLocationKey(location);
  if (map[key]) return map[key];
  for (const [name, cfg] of Object.entries(map)) {
    if (key === name || key.startsWith(`${name} `) || key.includes(name)) {
      return cfg;
    }
  }
  return null;
}

function normalizeMerchantKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function processRampStatement(csvText: string): ProcessResult {
  const { headers, rows } = parseCsv(csvText);

  if (headers.length === 0) {
    throw new Error("CSV is empty");
  }

  const required = ["Type", "Amount", "Merchant Description", "Ramp Location"];
  const lower = headers.map((h) => h.trim().toLowerCase());
  const missing = required.filter((r) => !lower.includes(r.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `Not a Ramp statement CSV. Missing columns: ${missing.join(", ")}. Upload the Ramp export (with Type, Transaction Date, etc.), not the ResMan import sheet.`,
    );
  }

  const hasTransactionDate = lower.includes("transaction date");
  const hasClearingDate = lower.includes("clearing date");
  if (!hasTransactionDate && !hasClearingDate) {
    throw new Error("Ramp CSV must include Transaction Date or Clearing Date");
  }

  // Same merchant in this file with exactly one GL → use it for blank rows
  const merchantGlsInFile = new Map<string, Set<string>>();
  for (const row of rows) {
    if (getField(row, "Type").toLowerCase() !== "transaction") continue;
    const merchant = normalizeMerchantKey(
      getField(row, "Merchant Description", "Merchant Name"),
    );
    if (!merchant) continue;
    const gl =
      extractGlCode(getField(row, "Accounting Category Code")) ||
      extractGlCode(getField(row, "Accounting Category"));
    if (!gl) continue;
    const set = merchantGlsInFile.get(merchant) ?? new Set<string>();
    set.add(gl);
    merchantGlsInFile.set(merchant, set);
  }

  const importRows: ImportRow[] = [];
  const flaggedRows: FlaggedRow[] = [];
  let skippedNonTransactionCount = 0;
  const propertyCodes = new Set<string>();
  const fileCodes = new Set<string>();
  const dates: Date[] = [];
  let headerMemo = "";

  for (const row of rows) {
    const type = getField(row, "Type");
    const dateRaw = hasTransactionDate
      ? getField(row, "Transaction Date", "Date") ||
        getField(row, "Clearing Date")
      : getField(row, "Clearing Date");
    const amountRaw = getField(row, "Amount");
    const merchant = getField(row, "Merchant Description", "Merchant Name");
    const merchantName = getField(row, "Merchant Name");
    const location = getField(row, "Ramp Location", "Location");
    let glCode =
      extractGlCode(getField(row, "Accounting Category Code")) ||
      extractGlCode(getField(row, "Accounting Category"));
    const externalId = getField(row, "External ID", "Transaction ID", "Id");
    if (!headerMemo) headerMemo = getField(row, "Header Memo");

    if (type.toLowerCase() !== "transaction") {
      skippedNonTransactionCount++;
      continue;
    }

    const parsedDate = parseFlexibleDate(dateRaw);
    const outputDate = formatOutputDate(parsedDate) || dateRaw;
    const signed = parseSignedAmount(amountRaw);

    if (signed === null) {
      continue;
    }

    let flagNote = "";
    // Missing GL in Ramp → blank + red, unless this file or vendor JSON has exactly one GL
    if (!glCode) {
      const inFile = merchantGlsInFile.get(normalizeMerchantKey(merchant));
      if (inFile && inFile.size === 1) {
        glCode = [...inFile][0];
        flagNote = "";
      } else {
        const vendorHit = lookupVendorGl(merchant, merchantName);
        if (vendorHit.status === "single") {
          glCode = vendorHit.gl;
          flagNote = "";
        } else if (vendorHit.status === "multi") {
          glCode = "";
          flagNote = `FLAGGED: Vendor has multiple GLs (${vendorHit.gls.join(", ")})`;
        } else {
          glCode = "";
          flagNote = "FLAGGED: Blank Accounting Category Code";
        }
      }
    }

    const propertyAbbr = derivePropertyAbbreviation(location);
    if (!propertyAbbr) {
      skippedNonTransactionCount++;
      continue;
    }

    const locCfg = resolveLocationConfig(location);
    if (!locCfg?.ccGl) {
      skippedNonTransactionCount++;
      continue;
    }

    const amount = formatMoneyAmount(Math.abs(signed));
    const isRefund = signed < 0;

    propertyCodes.add(propertyAbbr);
    if (locCfg.fileCode) fileCodes.add(locCfg.fileCode);
    if (parsedDate) dates.push(parsedDate);

    if (flagNote) {
      flaggedRows.push({
        Date: outputDate,
        Amount: amountRaw,
        "Merchant Description": merchant,
        "Ramp Location": location,
        "External ID": externalId,
        Issue: flagNote.replace(/^FLAGGED:\s*/, ""),
      });
    }

    // LINE 1 — Expense (Debit for charges, Credit for refunds)
    importRows.push({
      "Property Abbreviation": propertyAbbr,
      Date: outputDate,
      "GL Account Number": glCode,
      Description: merchant,
      Debit: isRefund ? "" : amount,
      Credit: isRefund ? amount : "",
      "Accounting Basis": "Both",
      "Line-Item Description": merchant,
      "Reversal Date": "",
      Reference: flagNote,
    });

    // LINE 2 — CC Payable (Credit for charges, Debit for refunds)
    importRows.push({
      "Property Abbreviation": propertyAbbr,
      Date: outputDate,
      "GL Account Number": locCfg.ccGl,
      Description: merchant,
      Debit: isRefund ? amount : "",
      Credit: isRefund ? "" : amount,
      "Accounting Basis": "Both",
      "Line-Item Description": merchant,
      "Reversal Date": "",
      Reference: flagNote,
    });
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of importRows) {
    if (r.Debit) totalDebit += Number(r.Debit);
    if (r.Credit) totalCredit += Number(r.Credit);
  }
  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);

  const propertyCode =
    fileCodes.size === 1
      ? [...fileCodes][0]
      : propertyCodes.size === 1
        ? [...propertyCodes][0]
        : propertyCodes.size === 0
          ? "UNK"
          : "MULTI";

  const periodYYYYMM = derivePeriodYYYYMM(headerMemo, dates);
  const importBaseName = `Ramp_CC_Import_${propertyCode}_${periodYYYYMM}`;

  return {
    importCsv: toCsv([...IMPORT_HEADERS], importRows),
    importRows,
    flaggedRows,
    summary: {
      transactionCount: importRows.length / 2,
      importLineCount: importRows.length,
      flaggedCount: flaggedRows.length,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
      propertyCode,
      periodYYYYMM,
      importCsvFileName: `${importBaseName}.csv`,
      importXlsxFileName: `${importBaseName}.xlsx`,
      skippedNonTransactionCount,
      properties: [...propertyCodes].sort(),
    },
  };
}

function parseSignedAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Whole dollars without decimals; trim trailing zeros (303.10 → 303.1). */
function formatMoneyAmount(abs: number): string {
  const rounded = round2(abs);
  if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
  return rounded
    .toFixed(2)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseFlexibleDate(value: string): Date | null {
  if (!value) return null;
  const mdy4 = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy4) {
    return new Date(Number(mdy4[3]), Number(mdy4[1]) - 1, Number(mdy4[2]));
  }
  const mdy2 = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdy2) {
    const yy = Number(mdy2[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return new Date(year, Number(mdy2[1]) - 1, Number(mdy2[2]));
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatOutputDate(d: Date | null): string {
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function derivePeriodYYYYMM(headerMemo: string, dates: Date[]): string {
  const fromMemo = headerMemo.match(/Ramp_Statement_(\d{4})(\d{2})\d{2}/i);
  if (fromMemo) return `${fromMemo[1]}${fromMemo[2]}`;

  if (dates.length === 0) {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let best = "";
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && key > best)) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}
