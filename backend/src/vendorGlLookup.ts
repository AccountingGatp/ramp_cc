import fs from "fs";
import path from "path";

import * as XLSX from "xlsx";

export type VendorGlLookup =
  | { status: "single"; gl: string }
  | { status: "multi"; gls: string[] }
  | { status: "none" };

type VendorGlRow = {
  Vendor?: string;
  "GL Account"?: string;
};

let cachedMap: Map<string, string[]> | null = null;

function normalizeVendorKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extractGlCode(glAccount: string): string {
  const match = glAccount.trim().match(/^(\d+(?:-\d+)?)/);
  return match ? match[1] : "";
}

function vendorDataCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "data", "Ramp_Card_Vendor_GL.json"),
    path.join(cwd, "Ramp_Card_Vendor_GL.json"),
    path.join(cwd, "..", "Ramp_Card_Vendor_GL.json"),
    path.join(cwd, "backend", "data", "Ramp_Card_Vendor_GL.json"),
    path.join(cwd, "data", "Ramp_Card_Vendor_GL.xlsx"),
    path.join(cwd, "Ramp_Card_Vendor_GL.xlsx"),
    path.join(cwd, "..", "Ramp_Card_Vendor_GL.xlsx"),
    path.join(cwd, "backend", "data", "Ramp_Card_Vendor_GL.xlsx"),
  ];
}

function loadRowsFromFile(file: string): VendorGlRow[] {
  if (file.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as VendorGlRow[]) : [];
  }

  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<VendorGlRow>(sheet, { defval: "" });
}

/** Build vendor → unique GL codes from Ramp_Card_Vendor_GL.json (xlsx fallback). */
export function loadVendorGlMap(): Map<string, string[]> {
  if (cachedMap) return cachedMap;

  const map = new Map<string, string[]>();
  const file = vendorDataCandidates().find((p) => fs.existsSync(p));
  if (!file) {
    cachedMap = map;
    return map;
  }

  const rows = loadRowsFromFile(file);
  for (const row of rows) {
    const vendor = String(row.Vendor ?? "").trim();
    const gl = extractGlCode(String(row["GL Account"] ?? ""));
    if (!vendor || !gl) continue;

    const key = normalizeVendorKey(vendor);
    const list = map.get(key) ?? [];
    if (!list.includes(gl)) list.push(gl);
    map.set(key, list);
  }

  cachedMap = map;
  return map;
}

/**
 * Resolve GL for a blank Accounting Category Code from vendor JSON.
 * - exactly one GL for that vendor → use it
 * - multiple GLs → keep blank (multi)
 * - not found → none
 */
export function lookupVendorGl(
  merchantDescription: string,
  merchantName = "",
): VendorGlLookup {
  const map = loadVendorGlMap();
  if (map.size === 0) return { status: "none" };

  const queries = [merchantDescription, merchantName]
    .map(normalizeVendorKey)
    .filter(Boolean);

  const resultFromHits = (hits: string[]): VendorGlLookup => {
    if (hits.length === 1) return { status: "single", gl: hits[0] };
    if (hits.length > 1) return { status: "multi", gls: hits };
    return { status: "none" };
  };

  // 1) Exact vendor match — most specific, do not mix with shorter names like "Cash Flow"
  for (const q of queries) {
    const hit = map.get(q);
    if (hit) return resultFromHits(hit);
  }

  // 2) Token match (e.g. FACEBK *4E5KTUVTH2 → 4E5KTUVTH2)
  for (const q of queries) {
    const tokens = q
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 6);
    for (const token of tokens) {
      const hit = map.get(token);
      if (hit) return resultFromHits(hit);
    }
  }

  // 3) Longest vendor-name match only (ignore shorter generic names)
  let bestLen = 0;
  const bestGls = new Set<string>();
  for (const q of queries) {
    for (const [vendor, gls] of map) {
      if (vendor.length < 8) continue;
      if (!(q.includes(vendor) || vendor.includes(q))) continue;
      if (vendor.length > bestLen) {
        bestLen = vendor.length;
        bestGls.clear();
        for (const gl of gls) bestGls.add(gl);
      } else if (vendor.length === bestLen) {
        for (const gl of gls) bestGls.add(gl);
      }
    }
  }

  return resultFromHits([...bestGls]);
}
