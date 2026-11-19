export const CARGO_TYPES = [
  'Usage',
  'SavingsPlanCoveredUsage',
  'SavingsPlanRecurringFee',
  'Tax',
  'Credit',
  'DiscountedUsage',
  'RIFee',
  'Fee',
  'EdpDiscount',
  'BundledDiscount',
  'SavingsPlanNegation',
  'AWS Marketplace'
] as const;

export type CargoType = typeof CARGO_TYPES[number];

export interface RowData {
  id: number;
  cargoType: CargoType;
  rawLineType: string;
  unblendedCost: number;
  discount: number;
  taxOrCredit: number;
  total: number;
  lineItemDescription: string;
  productCode: string;
  usageType: string;
}

export interface DynamicMetrics {
  totalCost: number;
  totalDiscount: number;
  totalTaxOrCredit: number;
  netTotal: number;
  count: number;
}