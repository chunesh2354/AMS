import { ACCOUNTING, DRAFTS, FEE_COMPONENTS, IMPORT_PREVIEW, INTEGRATIONS, INVOICES, NTE, OPPORTUNITIES, PROPOSALS, READY_ITEMS, REPORTS, SETTINGS_LISTS, WIP } from '../mock/commercial';
import { hasFinanceAccess, reply, type ViewerRef } from './access';
import type { Fenced, Invoice, NteException, Opportunity, Proposal, ReadyItem, BillingDraft, ReportView } from './types';

export const getOpportunities = (): Promise<Opportunity[]> => reply(OPPORTUNITIES);
export const getOpportunity = (id: string): Opportunity | null => OPPORTUNITIES.find((o) => o.id === id || o.proposalId === id) ?? null;
export const getProposal = (id: string): Promise<Proposal | null> => reply(PROPOSALS.find((p) => p.id === id) ?? null);

export const getReadyToBill = (project?: string): Promise<ReadyItem[]> => reply(READY_ITEMS.filter((r) => !project || r.project === project));
export const getDrafts = (project?: string): Promise<BillingDraft[]> => reply(DRAFTS.filter((d) => !project || d.project === project));
export const getNteExceptions = (project?: string): Promise<NteException[]> => reply(NTE.filter((n) => !project || n.project === project));
export const getWip = () => reply(WIP);
export const getAccounting = () => reply(ACCOUNTING);

export const outstanding = (i: Invoice) => i.gross - i.cash - i.withholding - i.credits;
export const getInvoices = (): Promise<Invoice[]> => reply(INVOICES);

export const REPORT_LIST = REPORTS.map((r) => ({ key: r.key, label: r.label }));
export function getReport(key: string, viewer: ViewerRef): Promise<ReportView | null> {
  const r = REPORTS.find((x) => x.key === key);
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

export const getSettingsLists = () => reply(SETTINGS_LISTS);
export const getIntegrations = () => reply(INTEGRATIONS);
export const getImportPreview = () => reply(IMPORT_PREVIEW);

export const getFeeComponents = (project: string) => reply(FEE_COMPONENTS[project] ?? []);
