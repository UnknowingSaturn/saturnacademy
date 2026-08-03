// Canonical engine lives in shared/quant so the Deno edge runtime can vendor it
// (see scripts/sync-quant.mjs). This shim keeps existing client imports stable.
export * from "../../shared/quant/propFirmMonteCarlo";
