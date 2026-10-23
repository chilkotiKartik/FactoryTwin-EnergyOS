/**
 * Evidence labels used everywhere a number is shown.
 *  VERIFIED   supported by an identified source
 *  ASSUMPTION a configuration or modelling choice
 *  SIMULATED  synthetic scenario data or a synthetic outcome
 *  MODELLED   a projection or analytical estimate (optimiser predictions, payback)
 *  MEASURED   observations from a genuine meter or documented field dataset
 */
export const EVIDENCE_LABELS = ["VERIFIED", "ASSUMPTION", "SIMULATED", "MODELLED", "MEASURED"] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

/** Provenance of a stored record. */
export const PROVENANCES = ["SIMULATED", "MEASURED", "MANUAL", "IMPORTED_UNVERIFIED"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/**
 * Combine record provenances into the label for a derived figure. A figure is only
 * MEASURED when every contributing record is MEASURED. Any synthetic input makes
 * the result SIMULATED. Manual or unverified imports are treated as unverified
 * observations and never upgrade to MEASURED.
 */
export function combineProvenance(items: Iterable<Provenance>): EvidenceLabel | "UNVERIFIED" | "NO_DATA" {
  let any = false;
  let allMeasured = true;
  let anySim = false;
  for (const p of items) {
    any = true;
    if (p === "SIMULATED") anySim = true;
    if (p !== "MEASURED") allMeasured = false;
  }
  if (!any) return "NO_DATA";
  if (anySim) return "SIMULATED";
  if (allMeasured) return "MEASURED";
  return "UNVERIFIED";
}

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  note: string;
}

/** Sources taken from the FactoryTwin EnergyOS deck and its speaker notes. */
export const SOURCES: SourceRef[] = [
  {
    id: "challenge04",
    title: "Yuva Yodha Energy Tech Hackathon 2026 — Challenge 04 brief (Schneider Electric)",
    url: "https://www.yuvayodhatech.com/challenges",
    note: "Industry share of energy, SME energy cost share, solution areas incl. scheduling and load shifting.",
  },
  {
    id: "bop-foundry",
    title: "GEF–UNIDO–BEE, Energy Efficiency Best Operating Practices Guide for Foundries (TERI, 2015)",
    url: "https://sameeeksha.org/brouchres/BOP-Guide-Oct2015.pdf",
    note: "Induction-furnace loss mechanisms (holding, superheat, lid), 500 kg / 550 kW furnace, ~35 min melt at full power, heat-by-heat monitoring.",
  },
  {
    id: "kolhapur",
    title: "TERI/SAMEEEKSHA, Kolhapur Foundry Cluster Profile",
    url: "https://www.sameeeksha.org/pdf/clusterprofile/Kolhapur_foundry_cluster.pdf",
    note: "600–700 kWh per tonne of melt in Kolhapur foundries; under 600 achievable.",
  },
  {
    id: "tod-rules",
    title: "Ministry of Power, Electricity (Rights of Consumers) Amendment Rules, 2023 (PIB PRID 1945236)",
    url: "https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=1945236",
    note: "ToD tariff: C&I peak at least 1.20× normal; solar-hour tariff at least 20% below normal. Exact windows and rates are set by each state commission.",
  },
  {
    id: "cea-co2",
    title: "Central Electricity Authority, CO2 Baseline Database for the Indian Power Sector, User Guide v20.0",
    url: "https://cea.nic.in/wp-content/uploads/2021/03/User_Guide_Version_20.0.pdf",
    note: "Weighted average grid emission factor 0.727 kgCO2/kWh for FY 2023-24 as cited in the deck. A newer version (v22.0) exists; check and update the factor in Settings before relying on it.",
  },
  {
    id: "pme",
    title: "Schneider Electric, EcoStruxure Power Monitoring Expert — Energy Analysis Reports Module",
    url: "https://product-help.schneider-electric.com/EcoStruxure-Power-Monitoring-Expert/content/6_operating/modules/energyanalysisrprts_oprtng.htm",
    note: "kWh-per-unit KPIs, energy models, expected vs actual, savings validation in a large-site product.",
  },
  {
    id: "scheduling-review",
    title: "Energy Efficient Manufacturing Scheduling: A Systematic Literature Review (arXiv:2308.13585)",
    url: "https://arxiv.org/pdf/2308.13585",
    note: "Energy-cost-aware scheduling under time-of-use tariffs is well established in research.",
  },
];
