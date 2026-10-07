import type { CustomerFilterAssignment } from '@workspace/api-client-react/companion/models/customerFilterAssignment';
import type { GetUcActivationPurchases200PurchasesItem as OnlinePurchase } from '@workspace/api-client-react/companion/models/getUcActivationPurchases200PurchasesItem';
import type { FilterActivation } from '@/hooks/useNotifications';
import type { OfflinePurchase, OfflinePurchaseItem, RegisteredImpactFilter } from '@/hooks/useApi';

export type OnlineSelection = {
  source: 'app' | 'store'; orderId: number; phone: string; unitId: string;
  productId: number; name: string; lifespanDays: number;
};
export type OfflineSelection = {
  saleId: number; saleDate: string; item: OfflinePurchaseItem; unitId: string;
  registeredInstallationDate?: string;
};
export type ReadyFilterUnit = {
  key: string; name: string; label: string; sourceBadge: string;
  purchaseSelection?: OnlineSelection; offlineSelection?: OfflineSelection;
};
export type FilterDetail = {
  key: string; name: string; sourceBadge: string; description: string;
  registeredFilterId?: number;
  offlineSelection?: OfflineSelection;
};

/** Presentation only: eligibility and ownership always come from server reads. */
export function myFiltersPresentation(
  primary: FilterActivation | null,
  online: OnlinePurchase[] = [],
  offline: OfflinePurchase[] = [],
  assignments: CustomerFilterAssignment[] = [],
  registered: RegisteredImpactFilter[] = [],
) {
  const ready: ReadyFilterUnit[] = [];
  const history: FilterDetail[] = [];
  const other: FilterDetail[] = [];
  const seenUnits = new Set<string>();
  for (const purchase of online) for (const item of purchase.items) {
    const sourceBadge = purchase.source === 'app' ? 'App purchase' : 'Store purchase';
    const key = `${purchase.source}:${purchase.orderId}:${item.lineId}`;
    history.push({ key, name: item.name, sourceBadge,
      description: `Order #${purchase.orderId} · ${purchase.dateCreated.slice(0, 10)} · ${purchase.status} · Quantity ${item.quantity}. ${item.unavailableReason ?? (item.availableUnitIds.length ? `${item.availableUnitIds.length} ready to activate.` : 'All units activated. Filter history is preserved.')}` });
    if (item.unavailableReason) continue;
    for (const unitId of item.availableUnitIds) {
      const unitKey = `${purchase.source}:${unitId}`;
      if (seenUnits.has(unitKey)) continue;
      seenUnits.add(unitKey);
      ready.push({ key: unitKey, name: item.name, sourceBadge,
        label: `Order #${purchase.orderId} · Item ${item.lineId} · Unit ${unitId.split(':').at(-1)} of ${item.quantity}`,
        purchaseSelection: { source: purchase.source, orderId: purchase.orderId, phone: purchase.phone,
          unitId, productId: item.productId, name: item.name, lifespanDays: item.lifespanDays } });
    }
  }
  const registeredIds = new Set<number>();
  if (primary?.registeredFilterId != null) registeredIds.add(primary.registeredFilterId);
  // An older device activation can have its exact offline unit ID but no
  // registration ID. The owned read supplies that missing display identity.
  if (primary?.offlineUnitId) {
    for (const sale of offline) for (const item of sale.items) for (const unit of item.registeredUnits ?? []) {
      if (unit.unitId === primary.offlineUnitId && unit.registeredFilterId != null) registeredIds.add(unit.registeredFilterId);
    }
  }
  for (const assignment of assignments) {
    if (assignment.filterId != null && registeredIds.has(assignment.filterId)) continue;
    if (assignment.filterId != null) registeredIds.add(assignment.filterId);
    other.push({ key: `assignment:${assignment.id}`, registeredFilterId: assignment.filterId ?? undefined, name: assignment.productName, sourceBadge: 'Staff linked',
      description: `${assignment.filterId != null ? 'Registered filter' : 'Staff assignment · exact registration identity unavailable'} · Installed ${String(assignment.activatedAt ?? assignment.installationDate).slice(0, 10)} · Order #${assignment.orderReference} · ${assignment.maintenanceCount ?? 0} cleanings · ${assignment.active === false ? 'Inactive' : assignment.status}. Cash: ${assignment.cashCollectionState === 'collected' ? 'collected' : assignment.cashCollectionState === 'awaiting_collection' ? 'awaiting collection' : 'collection not recorded'}.` });
  }
  for (const sale of offline) for (const item of sale.items) {
    const sourceBadge = 'Offline sale';
    history.push({ key: `offline:${sale.saleId}:${item.lineId}`, name: item.name, sourceBadge,
      description: `${sale.label} · Sale #${sale.saleId} · ${sale.saleDate} · Quantity ${item.quantity}. ${item.unavailableReason ?? (item.availableUnitIds.length ? `${item.availableUnitIds.length} ready to activate.` : 'All units registered. Filter history is preserved.')}` });
    if (!item.unavailableReason) for (const unitId of item.availableUnitIds) {
      const key = `offline:${sale.saleId}:${unitId}`;
      if (seenUnits.has(key)) continue;
      seenUnits.add(key);
      ready.push({ key, name: item.name, sourceBadge,
        label: `Sale #${sale.saleId} · Item ${sale.items.indexOf(item) + 1} · Available unit ${item.availableUnitIds.indexOf(unitId) + 1} of ${item.availableUnitIds.length}`,
        offlineSelection: { saleId: sale.saleId, saleDate: sale.saleDate, item, unitId } });
    }
    for (const unit of item.registeredUnits) {
      if (primary?.offlineUnitId === unit.unitId) continue;
      if (unit.registeredFilterId != null && registeredIds.has(unit.registeredFilterId)) {
        const same = other.find(d => d.registeredFilterId === unit.registeredFilterId);
        if (same) {
          same.sourceBadge = 'Staff linked · Offline sale';
          if (unit.active) same.offlineSelection = { saleId: sale.saleId, saleDate: sale.saleDate, item,
            unitId: unit.unitId, registeredInstallationDate: unit.installationDate };
        }
        continue;
      }
      if (unit.registeredFilterId != null) registeredIds.add(unit.registeredFilterId);
      const key = `offline-registered:${sale.saleId}:${unit.unitId}`;
      if (seenUnits.has(key)) continue;
      seenUnits.add(key);
      other.push({ key, registeredFilterId: unit.registeredFilterId, name: item.name, sourceBadge,
        description: `Registered filter · Sale #${sale.saleId} · Installed ${unit.installationDate} · ${unit.active ? 'Active' : 'Inactive'}`,
        offlineSelection: unit.active ? { saleId: sale.saleId, saleDate: sale.saleDate, item,
          unitId: unit.unitId, registeredInstallationDate: unit.installationDate } : undefined });
    }
  }
  for (const filter of registered) {
    if (registeredIds.has(filter.id)) continue;
    registeredIds.add(filter.id);
    other.push({ key: `registered:${filter.id}`, registeredFilterId: filter.id, name: filter.productName, sourceBadge: 'Registered',
      description: `Installed ${filter.activatedAt.slice(0, 10)} · Registration #${filter.id}${filter.sourceOrderId != null ? ` · Purchase reference #${filter.sourceOrderId}` : ''}` });
  }
  return { ready, other, history };
}
