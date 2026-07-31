import { Hono } from "hono";
import type { Env } from "../../../types";
import { requirePermission } from "../../../middleware/rbac";

import dashboardRoutes from "./dashboard";
import stock from "./stock";
import vendors from "./vendors";
import stores from "./stores";
import items from "./items";
import settings from "./settings";
import po from "./po";
import gr from "./gr";
import req from "./req";
import dispatch from "./dispatch";
import writeoff from "./writeoff";
import ret from "./return";
import rfq from "./rfq";
import assetsRoutes from "./assets";
import qrRoutes from "./qr";
import locationRoutes from "./locations";
import purchaseRequestRoutes from "./purchaseRequests";
import issueRoutes from "./issues";
import issueOperationRoutes from "./issueOperations";
import reportsRoutes from "./reports";
import transferRoutes from "./transfers";
import operationalReturnRoutes from "./returns";
import adjustmentRequestRoutes from "./adjustmentRequests";
import countSessionRoutes from "./countSessions";
import workflowAdapterRoutes from "./workflowAdapters";
import importExportRoutes from "./importExport";
import reservationRoutes from "./reservations";
import donations from "./donations";
import pharmacyBridgeRoutes from "./pharmacyBridge";
import reorderRoutes from "./reorder";
import consumptionRuleRoutes from "./consumptionRules";
import consumptionEventRoutes from "./consumptionEvents";
import consumptionExceptionRoutes from "./consumptionExceptions";
import consumptionReportRoutes from "./consumptionReports";
import quickStartRoutes from "./quickStart";
import intelligenceRoutes from "./intelligence";

const inventory = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// Auth is already applied by parent chain in src/index.ts

function isInventoryDecisionPath(path: string): boolean {
  return path.includes("/approve") || path.includes("/reject");
}

function writePermissionForPath(path: string): string {
  if (path.includes("/adjustment-requests")) {
    return isInventoryDecisionPath(path) ? "inventory:approve" : "inventory:write";
  }
  if (path.includes("/count-sessions")) {
    return isInventoryDecisionPath(path) ? "inventory:approve" : "inventory:write";
  }
  if (path.includes("/writeoff")) {
    return isInventoryDecisionPath(path) ? "inventory:approve" : "inventory:write";
  }
  if (path.includes("/consumption-exceptions") && path.includes("/review")) return "inventory:approve";
  if (path.includes("/consumption-rules")) return "inventory:write";
  if (path.includes("/consumption-events") || path.includes("/consumption-exceptions")) return "inventory:consume";
  if (path.includes("/issues") || path.includes("/consumptions") || path.includes("/lab/") || path.includes("/ot/")) return "inventory:consume";
  if (path.includes("/returns")) return "inventory:consume";
  if (path.includes("/transfers")) return "inventory:transfer";
  if (path.includes("/stock/adjustment") || path.includes("/stock/adjustments") || path.includes("/adjustment")) return "inventory:adjust";
  if (path.includes("/reports")) return "inventory:reports";
  if (path.includes("/assets")) return "inventory:assets";
  return "inventory:write";
}

inventory.use('*', async (c, next) => {
  const method = c.req.method;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const middleware = requirePermission(writePermissionForPath(new URL(c.req.url).pathname));
    return middleware(c, next);
  }
  const middleware = requirePermission('inventory:read');
  return middleware(c, next);
});

inventory.route("/dashboard", dashboardRoutes);
inventory.route("/stock", stock);
inventory.route("/vendors", vendors);
inventory.route("/stores", stores);
inventory.route("/items", items);
inventory.route("/po", po);
inventory.route("/purchase-orders", po);
inventory.route("/gr", gr);
inventory.route("/goods-receipts", gr);
inventory.route("/req", req);
inventory.route("/requisitions", req);
inventory.route("/dispatch", dispatch);
inventory.route("/dispatches", dispatch);
inventory.route("/writeoff", writeoff);
inventory.route("/return", ret);
inventory.route("/rfq", rfq);
inventory.route("/assets", assetsRoutes);
inventory.route("/qr", qrRoutes);
inventory.route("/locations", locationRoutes);
inventory.route("/purchase-requests", purchaseRequestRoutes);
inventory.route("/issues", issueRoutes);
inventory.route("/issue-operations", issueOperationRoutes);
inventory.route("/consumptions", issueRoutes);
inventory.route("/reports", reportsRoutes);
inventory.route("/transfers", transferRoutes);
inventory.route("/returns", operationalReturnRoutes);
inventory.route("/adjustment-requests", adjustmentRequestRoutes);
inventory.route("/count-sessions", countSessionRoutes);
inventory.route("/reservations", reservationRoutes);
inventory.route("/import-export", importExportRoutes);
inventory.route("/donations", donations);
inventory.route("/pharmacy-bridge", pharmacyBridgeRoutes);
inventory.route("/reorder", reorderRoutes);
inventory.route("/consumption-rules", consumptionRuleRoutes);
inventory.route("/consumption-events", consumptionEventRoutes);
inventory.route("/consumption-exceptions", consumptionExceptionRoutes);
inventory.route("/consumption-reports", consumptionReportRoutes);
inventory.route("/quick-start", quickStartRoutes);
inventory.route("/intelligence", intelligenceRoutes);
inventory.route("/", workflowAdapterRoutes);

// Mapped to root of /inventory (e.g. /inventory/categories)
inventory.route("/", settings);

export default inventory;
