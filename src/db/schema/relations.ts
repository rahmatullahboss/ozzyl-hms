import { relations } from "drizzle-orm/relations";
import { users, invitations, tenants, appointments, patients, prescriptions, medicines, prescriptionItems, insuranceClaims, insurancePolicies, pharmacySaleItems, pharmacySales, patientMessages, prescriptionRefillRequests, patientFamilyLinks, websitePageviews, erModeOfArrival, erPatients, erDischargeSummaries, erPatientCases, erFileUploads, otBookings, staff, otTeamMembers, otChecklistItems, otSummaries, bills, billingDeposits, clinicalVitals, patientAllergies, inventoryItemCategory, inventoryItemSubCategory, inventoryUnitOfMeasurement, inventoryItem, inventoryStore, inventoryPurchaseOrder, inventoryVendor, inventoryPurchaseOrderItem, inventoryGoodsReceipt, inventoryGoodsReceiptItem, inventoryStock, inventoryRequisition, inventoryRequisitionItem, inventoryDispatch, inventoryDispatchItem, inventoryWriteOff, inventoryWriteOffItem, inventoryStockTransaction, inventoryReturnToVendor, inventoryReturnToVendorItem, inventoryRequestForQuotationItem, inventoryRequestForQuotation, inventoryRequestForQuotationVendor, inventoryQuotation, inventoryQuotationItem, inventoryPurchaseOrderDraft, inventoryPurchaseOrderDraftItem, inventorySubstoreReturn, inventorySubstoreReturnItem, inventoryFixedAssetStock, billingSchemes, billingSubSchemes, billingPriceCategories, billingSchemePriceCategoryMap, billingServiceDepartments, billingServiceItems, billingItemPriceCategoryMap, billingPackageItems, billingPackages, billingMembershipTypes, patientMemberships, billingReportingItems, billingReportingItemMap, formularyItems, formularyCategories, patientActiveMedications, prescriptionSafetyChecks, serials, tests, payments, income, expenses, salaryPayments, profitDistributions, chartOfAccounts, journalEntries, recurringExpenses, expenseCategories, incomeDetail, auditLogs, billingCreditBillStatus, billingSettlements } from "./schema";

export const invitationsRelations = relations(invitations, ({one}) => ({
	user: one(users, {
		fields: [invitations.invitedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [invitations.tenantId],
		references: [tenants.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	invitations: many(invitations),
	incomes: many(income),
	expenses_createdBy: many(expenses, {
		relationName: "expenses_createdBy_users_id"
	}),
	expenses_approvedBy: many(expenses, {
		relationName: "expenses_approvedBy_users_id"
	}),
	profitDistributions: many(profitDistributions),
	journalEntries: many(journalEntries),
	recurringExpenses: many(recurringExpenses),
	auditLogs: many(auditLogs),
}));

export const tenantsRelations = relations(tenants, ({many}) => ({
	invitations: many(invitations),
	websitePageviews: many(websitePageviews),
}));

export const appointmentsRelations = relations(appointments, ({one, many}) => ({
	patient: one(patients, {
		fields: [appointments.patientId],
		references: [patients.id]
	}),
	prescriptions: many(prescriptions),
}));


export const patientsRelations = relations(patients, ({many}) => ({
	appointments: many(appointments),
	prescriptions: many(prescriptions),
	patientMessages: many(patientMessages),
	prescriptionRefillRequests: many(prescriptionRefillRequests),
	patientFamilyLinks_childPatientId: many(patientFamilyLinks, {
		relationName: "patientFamilyLinks_childPatientId_patients_id"
	}),
	patientFamilyLinks_parentPatientId: many(patientFamilyLinks, {
		relationName: "patientFamilyLinks_parentPatientId_patients_id"
	}),
	erPatients: many(erPatients),
	erDischargeSummaries: many(erDischargeSummaries),
	erFileUploads: many(erFileUploads),
	otBookings: many(otBookings),
	otTeamMembers: many(otTeamMembers),
	billingDeposits: many(billingDeposits),
	billingCreditBillStatuses: many(billingCreditBillStatus),
	clinicalVitals: many(clinicalVitals),
	patientAllergies: many(patientAllergies),
	patientActiveMedications: many(patientActiveMedications),
	prescriptionSafetyChecks: many(prescriptionSafetyChecks),
	serials: many(serials),
	tests: many(tests),
	bills: many(bills),
}));

export const prescriptionsRelations = relations(prescriptions, ({one, many}) => ({
	appointment: one(appointments, {
		fields: [prescriptions.appointmentId],
		references: [appointments.id]
	}),
	patient: one(patients, {
		fields: [prescriptions.patientId],
		references: [patients.id]
	}),
	prescriptionItems: many(prescriptionItems),
	prescriptionRefillRequests: many(prescriptionRefillRequests),
	patientActiveMedications: many(patientActiveMedications),
	prescriptionSafetyChecks: many(prescriptionSafetyChecks),
}));

export const prescriptionItemsRelations = relations(prescriptionItems, ({one}) => ({
	medicine: one(medicines, {
		fields: [prescriptionItems.medicineId],
		references: [medicines.id]
	}),
	prescription: one(prescriptions, {
		fields: [prescriptionItems.prescriptionId],
		references: [prescriptions.id]
	}),
}));

export const medicinesRelations = relations(medicines, ({many}) => ({
	prescriptionItems: many(prescriptionItems),
	pharmacySaleItems: many(pharmacySaleItems),
	formularyItems: many(formularyItems),
}));

export const insuranceClaimsRelations = relations(insuranceClaims, ({one}) => ({
	insurancePolicy: one(insurancePolicies, {
		fields: [insuranceClaims.policyId],
		references: [insurancePolicies.id]
	}),
}));


export const insurancePoliciesRelations = relations(insurancePolicies, ({many}) => ({
	insuranceClaims: many(insuranceClaims),
}));

export const pharmacySaleItemsRelations = relations(pharmacySaleItems, ({one}) => ({
	medicine: one(medicines, {
		fields: [pharmacySaleItems.medicineId],
		references: [medicines.id]
	}),
	pharmacySale: one(pharmacySales, {
		fields: [pharmacySaleItems.saleId],
		references: [pharmacySales.id]
	}),
}));

export const pharmacySalesRelations = relations(pharmacySales, ({many}) => ({
	pharmacySaleItems: many(pharmacySaleItems),
}));

export const patientMessagesRelations = relations(patientMessages, ({one}) => ({
	patient: one(patients, {
		fields: [patientMessages.patientId],
		references: [patients.id]
	}),
}));

export const prescriptionRefillRequestsRelations = relations(prescriptionRefillRequests, ({one}) => ({
	patient: one(patients, {
		fields: [prescriptionRefillRequests.patientId],
		references: [patients.id]
	}),
	prescription: one(prescriptions, {
		fields: [prescriptionRefillRequests.prescriptionId],
		references: [prescriptions.id]
	}),
}));

export const patientFamilyLinksRelations = relations(patientFamilyLinks, ({one}) => ({
	patient_childPatientId: one(patients, {
		fields: [patientFamilyLinks.childPatientId],
		references: [patients.id],
		relationName: "patientFamilyLinks_childPatientId_patients_id"
	}),
	patient_parentPatientId: one(patients, {
		fields: [patientFamilyLinks.parentPatientId],
		references: [patients.id],
		relationName: "patientFamilyLinks_parentPatientId_patients_id"
	}),
}));

export const websitePageviewsRelations = relations(websitePageviews, ({one}) => ({
	tenant: one(tenants, {
		fields: [websitePageviews.tenantId],
		references: [tenants.id]
	}),
}));

export const erPatientsRelations = relations(erPatients, ({one, many}) => ({
	erModeOfArrival: one(erModeOfArrival, {
		fields: [erPatients.modeOfArrivalId],
		references: [erModeOfArrival.id]
	}),
	patient: one(patients, {
		fields: [erPatients.patientId],
		references: [patients.id]
	}),
	erPatientCases: many(erPatientCases),
	erFileUploads: many(erFileUploads),
}));

export const erModeOfArrivalRelations = relations(erModeOfArrival, ({many}) => ({
	erPatients: many(erPatients),
}));


export const erDischargeSummariesRelations = relations(erDischargeSummaries, ({one}) => ({
	patient: one(patients, {
		fields: [erDischargeSummaries.patientId],
		references: [patients.id]
	}),
}));

export const erPatientCasesRelations = relations(erPatientCases, ({one}) => ({
	erPatient: one(erPatients, {
		fields: [erPatientCases.erPatientId],
		references: [erPatients.id]
	}),
}));

export const erFileUploadsRelations = relations(erFileUploads, ({one}) => ({
	patient: one(patients, {
		fields: [erFileUploads.patientId],
		references: [patients.id]
	}),
	erPatient: one(erPatients, {
		fields: [erFileUploads.erPatientId],
		references: [erPatients.id]
	}),
}));

export const otBookingsRelations = relations(otBookings, ({one, many}) => ({
	patient: one(patients, {
		fields: [otBookings.patientId],
		references: [patients.id]
	}),
	otTeamMembers: many(otTeamMembers),
	otChecklistItems: many(otChecklistItems),
	otSummaries: many(otSummaries),
}));

export const otTeamMembersRelations = relations(otTeamMembers, ({one, many}) => ({
	staff: one(staff, {
		fields: [otTeamMembers.staffId],
		references: [staff.id]
	}),
	patient: one(patients, {
		fields: [otTeamMembers.patientId],
		references: [patients.id]
	}),
	otBooking: one(otBookings, {
		fields: [otTeamMembers.bookingId],
		references: [otBookings.id]
	}),
	otSummaries: many(otSummaries),
}));

export const staffRelations = relations(staff, ({many}) => ({
	otTeamMembers: many(otTeamMembers),
	salaryPayments: many(salaryPayments),
}));

export const otChecklistItemsRelations = relations(otChecklistItems, ({one}) => ({
	otBooking: one(otBookings, {
		fields: [otChecklistItems.bookingId],
		references: [otBookings.id]
	}),
}));

export const otSummariesRelations = relations(otSummaries, ({one}) => ({
	otTeamMember: one(otTeamMembers, {
		fields: [otSummaries.teamMemberId],
		references: [otTeamMembers.id]
	}),
	otBooking: one(otBookings, {
		fields: [otSummaries.bookingId],
		references: [otBookings.id]
	}),
}));

export const billingDepositsRelations = relations(billingDeposits, ({one}) => ({
	bill: one(bills, {
		fields: [billingDeposits.referenceBillId],
		references: [bills.id]
	}),
	patient: one(patients, {
		fields: [billingDeposits.patientId],
		references: [patients.id]
	}),
}));

export const billsRelations = relations(bills, ({one, many}) => ({
	billingDeposits: many(billingDeposits),
	billingCreditBillStatuses: many(billingCreditBillStatus),
	patient: one(patients, {
		fields: [bills.patientId],
		references: [patients.id]
	}),
	payments: many(payments),
	incomes: many(income),
}));

export const clinicalVitalsRelations = relations(clinicalVitals, ({one}) => ({
	patient: one(patients, {
		fields: [clinicalVitals.patientId],
		references: [patients.id]
	}),
}));

export const patientAllergiesRelations = relations(patientAllergies, ({one}) => ({
	patient: one(patients, {
		fields: [patientAllergies.patientId],
		references: [patients.id]
	}),
}));

export const inventoryItemSubCategoryRelations = relations(inventoryItemSubCategory, ({one, many}) => ({
	inventoryItemCategory: one(inventoryItemCategory, {
		fields: [inventoryItemSubCategory.itemCategoryId],
		references: [inventoryItemCategory.itemCategoryId]
	}),
	inventoryItems: many(inventoryItem),
}));

export const inventoryItemCategoryRelations = relations(inventoryItemCategory, ({many}) => ({
	inventoryItemSubCategories: many(inventoryItemSubCategory),
	inventoryItems: many(inventoryItem),
}));

export const inventoryItemRelations = relations(inventoryItem, ({one, many}) => ({
	inventoryUnitOfMeasurement: one(inventoryUnitOfMeasurement, {
		fields: [inventoryItem.uomId],
		references: [inventoryUnitOfMeasurement.uomId]
	}),
	inventoryItemSubCategory: one(inventoryItemSubCategory, {
		fields: [inventoryItem.subCategoryId],
		references: [inventoryItemSubCategory.subCategoryId]
	}),
	inventoryItemCategory: one(inventoryItemCategory, {
		fields: [inventoryItem.itemCategoryId],
		references: [inventoryItemCategory.itemCategoryId]
	}),
	inventoryPurchaseOrderItems: many(inventoryPurchaseOrderItem),
	inventoryGoodsReceiptItems: many(inventoryGoodsReceiptItem),
	inventoryStocks: many(inventoryStock),
	inventoryRequisitionItems: many(inventoryRequisitionItem),
	inventoryDispatchItems: many(inventoryDispatchItem),
	inventoryWriteOffItems: many(inventoryWriteOffItem),
	inventoryStockTransactions: many(inventoryStockTransaction),
	inventoryReturnToVendorItems: many(inventoryReturnToVendorItem),
	inventoryRequestForQuotationItems: many(inventoryRequestForQuotationItem),
	inventoryQuotationItems: many(inventoryQuotationItem),
	inventoryPurchaseOrderDraftItems: many(inventoryPurchaseOrderDraftItem),
	inventorySubstoreReturnItems: many(inventorySubstoreReturnItem),
	inventoryFixedAssetStocks: many(inventoryFixedAssetStock),
}));

export const inventoryUnitOfMeasurementRelations = relations(inventoryUnitOfMeasurement, ({many}) => ({
	inventoryItems: many(inventoryItem),
}));

export const inventoryStoreRelations = relations(inventoryStore, ({one, many}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryStore.parentStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventoryStore_parentStoreId_inventoryStore_storeId"
	}),
	inventoryStores: many(inventoryStore, {
		relationName: "inventoryStore_parentStoreId_inventoryStore_storeId"
	}),
	inventoryPurchaseOrders: many(inventoryPurchaseOrder),
	inventoryGoodsReceipts: many(inventoryGoodsReceipt),
	inventoryStocks: many(inventoryStock),
	inventoryRequisitions_sourceStoreId: many(inventoryRequisition, {
		relationName: "inventoryRequisition_sourceStoreId_inventoryStore_storeId"
	}),
	inventoryRequisitions_requestingStoreId: many(inventoryRequisition, {
		relationName: "inventoryRequisition_requestingStoreId_inventoryStore_storeId"
	}),
	inventoryDispatches_destinationStoreId: many(inventoryDispatch, {
		relationName: "inventoryDispatch_destinationStoreId_inventoryStore_storeId"
	}),
	inventoryDispatches_sourceStoreId: many(inventoryDispatch, {
		relationName: "inventoryDispatch_sourceStoreId_inventoryStore_storeId"
	}),
	inventoryWriteOffs: many(inventoryWriteOff),
	inventoryStockTransactions: many(inventoryStockTransaction),
	inventoryReturnToVendors: many(inventoryReturnToVendor),
	inventorySubstoreReturns_sourceStoreId: many(inventorySubstoreReturn, {
		relationName: "inventorySubstoreReturn_sourceStoreId_inventoryStore_storeId"
	}),
	inventorySubstoreReturns_targetStoreId: many(inventorySubstoreReturn, {
		relationName: "inventorySubstoreReturn_targetStoreId_inventoryStore_storeId"
	}),
	inventoryFixedAssetStocks: many(inventoryFixedAssetStock),
}));

export const inventoryPurchaseOrderRelations = relations(inventoryPurchaseOrder, ({one, many}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryPurchaseOrder.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryVendor: one(inventoryVendor, {
		fields: [inventoryPurchaseOrder.vendorId],
		references: [inventoryVendor.vendorId]
	}),
	inventoryPurchaseOrderItems: many(inventoryPurchaseOrderItem),
	inventoryGoodsReceipts: many(inventoryGoodsReceipt),
}));

export const inventoryVendorRelations = relations(inventoryVendor, ({many}) => ({
	inventoryPurchaseOrders: many(inventoryPurchaseOrder),
	inventoryGoodsReceipts: many(inventoryGoodsReceipt),
	inventoryReturnToVendors: many(inventoryReturnToVendor),
	inventoryRequestForQuotationVendors: many(inventoryRequestForQuotationVendor),
	inventoryQuotations: many(inventoryQuotation),
	inventoryPurchaseOrderDrafts: many(inventoryPurchaseOrderDraft),
}));

export const inventoryPurchaseOrderItemRelations = relations(inventoryPurchaseOrderItem, ({one, many}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventoryPurchaseOrderItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryPurchaseOrder: one(inventoryPurchaseOrder, {
		fields: [inventoryPurchaseOrderItem.purchaseOrderId],
		references: [inventoryPurchaseOrder.purchaseOrderId]
	}),
	inventoryGoodsReceiptItems: many(inventoryGoodsReceiptItem),
}));

export const inventoryGoodsReceiptRelations = relations(inventoryGoodsReceipt, ({one, many}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryGoodsReceipt.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryPurchaseOrder: one(inventoryPurchaseOrder, {
		fields: [inventoryGoodsReceipt.purchaseOrderId],
		references: [inventoryPurchaseOrder.purchaseOrderId]
	}),
	inventoryVendor: one(inventoryVendor, {
		fields: [inventoryGoodsReceipt.vendorId],
		references: [inventoryVendor.vendorId]
	}),
	inventoryGoodsReceiptItems: many(inventoryGoodsReceiptItem),
	inventoryReturnToVendors: many(inventoryReturnToVendor),
}));

export const inventoryGoodsReceiptItemRelations = relations(inventoryGoodsReceiptItem, ({one, many}) => ({
	inventoryPurchaseOrderItem: one(inventoryPurchaseOrderItem, {
		fields: [inventoryGoodsReceiptItem.poItemId],
		references: [inventoryPurchaseOrderItem.poItemId]
	}),
	inventoryItem: one(inventoryItem, {
		fields: [inventoryGoodsReceiptItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryGoodsReceipt: one(inventoryGoodsReceipt, {
		fields: [inventoryGoodsReceiptItem.goodsReceiptId],
		references: [inventoryGoodsReceipt.goodsReceiptId]
	}),
	inventoryStocks: many(inventoryStock),
	inventoryReturnToVendorItems: many(inventoryReturnToVendorItem),
}));

export const inventoryStockRelations = relations(inventoryStock, ({one, many}) => ({
	inventoryGoodsReceiptItem: one(inventoryGoodsReceiptItem, {
		fields: [inventoryStock.grItemId],
		references: [inventoryGoodsReceiptItem.grItemId]
	}),
	inventoryStore: one(inventoryStore, {
		fields: [inventoryStock.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryItem: one(inventoryItem, {
		fields: [inventoryStock.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryDispatchItems: many(inventoryDispatchItem),
	inventoryWriteOffItems: many(inventoryWriteOffItem),
	inventoryStockTransactions: many(inventoryStockTransaction),
}));

export const inventoryRequisitionRelations = relations(inventoryRequisition, ({one, many}) => ({
	inventoryStore_sourceStoreId: one(inventoryStore, {
		fields: [inventoryRequisition.sourceStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventoryRequisition_sourceStoreId_inventoryStore_storeId"
	}),
	inventoryStore_requestingStoreId: one(inventoryStore, {
		fields: [inventoryRequisition.requestingStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventoryRequisition_requestingStoreId_inventoryStore_storeId"
	}),
	inventoryRequisitionItems: many(inventoryRequisitionItem),
	inventoryDispatches: many(inventoryDispatch),
}));

export const inventoryRequisitionItemRelations = relations(inventoryRequisitionItem, ({one, many}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventoryRequisitionItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryRequisition: one(inventoryRequisition, {
		fields: [inventoryRequisitionItem.requisitionId],
		references: [inventoryRequisition.requisitionId]
	}),
	inventoryDispatchItems: many(inventoryDispatchItem),
}));

export const inventoryDispatchRelations = relations(inventoryDispatch, ({one, many}) => ({
	inventoryStore_destinationStoreId: one(inventoryStore, {
		fields: [inventoryDispatch.destinationStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventoryDispatch_destinationStoreId_inventoryStore_storeId"
	}),
	inventoryStore_sourceStoreId: one(inventoryStore, {
		fields: [inventoryDispatch.sourceStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventoryDispatch_sourceStoreId_inventoryStore_storeId"
	}),
	inventoryRequisition: one(inventoryRequisition, {
		fields: [inventoryDispatch.requisitionId],
		references: [inventoryRequisition.requisitionId]
	}),
	inventoryDispatchItems: many(inventoryDispatchItem),
}));

export const inventoryDispatchItemRelations = relations(inventoryDispatchItem, ({one}) => ({
	inventoryStock: one(inventoryStock, {
		fields: [inventoryDispatchItem.stockId],
		references: [inventoryStock.stockId]
	}),
	inventoryItem: one(inventoryItem, {
		fields: [inventoryDispatchItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryRequisitionItem: one(inventoryRequisitionItem, {
		fields: [inventoryDispatchItem.requisitionItemId],
		references: [inventoryRequisitionItem.requisitionItemId]
	}),
	inventoryDispatch: one(inventoryDispatch, {
		fields: [inventoryDispatchItem.dispatchId],
		references: [inventoryDispatch.dispatchId]
	}),
}));

export const inventoryWriteOffRelations = relations(inventoryWriteOff, ({one, many}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryWriteOff.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryWriteOffItems: many(inventoryWriteOffItem),
}));

export const inventoryWriteOffItemRelations = relations(inventoryWriteOffItem, ({one}) => ({
	inventoryStock: one(inventoryStock, {
		fields: [inventoryWriteOffItem.stockId],
		references: [inventoryStock.stockId]
	}),
	inventoryItem: one(inventoryItem, {
		fields: [inventoryWriteOffItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryWriteOff: one(inventoryWriteOff, {
		fields: [inventoryWriteOffItem.writeOffId],
		references: [inventoryWriteOff.writeOffId]
	}),
}));

export const inventoryStockTransactionRelations = relations(inventoryStockTransaction, ({one}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryStockTransaction.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryStock: one(inventoryStock, {
		fields: [inventoryStockTransaction.stockId],
		references: [inventoryStock.stockId]
	}),
	inventoryItem: one(inventoryItem, {
		fields: [inventoryStockTransaction.itemId],
		references: [inventoryItem.itemId]
	}),
}));

export const inventoryReturnToVendorRelations = relations(inventoryReturnToVendor, ({one, many}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryReturnToVendor.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryGoodsReceipt: one(inventoryGoodsReceipt, {
		fields: [inventoryReturnToVendor.goodsReceiptId],
		references: [inventoryGoodsReceipt.goodsReceiptId]
	}),
	inventoryVendor: one(inventoryVendor, {
		fields: [inventoryReturnToVendor.vendorId],
		references: [inventoryVendor.vendorId]
	}),
	inventoryReturnToVendorItems: many(inventoryReturnToVendorItem),
}));

export const inventoryReturnToVendorItemRelations = relations(inventoryReturnToVendorItem, ({one}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventoryReturnToVendorItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryGoodsReceiptItem: one(inventoryGoodsReceiptItem, {
		fields: [inventoryReturnToVendorItem.grItemId],
		references: [inventoryGoodsReceiptItem.grItemId]
	}),
	inventoryReturnToVendor: one(inventoryReturnToVendor, {
		fields: [inventoryReturnToVendorItem.returnId],
		references: [inventoryReturnToVendor.returnId]
	}),
}));

export const inventoryRequestForQuotationItemRelations = relations(inventoryRequestForQuotationItem, ({one}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventoryRequestForQuotationItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryRequestForQuotation: one(inventoryRequestForQuotation, {
		fields: [inventoryRequestForQuotationItem.rfqId],
		references: [inventoryRequestForQuotation.rfqId]
	}),
}));

export const inventoryRequestForQuotationRelations = relations(inventoryRequestForQuotation, ({many}) => ({
	inventoryRequestForQuotationItems: many(inventoryRequestForQuotationItem),
	inventoryRequestForQuotationVendors: many(inventoryRequestForQuotationVendor),
	inventoryQuotations: many(inventoryQuotation),
}));

export const inventoryRequestForQuotationVendorRelations = relations(inventoryRequestForQuotationVendor, ({one}) => ({
	inventoryVendor: one(inventoryVendor, {
		fields: [inventoryRequestForQuotationVendor.vendorId],
		references: [inventoryVendor.vendorId]
	}),
	inventoryRequestForQuotation: one(inventoryRequestForQuotation, {
		fields: [inventoryRequestForQuotationVendor.rfqId],
		references: [inventoryRequestForQuotation.rfqId]
	}),
}));

export const inventoryQuotationRelations = relations(inventoryQuotation, ({one, many}) => ({
	inventoryVendor: one(inventoryVendor, {
		fields: [inventoryQuotation.vendorId],
		references: [inventoryVendor.vendorId]
	}),
	inventoryRequestForQuotation: one(inventoryRequestForQuotation, {
		fields: [inventoryQuotation.rfqId],
		references: [inventoryRequestForQuotation.rfqId]
	}),
	inventoryQuotationItems: many(inventoryQuotationItem),
}));

export const inventoryQuotationItemRelations = relations(inventoryQuotationItem, ({one}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventoryQuotationItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryQuotation: one(inventoryQuotation, {
		fields: [inventoryQuotationItem.quotationId],
		references: [inventoryQuotation.quotationId]
	}),
}));

export const inventoryPurchaseOrderDraftRelations = relations(inventoryPurchaseOrderDraft, ({one, many}) => ({
	inventoryVendor: one(inventoryVendor, {
		fields: [inventoryPurchaseOrderDraft.vendorId],
		references: [inventoryVendor.vendorId]
	}),
	inventoryPurchaseOrderDraftItems: many(inventoryPurchaseOrderDraftItem),
}));

export const inventoryPurchaseOrderDraftItemRelations = relations(inventoryPurchaseOrderDraftItem, ({one}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventoryPurchaseOrderDraftItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventoryPurchaseOrderDraft: one(inventoryPurchaseOrderDraft, {
		fields: [inventoryPurchaseOrderDraftItem.draftPurchaseOrderId],
		references: [inventoryPurchaseOrderDraft.draftPurchaseOrderId]
	}),
}));

export const inventorySubstoreReturnRelations = relations(inventorySubstoreReturn, ({one, many}) => ({
	inventoryStore_sourceStoreId: one(inventoryStore, {
		fields: [inventorySubstoreReturn.sourceStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventorySubstoreReturn_sourceStoreId_inventoryStore_storeId"
	}),
	inventoryStore_targetStoreId: one(inventoryStore, {
		fields: [inventorySubstoreReturn.targetStoreId],
		references: [inventoryStore.storeId],
		relationName: "inventorySubstoreReturn_targetStoreId_inventoryStore_storeId"
	}),
	inventorySubstoreReturnItems: many(inventorySubstoreReturnItem),
}));

export const inventorySubstoreReturnItemRelations = relations(inventorySubstoreReturnItem, ({one}) => ({
	inventoryItem: one(inventoryItem, {
		fields: [inventorySubstoreReturnItem.itemId],
		references: [inventoryItem.itemId]
	}),
	inventorySubstoreReturn: one(inventorySubstoreReturn, {
		fields: [inventorySubstoreReturnItem.returnId],
		references: [inventorySubstoreReturn.returnId]
	}),
}));

export const inventoryFixedAssetStockRelations = relations(inventoryFixedAssetStock, ({one}) => ({
	inventoryStore: one(inventoryStore, {
		fields: [inventoryFixedAssetStock.storeId],
		references: [inventoryStore.storeId]
	}),
	inventoryItem: one(inventoryItem, {
		fields: [inventoryFixedAssetStock.itemId],
		references: [inventoryItem.itemId]
	}),
}));

export const billingSubSchemesRelations = relations(billingSubSchemes, ({one}) => ({
	billingScheme: one(billingSchemes, {
		fields: [billingSubSchemes.schemeId],
		references: [billingSchemes.id]
	}),
}));

export const billingSchemesRelations = relations(billingSchemes, ({many}) => ({
	billingSubSchemes: many(billingSubSchemes),
	billingSchemePriceCategoryMaps: many(billingSchemePriceCategoryMap),
}));

export const billingSchemePriceCategoryMapRelations = relations(billingSchemePriceCategoryMap, ({one}) => ({
	billingPriceCategory: one(billingPriceCategories, {
		fields: [billingSchemePriceCategoryMap.priceCategoryId],
		references: [billingPriceCategories.id]
	}),
	billingScheme: one(billingSchemes, {
		fields: [billingSchemePriceCategoryMap.schemeId],
		references: [billingSchemes.id]
	}),
}));

export const billingPriceCategoriesRelations = relations(billingPriceCategories, ({many}) => ({
	billingSchemePriceCategoryMaps: many(billingSchemePriceCategoryMap),
	billingItemPriceCategoryMaps: many(billingItemPriceCategoryMap),
}));

export const billingServiceItemsRelations = relations(billingServiceItems, ({one, many}) => ({
	billingServiceDepartment: one(billingServiceDepartments, {
		fields: [billingServiceItems.serviceDepartmentId],
		references: [billingServiceDepartments.id]
	}),
	billingItemPriceCategoryMaps: many(billingItemPriceCategoryMap),
	billingPackageItems: many(billingPackageItems),
	billingReportingItemMaps: many(billingReportingItemMap),
}));

export const billingServiceDepartmentsRelations = relations(billingServiceDepartments, ({many}) => ({
	billingServiceItems: many(billingServiceItems),
}));

export const billingItemPriceCategoryMapRelations = relations(billingItemPriceCategoryMap, ({one}) => ({
	billingPriceCategory: one(billingPriceCategories, {
		fields: [billingItemPriceCategoryMap.priceCategoryId],
		references: [billingPriceCategories.id]
	}),
	billingServiceItem: one(billingServiceItems, {
		fields: [billingItemPriceCategoryMap.serviceItemId],
		references: [billingServiceItems.id]
	}),
}));

export const billingPackageItemsRelations = relations(billingPackageItems, ({one}) => ({
	billingServiceItem: one(billingServiceItems, {
		fields: [billingPackageItems.serviceItemId],
		references: [billingServiceItems.id]
	}),
	billingPackage: one(billingPackages, {
		fields: [billingPackageItems.packageId],
		references: [billingPackages.id]
	}),
}));

export const billingPackagesRelations = relations(billingPackages, ({many}) => ({
	billingPackageItems: many(billingPackageItems),
}));

export const patientMembershipsRelations = relations(patientMemberships, ({one}) => ({
	billingMembershipType: one(billingMembershipTypes, {
		fields: [patientMemberships.membershipTypeId],
		references: [billingMembershipTypes.id]
	}),
}));

export const billingMembershipTypesRelations = relations(billingMembershipTypes, ({many}) => ({
	patientMemberships: many(patientMemberships),
}));

export const billingReportingItemMapRelations = relations(billingReportingItemMap, ({one}) => ({
	billingReportingItem: one(billingReportingItems, {
		fields: [billingReportingItemMap.reportingItemId],
		references: [billingReportingItems.id]
	}),
	billingServiceItem: one(billingServiceItems, {
		fields: [billingReportingItemMap.serviceItemId],
		references: [billingServiceItems.id]
	}),
}));

export const billingReportingItemsRelations = relations(billingReportingItems, ({many}) => ({
	billingReportingItemMaps: many(billingReportingItemMap),
}));

export const formularyItemsRelations = relations(formularyItems, ({one, many}) => ({
	medicine: one(medicines, {
		fields: [formularyItems.medicineId],
		references: [medicines.id]
	}),
	formularyCategory: one(formularyCategories, {
		fields: [formularyItems.categoryId],
		references: [formularyCategories.id]
	}),
	patientActiveMedications: many(patientActiveMedications),
}));

export const formularyCategoriesRelations = relations(formularyCategories, ({many}) => ({
	formularyItems: many(formularyItems),
}));

export const patientActiveMedicationsRelations = relations(patientActiveMedications, ({one}) => ({
	prescription: one(prescriptions, {
		fields: [patientActiveMedications.prescriptionId],
		references: [prescriptions.id]
	}),
	formularyItem: one(formularyItems, {
		fields: [patientActiveMedications.formularyItemId],
		references: [formularyItems.id]
	}),
	patient: one(patients, {
		fields: [patientActiveMedications.patientId],
		references: [patients.id]
	}),
}));

export const prescriptionSafetyChecksRelations = relations(prescriptionSafetyChecks, ({one}) => ({
	prescription: one(prescriptions, {
		fields: [prescriptionSafetyChecks.prescriptionId],
		references: [prescriptions.id]
	}),
	patient: one(patients, {
		fields: [prescriptionSafetyChecks.patientId],
		references: [patients.id]
	}),
}));

export const serialsRelations = relations(serials, ({one}) => ({
	patient: one(patients, {
		fields: [serials.patientId],
		references: [patients.id]
	}),
}));

export const testsRelations = relations(tests, ({one}) => ({
	patient: one(patients, {
		fields: [tests.patientId],
		references: [patients.id]
	}),
}));

export const paymentsRelations = relations(payments, ({one}) => ({
	bill: one(bills, {
		fields: [payments.billId],
		references: [bills.id]
	}),
}));

export const incomeRelations = relations(income, ({one, many}) => ({
	user: one(users, {
		fields: [income.createdBy],
		references: [users.id]
	}),
	bill: one(bills, {
		fields: [income.billId],
		references: [bills.id]
	}),
	incomeDetails: many(incomeDetail),
}));

export const expensesRelations = relations(expenses, ({one}) => ({
	user_createdBy: one(users, {
		fields: [expenses.createdBy],
		references: [users.id],
		relationName: "expenses_createdBy_users_id"
	}),
	user_approvedBy: one(users, {
		fields: [expenses.approvedBy],
		references: [users.id],
		relationName: "expenses_approvedBy_users_id"
	}),
}));

export const salaryPaymentsRelations = relations(salaryPayments, ({one}) => ({
	staff: one(staff, {
		fields: [salaryPayments.staffId],
		references: [staff.id]
	}),
}));

export const profitDistributionsRelations = relations(profitDistributions, ({one}) => ({
	user: one(users, {
		fields: [profitDistributions.approvedBy],
		references: [users.id]
	}),
}));

export const chartOfAccountsRelations = relations(chartOfAccounts, ({one, many}) => ({
	chartOfAccount: one(chartOfAccounts, {
		fields: [chartOfAccounts.parentId],
		references: [chartOfAccounts.id],
		relationName: "chartOfAccounts_parentId_chartOfAccounts_id"
	}),
	chartOfAccounts: many(chartOfAccounts, {
		relationName: "chartOfAccounts_parentId_chartOfAccounts_id"
	}),
	journalEntries_creditAccountId: many(journalEntries, {
		relationName: "journalEntries_creditAccountId_chartOfAccounts_id"
	}),
	journalEntries_debitAccountId: many(journalEntries, {
		relationName: "journalEntries_debitAccountId_chartOfAccounts_id"
	}),
	incomeDetails: many(incomeDetail),
}));

export const journalEntriesRelations = relations(journalEntries, ({one}) => ({
	user: one(users, {
		fields: [journalEntries.createdBy],
		references: [users.id]
	}),
	chartOfAccount_creditAccountId: one(chartOfAccounts, {
		fields: [journalEntries.creditAccountId],
		references: [chartOfAccounts.id],
		relationName: "journalEntries_creditAccountId_chartOfAccounts_id"
	}),
	chartOfAccount_debitAccountId: one(chartOfAccounts, {
		fields: [journalEntries.debitAccountId],
		references: [chartOfAccounts.id],
		relationName: "journalEntries_debitAccountId_chartOfAccounts_id"
	}),
}));

export const recurringExpensesRelations = relations(recurringExpenses, ({one}) => ({
	user: one(users, {
		fields: [recurringExpenses.createdBy],
		references: [users.id]
	}),
	expenseCategory: one(expenseCategories, {
		fields: [recurringExpenses.categoryId],
		references: [expenseCategories.id]
	}),
}));

export const expenseCategoriesRelations = relations(expenseCategories, ({many}) => ({
	recurringExpenses: many(recurringExpenses),
}));

export const incomeDetailRelations = relations(incomeDetail, ({one}) => ({
	chartOfAccount: one(chartOfAccounts, {
		fields: [incomeDetail.accountId],
		references: [chartOfAccounts.id]
	}),
	income: one(income, {
		fields: [incomeDetail.incomeId],
		references: [income.id]
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.userId],
		references: [users.id]
	}),
}));

export const billingCreditBillStatusRelations = relations(billingCreditBillStatus, ({one}) => ({
	bill: one(bills, {
		fields: [billingCreditBillStatus.billId],
		references: [bills.id]
	}),
	patient: one(patients, {
		fields: [billingCreditBillStatus.patientId],
		references: [patients.id]
	}),
	settlement: one(billingSettlements, {
		fields: [billingCreditBillStatus.settlementId],
		references: [billingSettlements.id]
	}),
}));