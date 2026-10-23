import { z } from "zod";

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use date and time (YYYY-MM-DDTHH:MM).");

const optionalDateTime = z.union([localDateTime, z.literal("")]).optional();
const optionalNum = z.union([z.number(), z.nan()]).optional().nullable();

export const heatInputSchema = z.object({
  heatNo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,12}$/, "Heat number: letters, digits and dashes, up to 12."),
  grade: z.string().trim().max(40).default(""),
  orderCode: z.string().trim().max(30).default(""),
  chargeKg: z.number({ error: "Charge is required." }).positive("Charge must be above zero.").max(100000),
  pouredKg: optionalNum,
  startAt: localDateTime,
  tapAt: optionalDateTime,
  mouldSet: optionalNum,
  mouldReadyAt: optionalDateTime,
  manualKwh: optionalNum,
  operatorNotes: z.string().trim().max(500).default(""),
});
export type HeatInput = z.infer<typeof heatInputSchema>;

