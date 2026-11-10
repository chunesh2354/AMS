import { ACCOUNTING, DRAFTS, FEE_COMPONENTS, IMPORT_PREVIEW, INTEGRATIONS, INVOICES, NTE, OPPORTUNITIES, PROPOSALS, READY_ITEMS, REPORTS, SETTINGS_LISTS, WIP } from '../mock/commercial';
import { hasFinanceAccess, reply, sample, sampleSync, sampleView, type ViewerRef } from './access';
import type { Fenced, Invoice, NteException, Opportunity, Proposal, ReadyItem, BillingDraft, ReportView } from './types';

export const getOpportunities = (): Promise<Opportunity[]> => sample(() => OPPORTUNITIES, []);
export const getOpportunity = (id: string): Opportunity | null => sampleSync(() => OPPORTUNITIES.find((o) => o.id === id || o.proposalId === id) ?? null, null);
export const getProposal = (id: string): Promise<Proposal | null> => sample(() => PROPOSALS.find((p) => p.id === id) ?? null, null);

export const getReadyToBill = (project?: string): Promise<ReadyItem[]> => sample(() => READY_ITEMS.filter((r) => !project || r.project === project), []);
export const getDrafts = (project?: string): Promise<BillingDraft[]> => sample(() => DRAFTS.filter((d) => !project || d.project === project), []);
export const getNteExceptions = (project?: string): Promise<NteException[]> => sample(() => NTE.filter((n) => !project || n.project === project), []);
export const getWip = () => sample(() => WIP, []);
export const getAccounting = () => sampleView(() => ACCOUNTING);

export const outstanding = (i: Invoice) => i.gross - i.cash - i.withholding - i.credits;
export const getInvoices = (): Promise<Invoice[]> => sample(() => INVOICES, []);

export const REPORT_LIST = REPORTS.map((r) => ({ key: r.key, label: r.label }));
export function getReport(key: string, viewer: ViewerRef): Promise<ReportView | null> {
  const r = sampleSync(() => REPORTS.find((x) => x.key === key), undefined);
  if (!r) return reply(null);
  const finance = hasFinanceAccess(viewer);
  const wrap = (allowed: boolean, value: string): Fenced<string> => (allowed ? { restricted: false, value } : { restricted: true });
  const hideValue = !!r.fenceValue && !finance;
  const hideExtra = !!r.fenceExtra && !finance;
  return reply({
    ...r,
    fenced: hideValue || hideExtra,
    rows: r.rows.map((x) => ({ key: x.key, label: x.label, chart: hideValue ? null : x.chart, missing: x.missing, value: wrap(!hideValue, x.value), extra: wrap(!hideExtra, x.extra) })),
  });
}

export const getSettingsLists = () => sampleView(() => SETTINGS_LISTS);
export const getIntegrations = () => sample(() => INTEGRATIONS, []);
export const getImportPreview = () => sample(() => IMPORT_PREVIEW, []);

export const getFeeComponents = (project: string) => sample(() => FEE_COMPONENTS[project] ?? [], []);
