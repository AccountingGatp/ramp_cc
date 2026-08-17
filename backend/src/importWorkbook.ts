import ExcelJS from "exceljs";

import { IMPORT_HEADERS, type ImportRow } from "./rampImport.js";

const RED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFF0000" },
};

/** Build ResMan import .xlsx; blank expense GL cells are filled red. */
export async function buildImportXlsx(rows: ImportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.addRow([...IMPORT_HEADERS]);
  const header = sheet.getRow(1);
  header.font = { bold: true };

  for (const row of rows) {
    const values = IMPORT_HEADERS.map((h) => row[h]);
    const excelRow = sheet.addRow(values);

    // Expense lines (odd data rows after header) with blank GL → red cell
    const glCell = excelRow.getCell(3); // GL Account Number
    if (!String(row["GL Account Number"] ?? "").trim()) {
      glCell.fill = RED_FILL;
    }
  }

  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 48);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
