import fs from "fs";
import path from "path";

import * as XLSX from "xlsx";

export type VendorGlLookup =
  | { status: "single"; gl: string }
  | { status: "multi"; gls: string[] }
  | { status: "none" };

let cachedMap: Map<string, string[]> | null = null;

function normalizeVendorKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractGlCode(glAccount: string): string {
  const match = glAccount.trim().match(/^(\d+(?:-\d+)?)/);
  return match ? match[1] : "";
}

function vendorSheetCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "data", "Ramp_Card_Vendor_GL.xlsx"),
    path.join(cwd, "Ramp_Card_Vendor_GL.xlsx"),
    path.join(cwd, "..", "Ramp_Card_Vendor_GL.xlsx"),
    path.join(cwd, "backend", "data", "Ramp_Card_Vendor_GL.xlsx"),
  ];
}

/** Build vendor → unique GL codes from Ramp_Card_Vendor_GL.xlsx */
export function loadVendorGlMap(): Map<string, string[]> {
  if (cachedMap) return cachedMap;

  const map = new Map<string, string[]>();
  const file = vendorSheetCandidates().find((p) => fs.existsSync(p));
  if (!file) {
    cachedMap = map;
    return map;
  }

  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

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
 * Resolve GL for a flagged (blank code) merchant from the vendor sheet.
 * - exactly one GL for that vendor → use it
 * - multiple GLs → keep flagged (multi)
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

  // 1) Exact vendor match
  for (const q of queries) {
    const hit = map.get(q);
    if (hit) {
      return hit.length === 1
        ? { status: "single", gl: hit[0] }
        : { status: "multi", gls: hit };
    }
  }

  // 2) Token match (e.g. FACEBK *4E5KTUVTH2 → 4E5KTUVTH2)
  for (const q of queries) {
    const tokens = q
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 6);
    for (const token of tokens) {
      const hit = map.get(token);
      if (hit) {
        return hit.length === 1
          ? { status: "single", gl: hit[0] }
          : { status: "multi", gls: hit };
      }
    }
  }

  // 3) Sheet vendor contained in merchant / merchant contained in vendor
  //    Only accept if the match yields a single unique GL across hits.
  const collected = new Set<string>();
  let matchedVendorKeys = 0;
  for (const q of queries) {
    for (const [vendor, gls] of map) {
      if (vendor.length < 4) continue;
      if (q.includes(vendor) || vendor.includes(q)) {
        matchedVendorKeys++;
        for (const gl of gls) collected.add(gl);
      }
    }
  }

  if (collected.size === 1 && matchedVendorKeys > 0) {
    return { status: "single", gl: [...collected][0] };
  }
  if (collected.size > 1) {
    return { status: "multi", gls: [...collected] };
  }

  return { status: "none" };
}
