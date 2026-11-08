/** F17. Every integration is labelled: the UI shows MOCK whenever MockAccountingAdapter is active. */
export type AdapterResult = { external_id: string; invoice_no: string; issue_date: string; due_date: string; gross?: string; tax?: string; net?: string };
export class AdapterTimeout extends Error {}

export type AccountingAdapter = {
  key: 'mock' | 'csv';
  label: string;
  /** Returns the finalized invoice, or null when finalization happens later through import-final. */
  submitDraft(draft: { draftNo: string; net: string }, key: string, opts: { simulate?: string }): Promise<AdapterResult | null>;
  lookupByKey(key: string): Promise<AdapterResult | null>;
};

const mockLedger = new Map<string, AdapterResult>();
// Seeded from the clock so numbers do not restart at the same value after an API restart (external_invoice_no is unique).
let mockSeq = Math.floor(Date.now() / 1000) % 1_000_000_000;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/**
 * Deterministic and in-memory; nothing leaves this process. `simulate: 'timeout'` records the invoice and then
 * fails to answer, which is the dangerous real-world case: the other side has it and we do not know.
 */
export const MockAccountingAdapter: AccountingAdapter = {
  key: 'mock',
  label: 'Mock accounting adapter',
  async submitDraft(draft, key, opts) {
    const existing = mockLedger.get(key);
    if (existing) return existing;
    if (opts.simulate === 'failure') throw new Error('Mock adapter: the accounting system refused this draft.');
    mockSeq += 1;
    const issue = today();
    const result: AdapterResult = { external_id: `MOCK-${key.slice(0, 8)}`, invoice_no: `INV-MOCK-${String(mockSeq).padStart(4, '0')}`, issue_date: issue, due_date: plusDays(issue, 30), net: draft.net, gross: draft.net, tax: '0' };
    if (opts.simulate !== 'timeout_lost') mockLedger.set(key, result);
    if (opts.simulate === 'timeout' || opts.simulate === 'timeout_lost') throw new AdapterTimeout('Mock adapter: simulated timeout.');
    return result;
  },
  async lookupByKey(key) {
    return mockLedger.get(key) ?? null;
  },
};

/** Reviewed export and import (D4): submitting only hands over a file; the final invoice is imported afterwards. */
export const CsvExportImportAdapter: AccountingAdapter = {
  key: 'csv',
  label: 'CSV export and import',
  async submitDraft() { return null; },
  async lookupByKey() { return null; },
};

export const adapterFor = (key: string): AccountingAdapter => (key === 'csv' ? CsvExportImportAdapter : MockAccountingAdapter);
