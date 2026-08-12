"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://ramp-cc-api.vercel.app";

type ProcessSummary = {
  transactionCount: number;
  importLineCount: number;
  flaggedCount: number;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  propertyCode: string;
  periodYYYYMM: string;
  importFileName: string;
  skippedNonTransactionCount: number;
  properties: string[];
};

type UploadResult = {
  message: string;
  file: {
    name: string;
    mimetype: string;
    size: number;
    bytesInMemory: number;
  };
  summary: ProcessSummary;
  importCsv: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMoney(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const pickFile = useCallback((next: File | null) => {
    setError(null);
    setResult(null);

    if (!next) {
      setFile(null);
      return;
    }

    if (!next.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file");
      setFile(null);
      return;
    }

    setFile(next);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const dropped = event.dataTransfer.files?.[0] ?? null;
      pickFile(dropped);
    },
    [pickFile],
  );

  const upload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setResult(data as UploadResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-16">
      <div className="w-full max-w-xl space-y-6">
        <div className="space-y-2 text-center">
          <Badge variant="secondary">Ramp → ResMan</Badge>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            CC Import Sheet
          </h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Upload a Ramp credit card statement CSV. We filter transactions,
            build debit/credit lines, and generate the ResMan import + flagged
            files.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload statement</CardTitle>
            <CardDescription>
              Drag and drop a Ramp CSV, or browse to select one. Max 10 MB.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 transition-colors",
                dragging
                  ? "border-primary bg-muted"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <div className="rounded-full bg-muted p-3">
                <Upload className="size-5 text-muted-foreground" />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-sm font-medium">
                  Drag & drop a Ramp CSV, or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  .csv only · processed in memory
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) =>
                  pickFile(event.target.files?.[0] ?? null)
                }
              />
            </div>

            {file && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove file"
                  onClick={(event) => {
                    event.stopPropagation();
                    pickFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  <X />
                </Button>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              className="w-full"
              disabled={!file || uploading}
              onClick={upload}
            >
              {uploading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Processing…
                </>
              ) : (
                "Generate Import Sheet"
              )}
            </Button>
          </CardFooter>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-foreground" />
                    Import ready
                  </CardTitle>
                  <CardDescription>{result.message}</CardDescription>
                </div>
                <Badge variant={result.summary.balanced ? "secondary" : "destructive"}>
                  {result.summary.balanced ? "Balanced" : "Unbalanced"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Transactions</dt>
                  <dd className="font-medium">{result.summary.transactionCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Import lines</dt>
                  <dd className="font-medium">{result.summary.importLineCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total Debit</dt>
                  <dd className="font-medium font-mono">
                    {formatMoney(result.summary.totalDebit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total Credit</dt>
                  <dd className="font-medium font-mono">
                    {formatMoney(result.summary.totalCredit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Property</dt>
                  <dd className="font-medium">
                    {result.summary.properties.join(", ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Period</dt>
                  <dd className="font-medium font-mono">
                    {result.summary.periodYYYYMM}
                  </dd>
                </div>
              </dl>

              {result.summary.flaggedCount > 0 && (
                <>
                  <Separator />
                  <Alert>
                    <AlertTriangle />
                    <AlertTitle>
                      {result.summary.flaggedCount} flagged transaction
                      {result.summary.flaggedCount === 1 ? "" : "s"} included
                    </AlertTitle>
                    <AlertDescription>
                      Marked in the Reference column. Review those lines before
                      importing to ResMan.
                    </AlertDescription>
                  </Alert>
                </>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="button"
                className="w-full"
                onClick={() =>
                  downloadCsv(result.summary.importFileName, result.importCsv)
                }
              >
                <Download />
                <span className="truncate">{result.summary.importFileName}</span>
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </main>
  );
}
