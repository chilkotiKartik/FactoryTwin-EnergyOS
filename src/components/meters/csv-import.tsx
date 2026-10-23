"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { commitCsvAction, previewCsvAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge, type Tone } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { fmt } from "@/lib/format";

type Preview = NonNullable<Awaited<ReturnType<typeof previewCsvAction>>["data"]>;

const STATUS: Record<string, { tone: Tone; text: string }> = {
  ACCEPT: { tone: "teal", text: "Accept" },
  SUSPECT: { tone: "amber", text: "Suspect (kept, flagged)" },
  REJECT: { tone: "red", text: "Reject" },
  DUPLICATE_IN_FILE: { tone: "neutral", text: "Duplicate in file" },
  DUPLICATE_EXISTING: { tone: "neutral", text: "Already stored" },
};

const MAX = 2 * 1024 * 1024;

/** Upload → server-side preview → explicit commit. The server re-validates the file on commit. */
export function CsvImport({ meters, isSimulation, tz }: { meters: { id: string; name: string; intervalSeconds: number }[]; isSimulation: boolean; tz: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [meterId, setMeterId] = useState(meters[0]?.id ?? "");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [declared, setDeclared] = useState<"UNVERIFIED" | "GENUINE_METER_EXPORT">("UNVERIFIED");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);

  async function load(f: File) {
    setPreview(null);
    if (f.size > MAX) return void toast.error("File is larger than 2 MB. Split it by day.");
    const text = await f.text();
    setFile({ name: f.name, text });
    start(async () => {
      const r = await previewCsvAction(meterId, f.name, text);
      if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not read the file.");
      setPreview(r.data);
    });
  }

  function commit() {
    if (!file) return;
    start(async () => {
      const r = await commitCsvAction(meterId, file.name, file.text, declared);
      if (!r.ok) return void toast.error(r.message ?? "Import failed. Nothing was stored.");
      const d = (r as { data?: { accepted: number; provenance: string } }).data;
      toast.success(`Imported ${fmt(d?.accepted ?? 0)} readings (${d?.provenance.replace("_", " ").toLowerCase()}).`);
      setPreview(null);
      setFile(null);
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  const fmtTs = (ts: number | null) => (ts ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(new Date(ts)) : "—");
  const storable = preview ? preview.counts.ACCEPT + preview.counts.SUSPECT : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Meter
          <Select value={meterId} onChange={(e) => (setMeterId(e.target.value), setPreview(null))}>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.intervalSeconds}s)
              </option>
            ))}
          </Select>
        </label>
        <div
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void load(f);
          }}
          className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed px-4 py-3 ${drag ? "border-blue bg-blue-soft" : "border-line-strong"}`}
        >
          <FileUp className="size-5 text-ink-3" aria-hidden />
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">{file ? file.name : "Drop a CSV here or choose a file"}</p>
            <p className="text-ink-3">
              Columns: <code>timestamp</code>, <code>power_kw</code> and/or <code>energy_kwh</code>. Times without an offset are read as factory time. Max 2 MB.
            </p>
          </div>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="csv-file" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          <Button asChild variant="secondary" size="sm">
            <label htmlFor="csv-file" className="cursor-pointer">
              Choose file
            </label>
          </Button>
        </div>
      </div>
      {!isSimulation ? (
        <fieldset className="flex flex-wrap gap-4 text-[13px]">
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Source of this file</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="declared" checked={declared === "UNVERIFIED"} onChange={() => setDeclared("UNVERIFIED")} /> Unverified / other source
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="declared" checked={declared === "GENUINE_METER_EXPORT"} onChange={() => setDeclared("GENUINE_METER_EXPORT")} /> Genuine export from this meter (labelled MEASURED)
          </label>
        </fieldset>
      ) : (
        <p className="text-[12px] text-ink-3">This is a simulation factory, so imported readings are labelled SIMULATED whatever their source.</p>
      )}
      {pending && !preview ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <Loader2 className="size-4 animate-spin" /> Checking every row on the server…
        </p>
      ) : null}
      {preview?.fatal ? <p className="rounded-md bg-red-soft px-3 py-2 text-[13px] text-red">{preview.fatal}</p> : null}
      {preview && !preview.fatal ? (
        <div className="flex flex-col gap-3" data-testid="csv-preview">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">{fmt(preview.totalRows)} rows</span>
            <span className="text-ink-3">
              {fmtTs(preview.firstTs)} → {fmtTs(preview.lastTs)}
            </span>
            {Object.entries(preview.counts).map(([k, n]) =>
              n > 0 ? (
                <Badge key={k} tone={STATUS[k].tone}>
                  {STATUS[k].text}: {fmt(n)}
                </Badge>
              ) : null,
            )}
          </div>
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <Table>
              <thead>
                <tr>
                  <Th align="right">Line</Th>
                  <Th>Timestamp</Th>
                  <Th align="right">kW</Th>
                  <Th align="right">kWh</Th>
                  <Th>Status</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <Td align="right">{r.line}</Td>
                    <Td className="num">{r.ts ? fmtTs(r.ts) : (Object.values(r.raw)[0] ?? "")}</Td>
                    <Td align="right">{fmt(r.powerKw, 1)}</Td>
                    <Td align="right">{fmt(r.energyKwh, 3)}</Td>
                    <Td>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Badge>
                    </Td>
                    <Td className="whitespace-normal text-[12px] text-ink-3">{r.message}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="text-[12px] text-ink-3">Showing problem rows first and a sample of accepted rows. Rejected and duplicate rows are never stored.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (setPreview(null), setFile(null))} disabled={pending}>
              Discard
            </Button>
            <Button onClick={commit} disabled={pending || storable === 0} data-testid="csv-commit">
              {pending ? <Loader2 className="animate-spin" /> : <Upload />} Import {fmt(storable)} readings
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
