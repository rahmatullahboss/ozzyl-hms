# Module 46 — Verification (Multi-Step Approval Workflow)

> Reference documentation for the DanpheEMR Verification module. Covers the multi-level approval workflow for inventory and pharmacy transactions (requisitions, purchase requests, purchase orders, goods receipts), the `VerificationController` + `VerificationBL` + `VerificationService` business surface, the `TXN_Verification` / `PHRM_TXN_Verification` / `MST_MAP_StoreVerification` database tables, the `IVerificationService` core service, the pharmacy-side `PharmacyVerificationModel` + `VerificationModels` DbSet, and the Angular `verification` module with its four inventory sub-modules (Requisition / PurchaseRequest / PurchaseOrder / GoodsReceipt) and two pharmacy sub-modules (PurchaseOrder / Requisition).

---

## 1. Module Overview

The Verification module is the **multi-step approval engine** for transactions that move money, inventory, or purchasing authority. It is a *cross-cutting* module: it does not own the underlying transactions (those live in the Inventory, Pharmacy, Ward Supply, and Accounting modules), but it adds a uniform, configurable approval gate in front of the most sensitive of them.

A transaction is brought into the verification workflow when the originating screen is submitted with `IsVerificationEnabled = true` and a list of `VerifierIds` (a JSON-serialized array of `{ Id, Type }` objects, where `Type` is `"role"` or `"user"`). Each entry in `VerifierIds` represents a *level* — the verifiers at `VerifierIds[0]` are level 1, those at `VerifierIds[1]` are level 2, and so on. `MaxVerificationLevel` is `VerifierIds.length`. A verifier can act on a transaction only if they are at the *current* verification level **and** the level has not already been acted upon.

When every level has approved, the verification record's `VerificationId` is stamped onto the originating transaction and the transaction's status advances to its final post-verification state (`RequisitionStatus = "active"`, `POStatus = "active"`, `RequestStatus = "pending"`, `GRStatus = "verified"`). At this point the goods-receipt workflow also writes the **IMIR number** (Inter-Medical Inventory Receipt) and triggers stock posting for inventory items. A single rejection at any level terminates the chain — the transaction is cancelled and `CancelRemarks = "Rejected by <userName>"` is set.

### Key design characteristics

- **One transaction table, one workflow table.** Every verifi able transaction carries a `VerificationId` foreign key into the shared `TXN_Verification` (Inventory) or `PHRM_TXN_Verification` (Pharmacy) ledger. Each approval or rejection appends a new row to that ledger with `ParentVerificationId` pointing at the previous level's row. This produces a self-referential chain of approvals per transaction.
- **Two ledger tables, not one.** DanpheEMR segregates the Pharmacy verification ledger into its own physical table because Pharmacy uses its own `PharmacyDbContext` whose connection is often to a separate database. The Inventory/Ward-Supply side uses `WardSupplyDbContext` / `InventoryDbContext`, which both map to the *same* `TXN_Verification` table (verified by `WardSupplyDbContext.cs:47` and `InventoryDbContext.cs:70`).
- **Role-level and user-level verifiers.** `VerifierIds` is a JSON array of `{ Id, Type }` where `Type` is `"role"` or `"user"`. A role-level entry (e.g. `Id=5, Type="role"`) means *any* user holding that role can verify at that level. A user-level entry (e.g. `Id=42, Type="user"`) means *only* that specific user. The `IsUserAllowedToSee*` algorithms iterate the list and check `RBAC.UserHasRoleId(userId, id)` or `user.UserId == id`.
- **Recursive duplicate-detection.** `CheckForVerificationExistAtThisLevel` (line 123 of `VerificationBL.cs`) is recursive: when looking up whether level N has been verified, it walks up the `ParentVerificationId` chain until it finds a record at level N, or hits the root, or finds a `rejected` record. The rejection short-circuits the recursion and disables further verification at the *current* level.
- **Super-admin bypass.** `RBAC.UserIsSuperAdmin(userId)` short-circuits the verifier matching in every list endpoint — a sysadmin sees every pending transaction across every level, even if they are not on the verifier list.
- **Settings-driven configuration for purchase requests.** Unlike requisitions, POs, and GRs (whose verifier list is set *per transaction* in the originating screen), purchase-request verification is enabled *globally* via a `CfgParameters` row named `"Inventory.PurchaseRequestVerificationSettings"`. The settings JSON has `EnableVerification`, `VerificationLevel`, and `PermissionIds` (a permission-id array used as the verifier list). If `EnableVerification` is `false`, the entire workflow is short-circuited and no PRs appear in the verification queue.
- **Final-level side effects.** Reaching the final level triggers a *status transition* on the underlying transaction (e.g. `PurchaseOrder.POStatus = "active"`, `GoodsReceipt.GRStatus = "verified"`, `Requisition.RequisitionStatus = "active"`) and, for GRs, **stock posting** (`grItem.DonationId` is set) and **IMIR number generation** (`VerificationBL.GetIMIRNo` at `VerificationBL.cs:464`).
- **Rejection is terminal.** The reject path writes a row with `VerificationStatus = "rejected"` and then immediately cancels the underlying transaction in a separate `Cancel*` business-layer method. Because the rejection record is written first, any subsequent approval attempt against the same transaction will see the rejection at level 0 and disable the action button.
- **Auditability.** Every verification row carries `VerifiedBy` (EmployeeId), `VerifiedOn` (DateTime), `VerificationRemarks`, `VerificationStatus`, and the link back to the transaction via the transaction's own `VerificationId` FK. Because each level adds a new row with a `ParentVerificationId`, the full approval history is recoverable by recursive traversal — see `GetVerifiersList` at `VerificationBL.cs:492`.

### Cross-cutting hooks

The Verification module touches (or is touched by) every procurement-side module:

- **Inventory requisitions** — `RequisitionModel.IsVerificationEnabled` / `RequisitionModel.VerifierIds` / `RequisitionModel.VerificationId` (`Code/Components/DanpheEMR.ServerModel/InventoryModels/RequisitionModel.cs:32, 59, 60`).
- **Inventory purchase requests** — `PurchaseRequestModel.VerificationId` (`InventoryModels/PurchaseRequestModel.cs:19`). Verifier list comes from a global CfgParameter, not from the model.
- **Inventory purchase orders** — `PurchaseOrderModel.IsVerificationEnabled` / `PurchaseOrderModel.VerifierIds` / `PurchaseOrderModel.VerificationId` (`InventoryModels/PurchaseOrderModel.cs:45, 46`).
- **Inventory goods receipts** — `GoodsReceiptModel.IsVerificationEnabled` / `GoodsReceiptModel.VerifierIds` / `GoodsReceiptModel.VerificationId` (`InventoryModels/GoodsReceiptModel.cs:90, 91, 104`).
- **Pharmacy sub-store requisitions** — `PHRMStoreRequisitionModel.IsVerificationEnabled` / `VerifierIds` (`PharmacyModels/PHRMStoreRequisitionModel.cs:24, 25`).
- **Pharmacy purchase orders** — `PHRMPurchaseOrderModel.IsVerificationEnabled` / `VerifierIds` (`PharmacyModels/PHRMPurchaseOrderModel.cs:41, 42`).
- **RBAC** — Every list endpoint calls `RBAC.UserIsSuperAdmin` / `RBAC.UserHasRoleId` to filter what the calling user can see. The Ward Supply module's `SubstoreBL.CreateStoreVerificationMap` is what creates the verifier-permission map rows for a substore.
- **Settings** — `SettingsController.GetStoreVerificationMapDetails` (around line 456) returns the per-store verification map. Purchase-request verification uses `Settings` CfgParameters (`Inventory.PurchaseRequestVerificationSettings`).
- **Inventory receipt numbering** — `IInventoryReceiptNumberService.GenerateGRN` is referenced (commented in the controller) but not currently invoked in the verification approve path; the IMIR number is generated separately by `VerificationBL.GetIMIRNo`.

---

## 2. Backend File Layout

### 2.1 Controllers — `DanpheEMR.Controllers/Verification/`

| File | Lines | Purpose |
|---|---|---|
| `VerificationController.cs` | 625 | The single HTTP surface for the entire module. Declares `IVerificationService` + `IInventoryGoodReceiptService` + `IInventoryReceiptNumberService` via constructor DI, plus `PharmacyDbContext` and `InventoryDbContext` initialized with the request's `connString`. Routes are split into five regions: `Inventory Requisition`, `Inventory Purchase Request`, `Inventory Purchase Order`, `Inventory Goods Receipt`, `Pharmacy Verification` (covering both PO and Requisition). Each region has GetList / GetDetails / Approve / Reject quartets. |
| `VerificationBL.cs` | 1408 | The static business-logic layer. Holds the recursive verifier-matching algorithms (`IsUserAllowedToSeeRequisition`, `IsUserAllowedToSeePO`, `IsUserAllowedToSeeGR`, `IsUserAllowedToSeePharmacyPo`, `IsUserAllowedToSeePharmacyRequisition`, `CheckForVerificationExistAtThisLevel`, `CheckForPharmacyVerificationExistAtThisLevel`), the actor-history recursion (`GetVerifiersList`, `GetPharmacyVerifiersList`), the pharmacy purchase-order save/cancel methods, the pharmacy requisition save/cancel methods, the IMIR-number generator, and the purchase-request verification settings loader. The Inventory side cancellation calls delegate to `InventoryBL.CancelSubstoreRequisition` / `CancelPurchaseRequestById` / `CancelPurchaseOrderById` / `CancelGoodsReceipt` (see `Controllers/Inventory/InventoryBL.cs:567, 618, 672, 910`). |

### 2.2 Service layer — `DanpheEMR.Services/Verification/`

| File | Lines | Purpose |
|---|---|---|
| `IVerificationService.cs` | 12 | Three-method contract: `CreateVerification(...)`, `GetVerificationViewModel(int)`, `UpdateVerifcation(int, int, string)`. The `CreateVerification` overload is the one used by the controller; the others are legacy / used by Ward Supply directly. |
| `VerificationService.cs` | 98 | EF implementation backed by `WardSupplyDbContext` (note: the controller *also* uses `InventoryDbContext` for inventory reads/writes; the verification ledger is shared, but the *write* path goes through this service to keep `VerificationModel` writes co-located with its DbSet registration). `CreateVerification` populates a `VerificationModel` row with `VerifiedBy = EmployeeId`, `VerifiedOn = DateTime.Now`, `CurrentVerificationLevel`, `CurrentVerificationLevelCount`, `MaxVerificationLevel`, `VerificationStatus`, `VerificationRemarks`, and `ParentVerificationId` (nullable — null for the first level). Returns the new `VerificationId`. |
| `Verifier_DTO.cs` | 9 | Lightweight DTO `{ Id, Name, Type }` used in `InventoryController.GetRequisitionItemListById` and the `InventoryController.cs:2482` line where the verifier-list JSON is deserialized back to typed objects for client display. |
| `DTOs/PharmacyPurchaseOrder_DTO.cs` | 39 | The body DTO for the `ApprovePharmacyPurchaseOrder` endpoint. Carries the full PO economic breakdown (SubTotal, DiscountAmount/Percentage, VATAmount/Percentage, CCChargeAmount/Percentage, TaxableAmount, NonTaxableAmount, TotalAmount, Adjustment) plus the items list and verification tracking fields (`CurrentVerificationLevel`, `MaxVerificationLevel`, `CurrentVerificationLevelCount`, `VerificationStatus`, `IsVerificationAllowed`, `IsModificationAllowed`, `VerificationRemarks`, `VerificationId`, `TransactionType`). |
| `DTOs/PharmacyPurchaseOrderItem_DTO.cs` | 29 | Per-line DTO for the PO body: `PurchaseOrderItemId`, `Quantity`, `StandardRate`, `SubTotal`, `DiscountPercentage` / `Amount`, `VATPercentage` / `Amount`, `CCChargePercentage` / `Amount`, `TotalAmount`, `POItemStatus`, `FreeQuantity`, `IsActive`, `IsCancel`, plus cancellation fields. |
| `DTOs/PharmacyPurchaseOrderVerification_DTO.cs` | 36 | List-row DTO returned by `GetPharmacyPurchaseOrdersBasedOnUser` — same shape as `PHRMPurchaseOrderModel` plus verifier-list tracking. |
| `DTOs/PharmacyPurchaseOrderVerifierSignatory_DTO.cs` | 15 | Signatory DTO (`FullName`, `EmployeeRoleName`, `VerifiedOn`, `VerificationStatus`, `VerificationRemarks`, `CurrentVerificationLevel`). Used for PO print/audit reports. |
| `DTOs/Pharmacy/PharmacySubStoreRequisitionVerification_DTO.cs` | 28 | List/approve DTO for pharmacy sub-store requisitions. Mirrors the inventory `RequisitionModel` with `IsVerificationAllowed`, `CurrentVerificationLevel`, `MaxVerificationLevel`, `CurrentVerificationLevelCount`, `VerificationStatus`, `VerificationRemarks`, `VerificationId`, and a `TransactionType` discriminator. |
| `DTOs/Pharmacy/PharmacySubStoreRequisitionItemVerification_DTO.cs` | 20 | Per-line DTO for the requisition body. `RequisitionItemId`, `ItemId`, `Quantity`, `PendingQuantity`, `RequisitionItemStatus`, `Remark`, `CancelQuantity`, plus cancel audit fields. |

### 2.3 Server models — `DanpheEMR.ServerModel/VerificationModels/`

| File | Lines | Purpose |
|---|---|---|
| `VerificationModel.cs` | 19 | The Inventory / Ward-Supply ledger row. `VerificationId` (PK), `VerifiedBy` (EmployeeId), `VerifiedOn`, `ParentVerificationId` (nullable FK to self), `CurrentVerificationLevel` (1-based), `CurrentVerificationLevelCount` (1-based, equals the level for the linear case), `MaxVerificationLevel`, `VerificationStatus` (`"approved"` \| `"rejected"`), `VerificationRemarks`. Mapped to `TXN_Verification`. |
| `Pharmacy/PharmacyVerificationModel.cs` | 24 | The Pharmacy ledger row. Same eight columns as `VerificationModel` plus a `TransactionType` discriminator (`"purchase-order"` or `"requisition"`) used to scope queries. Mapped to `PHRM_TXN_Verification`. |
| `VerificationViewModel.cs` | 16 | Display DTO with `EmployeeModel VerifiedBy` (EF navigation to the employee row, eagerly-loaded with `EmployeeRole`) instead of just the integer id. Used by the legacy `GetVerificationViewModel(int)` path on `IVerificationService`. |
| `InventoryRequisitionViewModel.cs` | 100 | Composite view models returned by the *details* endpoints: `InventoryRequisitionViewModel` (RequisitionItemList + RequestingUser + Verifiers + Dispatchers + isVerificationAllowed), `InventoryPurchaseRequestViewModel` (RequestedItemList + RequestingUser + Verifiers), `InventoryPurchaseOrderViewModel` (OrderedItemList + OrderingUser + Verifiers + PONumber), `InventoryGoodsReceiptViewModel` (ReceivedItemList + ReceivingUser + Verifiers + OrderDetails + grCharges). Also defines the leaf classes `VerificationActor` (Name/Status/Remarks/Date), `DispatchVerificationActor` (DispatchId/isReceived), `QuotationRatesVm` / `QuotationRatesDto` / `QuotationRatesComparisionDTO` (used by `GetQuotationRatesDetails` for PO verify), `GRChargesViewModel` (Id/ChargeName/TotalAmount), and `VER_PODetailModel` (PurchaseOrderId/PoDate/VendorName/ContactAddress/ContactNo). |
| `VER_INV_PurchaseRequestParameterModel.cs` | 12 | The settings JSON for purchase-request verification: `EnableVerification` (bool), `VerificationLevel` (int), `PermissionIds` (List<int>). Persisted in `Core_CFG_Parameters` as `ParameterGroupName = "Inventory"`, `ParameterName = "PurchaseRequestVerificationSettings"`. |
| `TrackRequisitionViewModel.cs` | 21 | Tracking/audit DTO: `RequisitionId`, `CreatedBy` (employee name), `RequisitionDate`, `MaxVerificationLevel`, `Status`, `Verifiers` (List<VerifiersPermissionViewModel>), `Dispatchers`, `StoreId`, `StoreName`. |
| `VerifiersPermissionViewModel.cs` | 21 | Per-level audit row: `PermissionId`, `CurrentVerificationLevel`, `PermissionName`, `VerificationStatus`, `VerificationRemarks`, `VerificationId`, `VerifiedOn`, `VerifiedBy` (EmployeeModel). |
| `MasterModels/StoreVerificationMapModel.cs` | 25 | The Ward-Supply per-store verification map (the *config* side, not the *transaction* side). `StoreVerificationMapId`, `StoreId`, `MaxVerificationLevel`, `VerificationLevel`, `PermissionId`, `CreatedBy/On`, `ModifiedBy/On`, `IsActive`. Mapped to `MST_MAP_StoreVerification`. Populated by `SubstoreBL.CreateAndMapVerifiersWithStore` (`Controllers/WardSupply/SubstoreBL.cs:223`) and queried by `GetStoreVerifiersPermissionList` (line 39) and `SettingsController.GetStoreVerificationMapDetails` (line 456). |

### 2.4 Database context registrations

- `WardSupplyDbContext.cs:47` — `modelBuilder.Entity<VerificationModel>().ToTable("TXN_Verification")` and line 138 `public DbSet<VerificationModel> VerificationModel { get; set; }`.
- `InventoryDbContext.cs:70` — same `TXN_Verification` mapping, line 161 `public DbSet<VerificationModel> Verifications { get; set; }`. Both contexts hit the *same* table, so reads from `Verifications` and writes via `VerificationService` (`VerificationModel`) work against identical rows.
- `PharmacyDbContext.cs:212` — `modelBuilder.Entity<PharmacyVerificationModel>().ToTable("PHRM_TXN_Verification")` and line 118 `public DbSet<PharmacyVerificationModel> VerificationModels { get; set; }`.
- `MasterDbContext.cs:55, 110` — `StoreVerificationMapModel` → `MST_MAP_StoreVerification`.
- `RbacDbContext.cs:43` — same `MST_MAP_StoreVerification` mapping (the table is read by `RbacDbContext.StoreVerificationMapModel` in the old `CheckForVerificationPermission` algorithm in `VerificationBL.cs:81`).

### 2.5 Frontend — `wwwroot/DanpheApp/src/app/verification/`

| File / Directory | Purpose |
|---|---|
| `verification.module.ts` | NgModule. Declares 11 components, provides 6 services (VerificationService, VerificationBLService, VerificationDLService plus InventoryBLService, InventoryDLService, InventoryService). Imports CommonModule, VerificationRoutingModule, SharedModule, ReactiveFormsModule. |
| `verification-routing.module.ts` | Routes `/Verification` (main shell) → children `Inventory/{Requisition,PurchaseRequest,PurchaseOrder,GoodsReceipt}` and `Pharmacy/{PurchaseOrder,Requisition}`. Each child has list + detail/verify routes. `AuthGuardService` on the main shell. |
| `verification-main/verification-main.component.ts` | 24-line shell. Calls `securityService.GetChildRoutes("Verification")` to discover the primary/secondary nav items based on the user's RBAC route list. |
| `inventory/` | Inventory sub-tree. |
| `inventory/verification-inventory.component.ts` | Sub-shell. Same nav-loading pattern as the main shell. |
| `inventory/requisition-list/inventory-requisition-list.component.ts` | The pending requisitions grid. On date change, calls `VerificationBLService.GetInventoryRequisitionListBasedOnUser(fromDate, toDate)`. Filters the result by `VerificationStatus` (pending/approved/rejected) and `RequisitionStatus` (all/active/partial/complete/cancelled). `pending` is the special case: `s.RequisitionStatus == "active" || s.RequisitionStatus == "pending") && s.CurrentVerificationLevelCount < s.MaxVerificationLevel && s.isVerificationAllowed == true`. |
| `inventory/requisition-list/inventory-requisition-list.html` | Template. Renders `<danphe-grid>` with the column config from `VerificationGridColumns.RequisitionList` (Req.No, StoreName, RequestedOn, Req. Status, Verification Status, Action). |
| `inventory/requisition-details/inventory-requisition-details.component.ts` | The requisition detail / approve / reject page. Loads via `verificationBLService.GetInventoryRequisitionDetails(RequisitionId)`. Calls `ApproveRequisition(Requisition, VerificationRemarks)` (line 166) and `RejectRequisition(RequisitionId, CurrentVerificationLevel, CurrentVerificationLevelCount + 1, MaxVerificationLevel, VerificationRemarks)` (line 195). On success, shows `Requisition <No> is approved successfully.` and routes back. |
| `inventory/purchase-request/purchase-request-list.component.ts` | The pending purchase-request grid. Mirrors the requisition list pattern. |
| `inventory/purchase-request/purchase-request-detail.component.ts` | The PR detail / approve / reject page. Approve calls `verificationBLService.ApprovePurchaseRequest(...)`; on success shows `Requisition <PRNumber> is approved successfully.` (variable name is misleading; this is the PR approve path). |
| `inventory/purchase-order/purchase-order-list.component.ts` | The pending PO grid. Row action is "verify" (not "view") — routes to the dedicated verify page rather than the list re-load. |
| `inventory/purchase-order/purchase-order-verify.component.ts` | The PO verify page. Approve calls `ApprovePurchaseOrder(...)`; success message is `Purchase Order <PurchaseOrderId> is approved successfully.` (line 162). |
| `inventory/goods-receipt/goods-receipt-list.component.ts` | The pending GR grid. `pending` filter is `s.CurrentVerificationLevelCount < s.MaxVerificationLevel && s.IsVerificationAllowed == true`. |
| `inventory/goods-receipt/goods-receipt-verify.component.ts` | The GR verify page. The most complex of the four inventory detail pages: it supports per-item `EditItem(index)` (toggle `IsEdited`, restore original `ReceivedQuantity` from `CopyOfReceivedItemsQuantity`), `CancelItem(index)` (sets `IsActive = false`, prevents the cancel of the last active item via `CheckForCancelItemsCondition`), `Calculations()` (re-computes `SubTotal`, `VATTotal`, `CcCharge`, `Discount`, `DiscountAmount`, `TotalAmount`, `TotalWithTDS` per item using the GRFormCustomization settings), and `Print()`. `CheckForValidItemQuantity()` rejects `ReceivedQuantity < 1` and instructs the user to use the cancel button instead. `CheckForVerificationApplicable()` at line 84 has three branches: `IsVerificationAllowed == true && GRStatus == "pending"` → allow; `IsVerificationAllowed == false && GRStatus == "pending"` → show "You have verified this Order already." notice; anything else → show "Verifying this Order is not allowed." notice. |
| `pharmacy/pharmacy-verification.component.ts` | Pharmacy sub-shell. |
| `pharmacy/purchase-order/pharmacy-verification-purchase-order-list.component.ts` | Pending PO list (Pharmacy). |
| `pharmacy/purchase-order/pharmacy-verification-purchase-order.component.ts` | The PO approve / reject page for pharmacy. Approve calls `ApprovePharmacyPurchaseOrder(purchaseOrderDTO)` (line 164). |
| `pharmacy/requisition/pharmacy-verification-requisition-list.component.ts` | Pending requisition list (Pharmacy). |
| `pharmacy/requisition/pharmacy-verification-requisition.component.ts` | The requisition approve / reject page for pharmacy. Uses `@Input` bindings (`RequisitionId`, `IsVerificationAllowed`, `CurrentVerificationLevel`, `CurrentVerificationLevelCount`, `MaxVerificationLevel`) and `@Output callBackPopupClose` so it can be embedded in a modal popup from another module. Approve calls `ApprovePharmacyRequisition(requisitionDTO)` with `TransactionType = 'requisition'` (line 128). |
| `shared/verification-grid-column.ts` | The column-config classes. Defines `RequisitionList`, `PurchaseRequestList`, `PurchaseOrderList`, `GRList` column sets, and the cell renderers `VerificationStatusRenderer` (renders `"<count> verified out of <max>"`), `RequisitionDateOnlyRenderer`, `PurchaseOrderDateOnlyRenderer`, `GRDateOnlyRenderer`, `YesNoViewerforPurchaseRequest`. |
| `shared/verification.service.ts` | The `VerificationService` class — a pure state-holder that stores the currently-selected `Requisition`, `PurchaseRequest`, `PurchaseOrder`, or `GoodsReceipt` between the list page and the detail/verify page. Used by both the list component (`verificationService.Requisition = selectedRequisition`) and the detail component (`this.Requisition = this.verificationService.Requisition`). |
| `shared/verification.bl.service.ts` | The Angular Business-Layer service. Mirrors the controller endpoints 1:1. Strips cyclic `*Validator` properties via `_.omit` before serialization. |
| `shared/verification.dl.service.ts` | The Angular Data-Layer service. Pure HTTP wrappers; builds the URLs `/api/Verification/*`. |

---

## 3. Data Models

### 3.1 `TXN_Verification` (Inventory / Ward-Supply ledger)

Source: `Code/Components/DanpheEMR.ServerModel/VerificationModels/VerificationModel.cs`.

| Column | Type | Notes |
|---|---|---|
| `VerificationId` | int, PK, identity | New id is generated on every approval/rejection. |
| `VerifiedBy` | int (FK → `EMP_Employee.EmployeeId`) | The acting employee. |
| `VerifiedOn` | DateTime | Server-side `DateTime.Now` at the time of the approval/rejection. |
| `ParentVerificationId` | int, NULL, FK → `TXN_Verification.VerificationId` | The id of the *previous* level's verification row in the same chain. NULL for the first level. Used by the recursive `GetVerifiersList` to walk the chain. |
| `CurrentVerificationLevel` | int, 1-based | The level that *this* row represents. Set to the `CurrentVerificationLevel` of the originating transaction *before* increment. |
| `CurrentVerificationLevelCount` | int, 1-based | The number of verifications completed by the time this row is written. For the first level this is `1`; for the Nth level this is `N`. |
| `MaxVerificationLevel` | int | Snapshot of the transaction's `MaxVerificationLevel` at the time of the verification, so historical rows survive later changes to the transaction's verifier list. |
| `VerificationStatus` | nvarchar | `"approved"` or `"rejected"`. There is no `"pending"` status — rows are only ever *written* once a decision is made. |
| `VerificationRemarks` | nvarchar | Free-text from the verifier. |

The originating transaction's `VerificationId` FK (e.g. `RequisitionModel.VerificationId`, `PurchaseOrderModel.VerificationId`, `GoodsReceiptModel.VerificationId`, `PurchaseRequestModel.VerificationId`) always points at the *latest* row in the chain — i.e. the row written by the most-recent verifier.

### 3.2 `PHRM_TXN_Verification` (Pharmacy ledger)

Source: `Code/Components/DanpheEMR.ServerModel/VerificationModels/Pharmacy/PharmacyVerificationModel.cs`.

Identical to `TXN_Verification` plus one additional column:

| Column | Type | Notes |
|---|---|---|
| `TransactionType` | nvarchar | Discriminator: `"purchase-order"` or `"requisition"`. Used by `VerificationBL.GetNumberOfPharmacyVerificationDone` and the lookup queries in the pharmacy list paths. |

The Pharmacy ledger is a *separate physical table* in its own database context (`PharmacyDbContext`), and the originating transaction's `VerificationId` FK is `PHRMStoreRequisitionModel.VerificationId` and `PHRMPurchaseOrderModel.VerificationId`.

### 3.3 `MST_MAP_StoreVerification` (per-store verification config)

Source: `Code/Components/DanpheEMR.ServerModel/MasterModels/StoreVerificationMapModel.cs`.

| Column | Type | Notes |
|---|---|---|
| `StoreVerificationMapId` | int, PK, identity | |
| `StoreId` | int (FK → store master) | The substore or pharmacy store. |
| `MaxVerificationLevel` | int | The maximum level for this store at the time this map row was created. |
| `VerificationLevel` | int, 1-based | Which level this map row represents. |
| `PermissionId` | int (FK → `RBAC_Permission.PermissionId`) | The RBAC permission that allows a user to act at this level. Any user who *has* this permission can verify. |
| `CreatedBy` / `CreatedOn` | int / DateTime | Audit. |
| `ModifiedBy` / `ModifiedOn` | int? / DateTime? | Audit. |
| `IsActive` | bit | Soft-delete. Inactive rows are ignored by `SubstoreBL.GetStoreVerifiersListt` (line 27). |
| `NewRoleName` | nvarchar | `[NotMapped]` — input-only, used to create a new RBAC role on-the-fly when defining a new verifier. |
| `RoleId` | int | `[NotMapped]` — the role id paired with `NewRoleName`. |

This is the *config* table; the *transaction* side uses the JSON-serialized `VerifierIds` array stored on the originating transaction.

### 3.4 `Core_CFG_Parameters` (purchase-request verification settings)

Not a dedicated table — a single row of the existing `Core_CFG_Parameters` table, with `ParameterGroupName = "Inventory"` and `ParameterName = "PurchaseRequestVerificationSettings"`, and `ParameterValue` holding a JSON-serialized `VER_INV_PurchaseRequestParameterModel` (`EnableVerification`, `VerificationLevel`, `PermissionIds`). Loaded by `VerificationBL.GetPurchaseRequestVerificationSetting` (line 392).

### 3.5 Verification-related fields on the originating transactions

| Transaction model | IsVerificationEnabled | VerifierIds | VerificationId | Status field |
|---|---|---|---|---|
| `RequisitionModel` (Inventory) | `bool` | `string` (JSON) | `int?` | `RequisitionStatus` |
| `PurchaseRequestModel` (Inventory) | (not on the model — global) | (not on the model) | `int?` | `RequestStatus` |
| `PurchaseOrderModel` (Inventory) | `bool?` | `string` (JSON) | `int?` | `POStatus` |
| `GoodsReceiptModel` (Inventory) | `bool` | `string` (JSON) | `int?` | `GRStatus` |
| `PHRMStoreRequisitionModel` (Pharmacy) | `bool` | `string` (JSON) | `int?` | `RequisitionStatus` |
| `PHRMPurchaseOrderModel` (Pharmacy) | `bool` | `string` (JSON) | `int?` | `POStatus` |

`VerifierIds` is always a JSON-serialized array of `[{ Id: <int>, Type: "role" \| "user" }, ...]`. `MaxVerificationLevel` is derived client-side and server-side as `VerifierIds == null ? 0 : VerifierIds.length`.

---

## 4. Database Tables

| Table | Type | Owning context | Purpose | Source |
|---|---|---|---|---|
| `TXN_Verification` | Ledger (self-referential) | `WardSupplyDbContext` (writes via `IVerificationService`), `InventoryDbContext` (reads via `Verifications` DbSet) | The Inventory / Ward-Supply approval ledger. One row per level per transaction. | `DalLayer/WardSupplyDbContext.cs:47`, `DalLayer/InventoryDbContext.cs:70` |
| `PHRM_TXN_Verification` | Ledger (self-referential) | `PharmacyDbContext` | The Pharmacy approval ledger. Adds `TransactionType` discriminator. | `DalLayer/PharmacyDbContext.cs:212` |
| `MST_MAP_StoreVerification` | Configuration (master) | `RbacDbContext` (and `MasterDbContext`) | The per-store verification *config* — which permission allows verification at which level for which store. | `Security/RbacDbContext.cs:43`, `DalLayer/MasterDbContext.cs:55` |
| `Core_CFG_Parameters` | Configuration (parameter store) | `MasterDbContext` | Stores the global `Inventory.PurchaseRequestVerificationSettings` JSON. | (existing table) |
| (transaction tables) | Existing | various | `INV_TXN_Requisition`, `INV_TXN_PurchaseRequest`, `INV_TXN_PurchaseOrder`, `INV_TXN_GoodsReceipt`, `PHRM_StoreRequisition`, `PHRM_PurchaseOrder` each carry `IsVerificationEnabled` / `VerifierIds` / `VerificationId` FK columns. | various |

`TXN_Verification` and `PHRM_TXN_Verification` are *append-only* ledgers — there is no UPDATE or DELETE in any of the controller or business-layer code paths. To "undo" a verification you write a *new* row, not modify the existing one.

---

## 5. Key Workflows

### 5.1 Pending list (e.g. requisitions)

1. Frontend (e.g. `inventory-requisition-list.component.ts:42`) calls `verificationBLService.GetInventoryRequisitionListBasedOnUser(fromDate, toDate)`.
2. `VerificationBL.GetInventoryRequisitionListBasedOnUser` (`VerificationBL.cs:24`):
   - Filters `inventoryDb.Requisitions` by date range, `RequisitionStatus != "withdrawn"`, and `IsVerificationEnabled == true`.
   - For each requisition, computes `CurrentVerificationLevelCount` by calling `GetNumberOfVerificationDone` (line 509) which reads the *current* `VerificationId` and returns its `CurrentVerificationLevelCount` column.
   - Deserializes the JSON `VerifierIds` into a list of `{ Id, Type }` objects.
   - Calls `IsUserAllowedToSeeRequisition` (line 59) to filter: a user sees a requisition if they are a super-admin, OR hold a role in `VerifierIds[i].Id` for some `i`, OR have their user-id match `VerifierIds[i].Id` for some `i`. The matching index `i` becomes the user's `CurrentVerificationLevel`. If the user is a super-admin, the level is set to the level that has not yet been verified (`CheckForVerificationExistAtThisLevel` returns `true` for already-verified levels and disables the action).
   - Sets `StoreName` from the store master.
3. Returns the filtered list. The frontend then filters further by `VerificationStatus` (pending/approved/rejected) and `RequisitionStatus` (all/active/partial/complete/cancelled).

The Purchase Request, Purchase Order, and Goods Receipt list paths follow the same shape, with the per-store and per-PO settings pulled from `GetPurchaseRequestVerificationSetting` (line 392) and the `VerifierIds` JSON on the transaction.

### 5.2 Approve

1. Frontend calls e.g. `verificationBLService.ApproveRequisition(requisition, remarks)`. The BL strips cyclic `*Validator` properties via `_.omit` (`verification.bl.service.ts:39-44`).
2. `VerificationController.ApproveRequisition` (`VerificationController.cs:100`):
   - Deserializes the body to a `RequisitionModel`.
   - Computes `CurrentVerificationLevelCount = CurrentVerificationLevelCount + 1` (the *next* level).
   - Reads `MaxVerificationLevel` and the current `VerificationId` (becomes `ParentVerificationId`).
   - Calls `_verificationService.CreateVerification(currentUser.EmployeeId, CurrentVerificationLevel, CurrentVerificationLevelCount, MaxVerificationLevel, "approved", remarks, ParentVerificationId)` to write the new ledger row. The new `VerificationId` is returned.
   - Calls `VerificationBL.UpdateRequisitionAfterApproved(dbContext, requisition, VerificationId, currentUser, CurrentVerificationLevelCount)` (`VerificationBL.cs:155`):
     - For each item, updates `PendingQuantity`, `CancelQuantity`, `Quantity`, `IsActive`, `RequisitionItemStatus`. If the verifier deactivates a line and the cancel was not already attributed, sets `CancelBy`, `CancelOn`, `CancelQuantity = PendingQuantity`.
     - If `CurrentVerificationLevelCount == MaxVerificationLevel`, sets `RequisitionStatus = "active"`.
     - Stamps the new `VerificationId` onto the requisition.

The Purchase Order, Goods Receipt, and Pharmacy paths follow the same shape. The Goods Receipt path has one extra step (`VerificationController.cs:474-498`):

- On approval, sets `IMIRDate = DateTime.Now`.
- If `IMIRNo` is null, generates the next one via `VerificationBL.GetIMIRNo` (line 464), which queries the GRs in the current fiscal year, takes `MAX(IMIRNo)`, and returns `+1`.
- If the approval is the *final* level, sets `GoodsReceiptStatus = "verified"`, stamps `grItem.DonationId` on each active item. (Stock posting is done elsewhere — note the commented-out `_goodReceiptService.AddtoInventoryStock` call.)

### 5.3 Reject

1. Frontend calls e.g. `verificationBLService.RejectRequisition(RequisitionId, currentLevel, currentLevelCount + 1, maxLevel, remarks)`.
2. `VerificationController.RejectRequisition` (`VerificationController.cs:130`):
   - `CancelRemarks = "Rejected by " + currentUser.UserName`.
   - `VerificationStatus = "rejected"`.
   - If `CurrentVerificationLevel > 0`, looks up the *previous* ledger row via `db.Requisitions.Where(...).Select(VerificationId)` and passes it as `ParentVerificationId`. (This preserves the chain — the rejection row's parent is the row that was current at the time of rejection.)
   - Calls `_verificationService.CreateVerification` with `VerificationStatus = "rejected"`.
   - Calls `InventoryBL.CancelSubstoreRequisition(db, RequisitionId, CancelRemarks, currentUser, VerificationId)` to set `RequisitionStatus = "cancelled"`, stamp `CancelledBy/On`, and stamp the new `VerificationId`.

The Pharmacy reject path (`SaveRejectedPurchaseOrder` / `SaveRejectedRequisition` at `VerificationBL.cs:1135, 1353`) is wrapped in a `Database.BeginTransaction` because the ledger write and the underlying transaction cancel are both writes that need atomicity. The Inventory reject path does *not* use a transaction explicitly — it relies on EF's per-call `SaveChanges`.

### 5.4 Escalate (implicit via final-level approval)

There is no explicit "escalate" verb in the API. Escalation is the natural consequence of multiple verifiers acting in sequence: a level-1 verifier's approval writes a new ledger row, which makes the level-2 verifier's "is verification allowed" check pass, and so on. The chain's `MaxVerificationLevel` is enforced on every level — see `CheckForVerificationExistAtThisLevel` (`VerificationBL.cs:123`).

### 5.5 History (recursive walker)

`VerificationBL.GetVerifiersList` (`VerificationBL.cs:492`) and `GetPharmacyVerifiersList` (line 897) are the recursive history-walkers. They take the *current* `VerificationId` on a transaction and walk up the `ParentVerificationId` chain, building a `List<VerificationActor>` in chronological order (oldest first). The recursion short-circuits at `ParentVerificationId == null`. This is the data source for the "verifier chain" panel on the requisition/PO/GR detail pages.

### 5.6 Verifier eligibility algorithm (the core logic)

Pseudocode for `IsUserAllowedToSeeRequisition` (`VerificationBL.cs:59`):

```
for each (i, entry) in VerifierIdsParsed:
    if user is super-admin
        OR (entry.Type == "role" AND user holds entry.Id)
        OR (entry.Type == "user" AND user.UserId == entry.Id):
        requisition.CurrentVerificationLevel = i + 1
        requisition.isVerificationAllowed = NOT CheckForVerificationExistAtThisLevel(requisition.CurrentVerificationLevel, requisition.VerificationId)
        requisition.MaxVerificationLevel = VerifierIdsParsed.Count
        if isVerificationAllowed == true:
            break
        requisition.VerificationStatus = VerificationStatus
return isAllowToSeeReq
```

`CheckForVerificationExistAtThisLevel` is also recursive — it walks the `ParentVerificationId` chain looking for a record at the requested level with `VerificationStatus != "rejected"`. The rejection case returns `true` to *disable* verification (the chain is over).

---

## 6. API Endpoints

All endpoints sit under `/api/Verification/...`. The base `[Route("api/[controller]")]` is on the `VerificationController` itself; most actions override with an absolute `~/api/Verification/...` route.

### 6.1 Inventory Requisition (4 endpoints)

| Method | Route | Purpose | Source |
|---|---|---|---|
| `GET` | `~/api/Verification/GetInventoryRequisitionListBasedOnUser/{FromDate}/{ToDate}` | List pending requisitions the calling user is allowed to verify, in the date range. | `VerificationController.cs:67` |
| `GET` | `GetInventoryRequisitionDetails?requisitionId={id}` | Full requisition view-model: items, requestor, verifier chain, dispatchers, isVerificationAllowed. | `VerificationController.cs:88` |
| `POST` | `~/api/Verification/ApproveRequisition/{VerificationRemarks?}` (or no remarks) | Approve at the current level. Body: full `RequisitionModel`. | `VerificationController.cs:97` |
| `POST` | `~/api/Verification/RejectRequisition/{RequisitionId}/{CurrentVerificationlevel}/{CurrentVerificationLevelCount}/{MaxVerificationLevel}` | Reject. Body (raw text): `VerificationRemarks`. | `VerificationController.cs:128` |

### 6.2 Inventory Purchase Request (4 endpoints)

| Method | Route | Purpose | Source |
|---|---|---|---|
| `GET` | `~/api/Verification/GetInventoryPurchaseRequestsBasedOnUser/{FromDate}/{ToDate}` | List pending PRs filtered by global settings + user permissions. | `VerificationController.cs:162` |
| `GET` | `~/api/Verification/GetInventoryPurchaseRequestDetails/{PurchaseRequestId}` | Full PR view-model with items, requestor, verifier chain. | `VerificationController.cs:183` |
| `POST` | `~/api/Verification/ApprovePurchaseRequest/{VerificationRemarks?}` | Approve. Body: full `PurchaseRequestModel`. Sets `RequestStatus = "pending"` on final-level approval. | `VerificationController.cs:203` |
| `POST` | `~/api/Verification/RejectPurchaseRequest/{PurchaseRequestId}/{CurrentVerificationlevel}/{CurrentVerificationLevelCount}/{MaxVerificationLevel}` | Reject. | `VerificationController.cs:239` |

### 6.3 Inventory Purchase Order (5 endpoints)

| Method | Route | Purpose | Source |
|---|---|---|---|
| `GET` | `~/api/Verification/GetInventoryPurchaseOrdersBasedOnUser/{FromDate}/{ToDate}` | List pending POs the calling user is allowed to verify. | `VerificationController.cs:273` |
| `GET` | `~/api/Verification/GetQuotationRatesDetails/{PurchaseOrderId}` | Side-by-side vendor quotation comparison for a PO. | `VerificationController.cs:296` |
| `GET` | `~/api/Verification/GetInventoryPurchaseOrderDetails/{PurchaseOrderId}` | Full PO view-model. | `VerificationController.cs:319` |
| `POST` | `~/api/Verification/ApprovePurchaseOrder/{VerificationRemarks?}` | Approve. Sets `POStatus = "active"` on final-level approval. | `VerificationController.cs:339` |
| `POST` | `~/api/Verification/RejectPurchaseOrder/{PurchaseOrderId}/{CurrentVerificationlevel}/{CurrentVerificationLevelCount}/{MaxVerificationLevel}` | Reject. Sets `POStatus = "cancelled"`. | `VerificationController.cs:375` |

### 6.4 Inventory Goods Receipt (4 endpoints)

| Method | Route | Purpose | Source |
|---|---|---|---|
| `GET` | `~/api/Verification/GetInventoryGRBasedOnUser/{FromDate}/{ToDate}` | List pending GRs the calling user is allowed to verify. | `VerificationController.cs:411` |
| `GET` | `~/api/Verification/GetInventoryGRDetails/{GoodsReceiptId}` | Full GR view-model with received items, charges, PO details, verifier chain. | `VerificationController.cs:435` |
| `POST` | `~/api/Verification/ApproveGoodsReceipt/{VerificationRemarks?}` | Approve. Generates IMIR number, sets `GRStatus = "verified"` on final-level approval. | `VerificationController.cs:455` |
| `POST` | `~/api/Verification/RejectGoodsReceipt/{GoodsReceiptId}/{CurrentVerificationlevel}/{CurrentVerificationLevelCount}/{MaxVerificationLevel}` | Reject. Sets `GRStatus = "cancelled"`. | `VerificationController.cs:511` |

### 6.5 Pharmacy Purchase Order (4 endpoints)

| Method | Route | Purpose | Source |
|---|---|---|---|
| `GET` | `PharmacyPurchaseOrdersBasedOnUser?fromDate={date}&toDate={date}` | List pending pharmacy POs. | `VerificationController.cs:548` |
| `GET` | `PharmacyPurchaseOrderInfo?purchaseOrderId={id}` | Full PO view-model with items, requestor, verifier chain. Returns an anonymous `{ Order, OrderItems, VerifierList }`. | `VerificationController.cs:558` |
| `POST` | `ApprovePharmacyPurchaseOrder` | Approve. Body: `PharmacyPurchaseOrder_DTO`. Sets `POStatus = "active"` on final-level. | `VerificationController.cs:567` |
| `POST` | `RejectPharmacyPurchaseOrder?purchaseOrderId={id}&currentVerificationlevel={n}&currentVerificationLevelCount={n}&maxVerificationLevel={n}&verificationRemarks={s}` | Reject. Sets `POStatus = "cancel"`. | `VerificationController.cs:577` |

### 6.6 Pharmacy Sub-Store Requisition (4 endpoints)

| Method | Route | Purpose | Source |
|---|---|---|---|
| `GET` | `PharmacyRequisitionsBasedOnUser?fromDate={date}&toDate={date}` | List pending pharmacy sub-store requisitions. | `VerificationController.cs:586` |
| `GET` | `PharmacyRequisitionInfo?requisitionId={id}` | Full requisition view-model. Returns `{ Requisition, RequisitionItems, VerifierList }`. | `VerificationController.cs:596` |
| `POST` | `ApprovePharmacyRequisition` | Approve. Body: `PharmacySubStoreRequisitionVerification_DTO`. Sets `RequisitionStatus = "active"` on final-level. | `VerificationController.cs:606` |
| `POST` | `RejectPharmacyRequisition?requisitionId={id}&currentVerificationlevel={n}&currentVerificationLevelCount={n}&maxVerificationLevel={n}&verificationRemarks={s}` | Reject. Sets `RequisitionStatus = "withdrawn"`. | `VerificationController.cs:616` |

**Total: 25 endpoints.**

### 6.7 Common request/response shapes

All endpoints return `DanpheHTTPResponse<object>` with `Status = "OK" | "Failed"`, `Results`, and (on error) `ErrorMessage`. List endpoints return `Results = List<…>`; detail endpoints return `Results = <ViewModel>`; approve endpoints return `Results = null` on success; reject endpoints return `Results = <RejectedId>` (integer).

The reject endpoints have an unusual signature: the rejection *level* parameters are in the route, but the `VerificationRemarks` body is read via `this.ReadPostData()` as a raw string (not JSON-deserialized). The client `VerificationDLService` calls these with `VerificationRemarks` as the body and `Content-Type: application/json` (the remarks string is wrapped in JSON quotes by `JSON.stringify`).

---

## 7. Cross-Module Touchpoints

| Module | Hook | How Verification touches it |
|---|---|---|
| **Inventory** | Requisitions, Purchase Requests, Purchase Orders, Goods Receipts | Each transaction row carries `IsVerificationEnabled` / `VerifierIds` / `VerificationId`. Verification approves/rejects are routed back through the originating controller's cancel/update paths (`InventoryBL.CancelSubstoreRequisition` etc.). The final-level approval also drives `RequisitionStatus`, `RequestStatus`, `POStatus`, `GRStatus` transitions. |
| **Pharmacy** | Sub-store requisitions, Purchase orders | Parallel structure to Inventory, but with its own `PHRM_TXN_Verification` ledger, its own `PHRMPurchaseOrder_DTO`, and the `TransactionType` discriminator on `PharmacyVerificationModel`. |
| **Ward Supply / Substore** | The `MST_MAP_StoreVerification` config | `SubstoreBL.CreateStoreVerificationMap` (`Controllers/WardSupply/SubstoreBL.cs:187`) and `CreateAndMapVerifiersWithStore` (line 223) populate the per-store permission→level map. The same `SubstoreBL.ActivateDeactivateStoreVerifierMap` (line 283) soft-deletes. `SubstoreBL.GetStoreVerifiersPermissionList` (line 39) is read by the older `SetDataForInventoryRequisition` path in `VerificationBL.cs:231` (still called for the back-compat `CheckForVerificationPermission` algorithm at line 81). |
| **Settings** | CfgParameters | `VerificationBL.GetPurchaseRequestVerificationSetting` reads `Inventory.PurchaseRequestVerificationSettings` from `Core_CFG_Parameters`. `SettingsController.GetStoreVerificationMapDetails` returns the store-level config to the admin UI. |
| **RBAC (Security)** | Permission checks | `RBAC.UserIsSuperAdmin`, `RBAC.UserHasRoleId`, `RBAC.UserHasPermissionId` are called in every list endpoint to determine the user's visible queue. The verifier matching itself is on user/role id, not on permissions, but the *ward-supply* legacy path (`CheckForVerificationPermission` at `VerificationBL.cs:81`) uses permission ids from `MST_MAP_StoreVerification`. |
| **Inventory receipt numbering** | `IInventoryReceiptNumberService` | Injected into the controller (constructor parameter) but currently *only* referenced inside a commented-out block in `ApproveGoodsReceipt` — the active IMIR-number generation is via `VerificationBL.GetIMIRNo` (line 464). The receipt-number service is the future migration path. |
| **Goods receipt stock posting** | `IInventoryGoodReceiptService.AddtoInventoryStock` | Injected into the controller. The final-level approval at `VerificationController.cs:489-496` prepares the items for stock posting (sets `DonationId`) but the actual `_goodReceiptService.AddtoInventoryStock` call is commented out — stock posting happens at a later stage of the GR workflow. |
| **Frontend (Angular)** | `VerificationModule` (11 components, 6 services) | See section 2.5. The shared state holder `VerificationService` carries the selected transaction between list and detail pages. `VerificationGridColumns` centralizes the column config + cell renderers. |
| **Common Utilities** | `CommonController`, `InvokeHttpGetFunction`, `InvokeHttpPostFunction` | The controller inherits from `CommonController` so the JWT `DanpheDataFilter` is applied automatically. Pharmacy endpoints use `InvokeHttpGetFunction` / `InvokeHttpPostFunction` to wrap a `Func<object>` in a uniform try/catch. |

---

## 8. Business Rules

1. **Verifiers are configured per-transaction** (except Purchase Request, which uses a global setting). Each `VerifierIds` JSON entry is `{ Id, Type: "role" | "user" }`. The number of entries is the `MaxVerificationLevel` for that transaction.

2. **A level is verified by exactly one role or one user.** If `Type = "role"`, *any* user holding that role can verify. If `Type = "user"`, only that specific user can verify. Mixed lists (e.g. role 1, role 2, user 42) are supported — the algorithm iterates the list and matches the *first* level the user qualifies for.

3. **A level can only be verified once.** `CheckForVerificationExistAtThisLevel` walks up the `ParentVerificationId` chain looking for any row at the target level. The moment it finds one, the check returns `true` and the action button is disabled. The same level cannot be approved twice.

4. **Approval at level N+1 requires approval at level N first.** The frontend filtering at `inventory-requisition-list.component.ts:93` shows only rows where `CurrentVerificationLevelCount < MaxVerificationLevel && isVerificationAllowed == true`. The "is verification allowed" check fails until all prior levels have been approved.

5. **Rejection at any level is terminal.** The reject path writes a row with `VerificationStatus = "rejected"` and immediately cancels the underlying transaction. Because the rejection row is in the chain, `CheckForVerificationExistAtThisLevel` will short-circuit on the rejection and disable the action button for the *current* user. Subsequent users at the same level (if `Type = "role"`) will also be blocked.

6. **Final-level approval triggers a status transition.** Reaching `CurrentVerificationLevelCount == MaxVerificationLevel` sets the underlying transaction's status to its post-verification state:
   - Requisition → `RequisitionStatus = "active"`.
   - Purchase Request → `RequestStatus = "pending"` (then immediately eligible for PO creation).
   - Purchase Order → `POStatus = "active"`.
   - Goods Receipt → `GRStatus = "verified"`, `IMIRNo` generated, `IMIRDate = DateTime.Now`.
   - Pharmacy PO → `POStatus = "active"`.
   - Pharmacy Requisition → `RequisitionStatus = "active"`.

7. **Goods Receipt final-level approval is the trigger for stock posting.** The controller code at lines 489-496 sets `grItem.DonationId` on each active item as the final-level side effect. (The actual stock-posting call to `IInventoryGoodReceiptService.AddtoInventoryStock` is commented out in the current build.)

8. **The IMIR number is monotonically increasing per fiscal year.** `VerificationBL.GetIMIRNo` (line 464) selects `MAX(IMIRNo)` for the fiscal year containing the IMIR date and returns `+1`. The fiscal year is looked up from `INV_MST_FiscalYear` where `StartDate <= DecidingDate AND EndDate >= DecidingDate`.

9. **Verifiers can cancel individual line items** as part of the approval. The front-end `CancelItem(index)` in `goods-receipt-verify.component.ts` (and the parallel methods in the requisition/PO/verify components) sets `IsActive = false` on the line. The server then sets `CancelQuantity = PendingQuantity`, `CancelBy = currentUser.EmployeeId`, `CancelOn = DateTime.Now`. The "last active item" guard (`CheckForCancelItemsCondition`) prevents the verifier from cancelling *every* line — they must use the Reject All button instead.

10. **The verifier's `VerifiedBy` is the `EmployeeId` from the JWT.** The controller pulls `HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser)` and passes `currentUser.EmployeeId` into `_verificationService.CreateVerification`. There is no path for a user to verify on behalf of another user.

11. **Audit trail is the ledger itself.** Every approval and rejection is an append to the ledger. Because the chain is self-referential via `ParentVerificationId`, the full history is reconstructable by recursion. The `VerifierList` returned by the details endpoints is the flattened chain in chronological order.

12. **Rejection cancels items as well as the parent transaction.** The `UpdatePharmacyRequisitionWithItems` / `UpdatePharmacyPurchaseOrderWithItems` paths set `CancelledBy/On/CancelRemarks` on each line. The inventory `UpdateRequisitionAfterApproved` does the same for the requisition items.

13. **The pharmacy reject path is wrapped in a `Database.BeginTransaction`** (`CancelPharmacyPurchaseOrderById` at line 1153, `CancelPharmacyRequisitionByRequisitionId` at line 1371). The inventory reject path is not — it relies on the EF `SaveChanges` call inside `InventoryBL.CancelSubstoreRequisition` etc. A failure in the inventory reject path could leave the ledger row written but the underlying transaction uncancelled.

14. **The verification detail view shows the verifier chain in chronological order.** `GetVerifiersList` recursively walks `ParentVerificationId` and appends each `VerificationActor` to the list as it unwinds, producing a list with `[level1, level2, level3, ...]` in order. This is consumed by the front-end `VerifierList` field on the requisition/PO/GR detail view-models.

15. **The verification is opt-in per transaction.** `IsVerificationEnabled` is set on the originating screen. If `false`, no `VerifierIds` are written (the inventory controller path at `InventoryController.cs:3185` sets `VerifierIds = null`), and the transaction skips the verification queue entirely. Pharmacy uses the same pattern (`PHRMPurchaseOrder.IsVerificationEnabled` / `PHRMStoreRequisition.IsVerificationEnabled`).

16. **The Purchase Request verification is opt-in globally, not per transaction.** The single `Inventory.PurchaseRequestVerificationSettings` CfgParameter row controls whether *all* purchase requests go through verification. There is no per-PR `IsVerificationEnabled` flag.

17. **`VerifierIds` may be empty or null.** If `VerifierIds` is `"[]"` or null, `MaxVerificationLevel = 0` and the verification list endpoints return the transaction without setting `isVerificationAllowed` (the algorithm at `VerificationBL.cs:69-71` will not set `isVerificationAllowed = true` because the for-loop iterates zero times; the transaction will not appear in the verify queue).

18. **Super-admins see every pending transaction** regardless of the `VerifierIds` list. The `RBAC.UserIsSuperAdmin(userId)` check is the first condition in every `IsUserAllowedToSee*` method, so a super-admin sees the entire pending queue at the level that is *not yet verified* (`CheckForVerificationExistAtThisLevel` is still called, so the super-admin still cannot verify an already-verified level).

19. **The Goods Receipt verification detail page supports live recalculation.** `Calculations()` in `goods-receipt-verify.component.ts:263-326` re-computes `SubTotal`, `VATTotal`, `CcCharge`, `Discount`, `DiscountAmount`, `TotalAmount`, `TotalWithTDS` per item using the GRFormCustomization parameter values (showFreeQuantity, showCCCharge, showDiscount). This is in addition to the standard server-side calculations.

20. **The Goods Receipt verification page is the only one that supports printing.** `Print()` (line 227) opens a popup window with a minimal print-styled HTML page that renders the `#printpage` element. The CSS is hard-coded with the print-friendly overrides (`border-top: dotted 1px;`, etc.). The other detail pages do not have a print button.

21. **The Pharmacy verification reject path does not preserve the per-line quantities at the time of rejection.** The reject flow sets `CancelRemarks = "Rejected by " + currentUser.UserName` on every line but does not adjust `Quantity` or `PendingQuantity` — it just cancels the lines as-is.

22. **`VerificationRemarks` is required for rejection.** The Pharmacy reject path at `pharmacy-verification-requisition.component.ts:152-167` always sends the remarks (it may be empty string if the user did not fill it in). The Inventory reject path reads the body as raw text via `this.ReadPostData()` and passes it to `_verificationService.CreateVerification` as the remarks.

23. **The verification detail panel always shows the requestor.** `InventoryRequisitionViewModel.RequestingUser`, `InventoryPurchaseRequestViewModel.RequestingUser`, `InventoryPurchaseOrderViewModel.OrderingUser`, `InventoryGoodsReceiptViewModel.ReceivingUser` are all `VerificationActor` instances populated from the originating transaction's `CreatedBy` + `CreatedOn` columns. The same pattern applies to the pharmacy `Order` (anonymous DTO) returned by `GetOrderInfo`.

24. **Dispatchers are part of the requisition verification detail.** `GetDispatchersList` (line 282) queries the dispatch list for the requisition and returns a `List<DispatchVerificationActor>` with `DispatchId`, `Date`, `Remarks`, `Name`, `isReceived`. This is rendered alongside the verifier chain in the requisition detail page.

25. **The `VerifierIds` JSON is the only place the per-level role/user list is stored.** The `MST_MAP_StoreVerification` table stores the *config* (which permission goes with which level for which store) but the *runtime* per-transaction list lives only in the JSON. If the verifier list is changed on the config side, in-flight transactions keep their original `VerifierIds` JSON and are not retroactively re-matched.
