// Mirrors KNOWN_POOLS in src/miner/pools.ts: the pools the miner knows by name.
export interface KnownPool { address: string; dex: "Orca" | "Raydium" | "Meteora"; pair: string; fee: string; kind?: string }
export const KNOWN_POOLS: KnownPool[] = [
  { address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", dex: "Orca", pair: "SOL/USDC", fee: "0.04%" },
  { address: "Hp53XEtt4S8SvPCXarsLSdGfZBuUr5mMmZmX2DRNXQKp", dex: "Orca", pair: "SOL/JITOSOL", fee: "0.01%" },
  { address: "CeaZcxBNLpJWtxzt58qQmfMBtJY8pQLvursXTJYGQpbN", dex: "Orca", pair: "SOL/CBBTC", fee: "0.16%" },
  { address: "HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM", dex: "Orca", pair: "CBBTC/USDC", fee: "0.04%" },
  { address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", dex: "Raydium", pair: "SOL/USDC", fee: "0.25%", kind: "AMM" },
  { address: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", dex: "Raydium", pair: "SOL/USDC", fee: "0.04%", kind: "CLMM" },
  { address: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6", dex: "Meteora", pair: "SOL/USDC", fee: "0.04%" },
  { address: "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y", dex: "Meteora", pair: "SOL/USDC", fee: "0.1%" },
  { address: "BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh", dex: "Meteora", pair: "SOL/USDC", fee: "0.2%" },
];
