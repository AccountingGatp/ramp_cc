/** Property CC Payable GL + optional filename code. In-memory only — no disk I/O. */
export type LocationConfig = { ccGl: string; fileCode?: string };

export const LOCATION_CONFIG: Record<string, LocationConfig> = {
  "rio springs": { ccGl: "1050-1", fileCode: "RI" },
  "morgan manor": { ccGl: "1075-1", fileCode: "MM" },
  "salado creek": { ccGl: "1071-1", fileCode: "SA" },
  istana: { ccGl: "1092-1", fileCode: "IS" },
  "green oaks": { ccGl: "1086-1", fileCode: "GO" },
  "university cove": { ccGl: "1066-5", fileCode: "UC" },
  mila: { ccGl: "1044-1", fileCode: "ML" },
  valencia: { ccGl: "1060-4", fileCode: "VA" },
};
