# Developer Notes

Date: February 4, 2026

Assumptions implemented (to unblock TODOs):
- Payments apply to invoices (not directly to purchase orders).
- Partial payments are allowed as long as the payment amount does not exceed the invoice balance.
- Payments are immutable in the UI (no edit/delete; reversals should be new adjustment records).
- Purchase order search matches order number, supplier name, reason, and item description.
- Purchase order date filter uses the order date field.
- Payment search is case-insensitive and matches invoice number (primary), plus payment number, reference, and supplier name.
- PO status color mapping follows the `statusConfig` in `app/(dashboard)/purchase-orders/page.tsx` and `app/(dashboard)/monitoring/page.tsx`.
- IVA (16%) applies only to items flagged as services; legacy orders with existing tax are normalized with service items.
- Legacy PO `notes` are migrated to the new `reason` field at load time.
