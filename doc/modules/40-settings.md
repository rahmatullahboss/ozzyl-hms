# Settings Module

## 1. Module Overview

The Settings module is the system-configuration backbone of DanpheEMR. It owns every lookup, master table, RBAC entity, billing tariff, ADT bed/ward layout, employee directory, radiology catalogue, and security role/user/permission that the rest of the application depends on. Every other module (ADT, Billing, Lab, Radiology, Pharmacy, Inventory, Appointment, Patient, etc.) reads from the tables this module manages.

The module is split into two logical layers:

1. **Global / cross-module settings** — owned by `SettingsController`. Master data that every feature needs: Departments, Pharmacy Stores, Integration Names, Country / Sub-Division / Municipality, Reactions, Core CFG Parameters, Print/Export Configuration, Price Categories, Payment Modes / Payment Page settings, Service Department status, ICD-10 groups, OPD service items, and Clinical Intake/Output parameters.
2. **Per-module settings** — owned by module-specific controllers:
   - `ADTSettingsController` — wards, beds, bed features, bed-feature maps, auto-billing items, deposit settings, bed-feature × scheme × price-category map.
   - `BillSettingsController` — service departments, service items, reporting items, billing packages, schemes / sub-schemes, credit organizations, membership types, price-category × service-item maps, scheme × price-category maps, additional service items, deposit heads, printers.
   - `EmployeeSettingsController` — employees, employee roles, employee types, external referrers, employee signatory images.
   - `RadiologySettingsController` — imaging types, imaging items, report templates.
   - `SecuritySettingsController` — RBAC applications, routes, permissions, roles, role-permission maps, users, user-role maps, password reset.
   - `SettingsViewController` — MVC view controller that serves the legacy `SettingsMain`, `UserAdd`, `ApplicationAdd`, `DepartmentsManage`, `RadiologyManage`, `ADTManage`, `EmployeeManage`, `SecurityManage`, `BillingManage`, `GeolocationManage`, `ClinicalManage` cshtml pages with `[DanpheViewFilter(...)]` RBAC checks.

In the .NET / SQL Server reference implementation, every settings table lives inside a domain-specific database (`MasterDbContext`, `BillingDbContext`, `AdmissionDbContext`, `RadiologyDbContext`, `RbacDbContext`, `LabDbContext`, `ClinicalDbContext`, `CoreDbContext`). On the SQL Server side the tables are prefixed by module convention: `MST_*` (master), `CFG_*` (configuration), `MAP_*` (mapping), `TXN_*` (transactional) where applicable. On the Cloudflare-native migration target, the same entities are scoped by `tenant_id` per `AGENTS.md`; this module's DTOs become Zod schemas in `src/schemas/`, and controllers become Hono routes in `src/routes/settings/`.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Department** | A clinical / administrative department. Stored in `MST_Department`. Owns the `ServiceDepartment` rows that map to billable integration names. |
| **Service Department** | A billable sub-unit of a Department. Stored in `MST_ServiceDepartment` (e.g. OPD, Lab, Radiology, Pharmacy, Bed Charges). The `IntegrationName` column is the foreign key bridge to integration-side items. |
| **Integration Name** | String discriminator (e.g. `"OPD"`, `"Lab"`, `"Radiology"`, `"Bed Charges"`, `"Pharmacy"`) that links a `ServiceDepartment` / `BillServiceItem` to its source module. |
| **Bed Feature** | A bed type/class (General, Semi-Private, Deluxe, ICU). Stored in `ADT_MST_BedFeature`; a side-effect of creation is auto-creating a `BIL_MST_BillServiceItem` with `IntegrationName = "Bed Charges"`. |
| **Ward** | A physical ward. Stored in `ADT_MST_Ward`. On create, a permission `ward-<wardname>` is auto-generated under the `"ADT Wards"` RBAC application. |
| **Bed** | A physical bed in a ward. Stored in `ADT_Bed`. Tracks `IsOccupied`, `IsReserved`, `OnHold`, `HoldedOn`. |
| **Bed Feature Map** | Many-to-many between Bed and BedFeature scoped by Ward. Stored in `ADT_MAP_BedFeaturesMap`. |
| **ADT Auto Billing Item** | Per-(bed-feature, scheme) row defining a service item that is auto-added to a patient's bill on admission. Supports both `MinimumChargeAmount` and `PercentageOfBedCharges` billing strategies plus a `IsRepeatable` flag. |
| **ADT Deposit Setting** | Per-(bed-feature, scheme, deposit-head) row defining the minimum deposit required at admission. |
| **Bed Feature × Scheme × Price-Category Map** | Defines which price categories are valid for a (bed-feature, scheme) combination. |
| **Billing Scheme** | Patient-classification configuration (cash, credit, insurance, EHS, SAARC, foreigner, co-payment, discount limits, valid dates, default credit org, default price category). Sub-schemes supported. |
| **Billing Sub-Scheme** | Sub-classification under a scheme (e.g. policy tiers under an Insurance scheme). |
| **Price Category** | Pricing tier (Normal, EHS, SAARC, Foreigner, Insurance, etc.) with a boolean `IsDefault`. The default price category is mandatory for the OPD service-item dropdown. |
| **Scheme × Price-Category Map** | Which price categories are allowed for a scheme. Stored in `BIL_MAP_SchemePriceCategory`. |
| **Service Item × Price-Category Map** | Per-service-item pricing per price category. Stores `Price`, `ItemLegalCode`, `ItemLegalName`, `IsPriceChangeAllowed`, `IsZeroPriceAllowed`, `IsIncentiveApplicable`, `HasAdditionalBillingItems`, `IsDiscountApplicable`. |
| **Service Item** | A billable item owned by a `ServiceDepartment` and tied to a source-module item via `IntegrationName` + `IntegrationItemId`. |
| **Additional Service Item** | A child service item (e.g. pre-anaesthesia, surgical supplies) that can be auto-added with a percentage of the parent item. |
| **Billing Package** | A pre-priced bundle of service items with a global `DiscountPercent` and a `PackageCode`. |
| **Credit Organization** | A billing party (insurer, corporate, government) to which a credit balance can be assigned. |
| **Membership Type** | Historical alias for BillingScheme; returns the same list. |
| **Reporting Item** | A reporting-side billable that may map to one or more billing items. |
| **Dynamic Reporting Name** | A free-form dynamic reporting name. |
| **Printer Setting** | Physical / logical printer configuration (display name, server folder, paper dimensions, model). |
| **Employee** | A staff member (internal or external referrer). `IsExternal=true` flag turns them into a referrer. `SignatoryImageName` holds a file path under `wwwroot/fileuploads/EmployeeSignatures/`. |
| **Employee Role** | RBAC-side role name (e.g. Doctor, Nurse, Lab Technician). |
| **Employee Type** | Internal employment classification (Permanent, Contract, Visiting, etc.). |
| **External Referrer** | An external doctor who can refer patients. Stored in the same `EMP_Employee` table with `IsExternal = true`. |
| **Radiology Imaging Type** | A modality (X-Ray, USG, CT, MRI). |
| **Radiology Imaging Item** | A specific study (X-Ray Chest PA, USG Abdomen, etc.). Linked to a service item and a report template. |
| **Radiology Report Template** | A reusable report template (header, footer, module). |
| **Application** | A top-level RBAC container (e.g. ADT, Billing, Lab, Pharmacy, Radiology). |
| **Permission** | A scoped action within an Application (e.g. `ward-General Ward`). Auto-generated permissions include `ward-<wardname>`. |
| **Role** | A named bundle of permissions within an Application. `IsSysAdmin=true` hides the role from the standard security settings UI. |
| **User** | A login identity. Linked 1:1 to an `Employee`. Passwords are encrypted via `RBAC.EncryptPassword`. `NeedsPasswordUpdate` forces a password change on next login. |
| **Tax** | A tax component (e.g. VAT 13%, Service Charge). |
| **Core CFG Parameter** | A key-value runtime parameter (`ParameterGroupName`, `ParameterName`, `ParameterValue`, `ValueDataType`, `ValueLookUpList`). Used for hospital-wide configuration like auto-billing-items JSON. |
| **Core CFG Lookup** | Lookup-table alternative to CFG Parameters: stores a JSON blob under `LookupDataJson` for an entire module. |
| **Print/Export Configuration** | Per-module print/export UI flags (header, footer, NP date, EN date, filter range, user name). |
| **Payment Mode Setting** | Per-page payment-mode UI configuration: `ShowPaymentDetails`, `IsRemarksMandatory`, `DisplaySequence`, `IsActive`. |
| **Country / Sub-Division / Municipality** | Geographic master data. |
| **Reaction** | Allergy / adverse reaction codes. |
| **Integration Name** | String discriminator that lets service items cross-reference their origin module. |
| **ICD-10 Group / Disease Group** | Hierarchical ICD-10 reporting categorization. |
| **Intake / Output Parameter** | Clinical intake/output type master. |

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `SettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/SettingsController.cs` | Global settings: Departments, Stores, IntegrationNames, Country/Sub/Municipality, Reactions, Core Cfg Parameters, Print/Export Configuration, Price Categories, Payment Mode Settings, Service Department status, ICD-10 groups, Clinical Intake/Output parameters, OPD service items. | 2,269 |
| `SettingsViewController.cs` | `Websites/DanpheEMR/Controllers/Settings/SettingsViewController.cs` | MVC view controller — returns the `SettingsMain`, `UserAdd`, `ApplicationAdd`, `DepartmentsManage`, `RadiologyManage`, `ADTManage`, `EmployeeManage`, `SecurityManage`, `BillingManage`, `GeolocationManage`, `ClinicalManage` cshtml pages. Each action is gated by `[DanpheViewFilter("settings-...-view")]`. | 203 |
| `ADTSettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/ADTSettingsController.cs` | ADT-specific settings: Wards, Beds, BedFeatures, BedFeaturesMap, AutoBillingItems (legacy JSON param + new row-based), BedFeature×Scheme×PriceCategory map, MinimumDepositSettings. Auto-generates a ward-scoped RBAC permission on ward create. | 1,007 |
| `BillSettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/BillSettingsController.cs` | Billing master: ServiceDepartments, ServiceItems, ReportingItems, BillingPackages, Schemes/SubSchemes, CreditOrganizations, Memberships, Price-Category×Service-Item maps, Scheme×Price-Category maps, Additional Service Items, Deposit Heads, Printers. Cascades IsActive changes to integration tables (Lab, Radiology, Bed Charges). | 3,041 |
| `EmployeeSettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/EmployeeSettingsController.cs` | Employee master, roles, types, external referrers, signatory image upload to `wwwroot/fileuploads/EmployeeSignatures/`. | 1,127 |
| `RadiologySettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/RadiologySettingsController.cs` | Radiology imaging types, imaging items, report templates. Cascades IsActive to the corresponding `BIL_MST_BillServiceItem`. | 491 |
| `SecuritySettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/SecuritySettingsController.cs` | RBAC: Applications, Routes, Permissions, Roles, Users, RolePermissionMaps, UserRoleMaps. Password reset. User activation. | 882 |

### 2.2 Controller DTOs (in `Websites/DanpheEMR/Controllers/Settings/DTO/`)

| File | Purpose | Fields |
|------|---------|--------|
| `BedFeatureDTO.cs` | `BedFeature_DTO` for create/update of a bed feature. | `BedFeatureId`, `BedFeatureCode`, `BedFeatureName`, `BedFeatureFullName`, `BedPrice`, `IsActive`. |
| `BillMapPriceCategorySchemeDTO.cs` | Maps a scheme to a price category. | `PriceCategorySchemeMapId`, `SchemeId`, `PriceCategoryId`, `IsDefault`, `IsActive`. |
| `BillMapPriceCategorySchemeDetailsDTO.cs` | Join-augmented view of the same map. | `PriceCategorySchemeMapId`, `SchemeId`, `SchemeName`, `PriceCategoryId`, `PriceCategoryName`, `IsDefault`, `IsActive`. |
| `BillSchemeDTO.cs` | Incoming DTO for a billing scheme. Mirrors the entity's 50+ flag fields (co-payment, discount, credit-limit, scheme-validity, default credit organization, API integration name, etc.). | ~60 fields. |
| `MappingProfile.cs` | AutoMapper profile — `CreateMap<BillSchemeDTO, BillingSchemeModel>()`. | — |
| `PriceCategoryDTO.cs` | DTO for create/update of a price category. | `PriceCategoryId`, `PriceCategoryCode`, `PriceCategoryName`, `Description`, `IsDefault`, `IsActive`, `ShowInRegistration`, `ShowInAdmission`. |

### 2.3 Service-layer DTOs

| File | Path | Purpose |
|------|------|---------|
| `AdtBedFeatureSchemePriceCategory_DTO.cs` | `Websites/DanpheEMR/Services/ADTSettings/DTO/` | POST body for bulk-saving bed-feature × scheme × price-category rows. |
| `AdtGetAutoBillingItems_DTO.cs` | `Websites/DanpheEMR/Services/ADTSettings/DTO/` | Read-side projection of `AdtAutoBillingItemModel` joined with bed feature, scheme, and service item names. |
| `AdtGetBedFeatureSchemePriceCategoryMap_DTO.cs` | `Websites/DanpheEMR/Services/ADTSettings/DTO/` | Read-side projection of the map. |
| `AdtMinimumDepositSetting_DTO.cs` | `Websites/DanpheEMR/Services/ADTSettings/DTO/` | Read-side projection of `AdtDepositSettingsModel`. |
| `AdtSettingDeposit_DTO.cs` | `Websites/DanpheEMR/Services/ADTSettings/DTO/` | Write DTO for create/update of minimum-deposit settings. |
| `AddUpdateAdditionalServiceItem_DTO.cs` | `Websites/DanpheEMR/Services/BillSettings/DTOs/` | Create/update DTO for `BillingAdditionalServiceItemModel`. |
| `AdditionalServiceItems_DTO.cs` | `Websites/DanpheEMR/Services/BillSettings/DTOs/` | Read-side projection of the same entity (with `PriceCategoryName` joined). |
| `DepositHead_DTO.cs` | `Websites/DanpheEMR/Services/BillSettings/DTOs/` | DTO for `BIL_MST_DepositHead`. |
| `PriceCategoryServiceItem_DTO.cs` | `Websites/DanpheEMR/Services/BillSettings/DTOs/` | DTO for `BIL_MAP_PriceCategoryServiceItems`. |
| `ServiceItem_DTO.cs` | `Websites/DanpheEMR/Services/BillSettings/DTOs/` | Comprehensive DTO for `BIL_MST_BillServiceItem` including `BilCfgItemsVsPriceCategoryMap` collection. |
| `OPDServiceItemDTO.cs` | `Websites/DanpheEMR/Services/DepartmentSettings/DTOs/` | Projection used by `GET /api/Settings/OPDServiceItems` (joins service item + service department + default price-category price). |

---

## 3. Data Models

All models use `System.ComponentModel.DataAnnotations` for key/required attributes and `System.ComponentModel.DataAnnotations.Schema` for `[NotMapped]` view properties. Audit fields (`CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`, `IsActive`) are present on every settings entity.

### 3.1 Global settings models (`MasterModels/` and `SystemAdminModels/`)

| Model | File | Key fields |
|-------|------|------------|
| `DepartmentModel` | `MasterModels/DepartmentModel.cs` | `DepartmentId`, `DepartmentCode`, `DepartmentName`, `Description`, `DepartmentHead`, `NoticeText`, `IsActive`, `IsAppointmentApplicable`, `ParentDepartmentId`, `RoomNumber`. `[NotMapped] ServiceItemsList`, `ParentDepartmentName`, `OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`, `FollowupServiceItemId`. |
| `ServiceDepartmentModel` | `MasterModels/ServiceDepartmentModel.cs` | `ServiceDepartmentId`, `ServiceDepartmentName`, `ServiceDepartmentShortName`, `DepartmentId`, `IntegrationName`, `IsActive`, `ParentServiceDepartmentId`. |
| `IntegrationModel` | `MasterModels/ServiceDepartmentIntegrationModel.cs` | `IntegrationName` (PK), `IntegrationNameID`. |
| `CfgParameterModel` | `MasterModels/CfgParameterModel.cs` | `ParameterId`, `ParameterGroupName`, `ParameterName`, `ParameterValue`, `ValueDataType`, `Description`, `ParameterType`, `ValueLookUpList`. |
| `AdminParametersModel` | `SystemAdminModels/SysAdmin_Parameters.cs` | Same shape as `CfgParameterModel`. |
| `CoreCFGLookupModel` | `MasterModels/CoreCFGLookupModel.cs` | `LookUpId`, `ModuleName`, `LookUpName`, `LookupDataJson`, `Description`. |
| `CfgPaymentModesSettings` | `MasterModels/CfgPaymentModesSettings.cs` | `PaymentModeSettingsId`, `PaymentPageId`, `PaymentModeSubCategoryName`, `PaymentModeSubCategoryId`, `IsActive`, `DisplaySequence`, `ShowPaymentDetails`, `IsRemarksMandatory`, `ModifiedOn`, `ModifiedBy`. |
| `PaymentModes` | `MasterModels/PaymentModes.cs` | `PaymentSubCategoryId`, `PaymentSubCategoryName`, `PaymentMode`, `ShowInMultiplePaymentMode`. |
| `PaymentPages` | `MasterModels/PaymentModes.cs` | `PaymentPageId`, `ModuleName`, `PageName`, `Description`. |
| `PrintExportConfigModel` | `MasterModels/PrintExportConfigModel.cs` | `PrintExportSettingsId`, `SettingName`, `PageHeaderText`, `ReportDescription`, `ModuleName`, `ShowHeader/Footer/UserName/PrintExportDateTime/NpDate/EnDate/FilterDateRange/OtherFilterVariables`, audit fields, `IsActive`. |
| `TaxModel` | `MasterModels/TaxModel.cs` | `TaxId`, `TaxName`, `TaxPercentage`, `TaxLabel`, `Description`, audit fields. |
| `CountryModel` | `MasterModels/Country.cs` | `CountryId`, `CountryShortName`, `CountryName`, `ISDCode`, `CountrySubDivisionType`, `IsActive`, audit. |
| `CountrySubDivisionModel` | `MasterModels/CountrySubDivision.cs` | `CountrySubDivisionId`, `CountryId`, `CountrySubDivisionName`, `CountrySubDivisionCode`, `MapAreaCode`, `IsActive`, `IMU_CountrySubDivisonId`, `IMU_ProvinceId`, audit. |
| `MunicipalityModel` | `MasterModels/Municipality.cs` | `MunicipalityId`, `MunicipalityName`, `Type` (e.g. Municipality / VDC / Metropolitan), `CountryId`, `CountrySubDivisionId`, `IsActive`, `IMU_*` lookups, audit. |
| `ReactionModel` | `MasterModels/ReactionModel.cs` | `ReactionId`, `ReactionCode`, `ReactionName`, `IsActive`, audit. |
| `PriceCategoryModel` | `BillingModels/Config/PriceCategoryModel.cs` | `PriceCategoryId`, `PriceCategoryName`, `Description`, `IsDefault`, `IsActive`, `IsPharmacyRateDifferent`, `PriceCategoryCode`, `ShowInRegistration`, `ShowInAdmission`, `DisplaySequence`, audit. |
| `PrinterSettingsModel` | `CommonModels/PrinterSettingsModel.cs` | `PrinterSettingId`, `PrintingType`, `GroupName`, `PrinterDisplayName`, `PrinterName`, `ModelName`, `Width_Lines`, `Height_Lines`, `HeaderGap_Lines`, `FooterGap_Lines`, `mh`, `ml`, `ServerFolderPath`, `Remarks`, `IsActive`, audit. |
| `CookieAuthInfoModel` | `MasterModels/CookieAuthInfoModel.cs` | `AuthId`, `Selector`, `HashedToken`, `UserId`, `Expires`. |
| `EmailSendDetailModel` | `MasterModels/EmailSendDetailModel.cs` | `SendId`, `SendBy`, `SendToEmail`, `EmailSubject`, `SendOn`. |
| `StoreVerificationMapModel` | `MasterModels/StoreVerificationMapModel.cs` | `StoreVerificationMapId`, `StoreId`, `MaxVerificationLevel`, `VerificationLevel`, `PermissionId`, `IsActive`, `[NotMapped] NewRoleName`, `RoleId`. |
| `ICD10CodeModel` | `MasterModels/ICD10Code.cs` | `ICD10ID`, `ICDShortCode`, `ICD10Code`, `ICD10Description`, `ValidForCoding`, `Active`. |
| `ICD10ReportingGroupModel` / `ICD10DiseaseGroupModel` | `MasterModels/ICD10Groups/` | Reporting group + disease group hierarchy. |
| `ExternalReferrerVM` | (used in code) | Lightweight VM (`ExternalReferrerId`, `ReferrerName`, `ContactAddress`, `EmailAddress`, `ContactNumber`, `IsActive`, `TDSPercent`, `IsIncentiveApplicable`, `PANNumber`, `NMCNumber`). |

### 3.2 ADT settings models

| Model | File | Key fields |
|-------|------|------------|
| `WardModel` | `AdmissionModels/WardModel.cs` | `WardId`, `StoreId`, `WardCode`, `WardName`, `WardLocation`, `IsActive`, audit. |
| `BedModel` + `BedDisplayModel` + `BedFeatureModel` | `AdmissionModels/BedModel.cs` | `BedId`, `BedCode`, `BedNumber`, `WardId`, `IsOccupied`, `IsReserved`, `OnHold`, `HoldedOn`, `IsActive`, audit. Display model adds `WardName`, `BedFeature` list. |
| `BedFeature` | `AdmissionModels/BedFeature.cs` | `BedFeatureId`, `BedFeatureCode`, `BedFeatureName`, `BedFeatureFullName`, `BedPrice`, `IsActive`, audit, `[NotMapped] TaxApplicable`, `ServiceDepartmentId`. |
| `BedFeaturesMap` | `AdmissionModels/BedFeaturesMap.cs` | `BedFeatureCFGId`, `BedId`, `WardId`, `BedFeatureId`, `IsActive`, audit. Navigation: `BedFeature`, `Ward`, `Bed`. |
| `AdtAutoBillingItemModel` | `AdmissionModels/Config/AdtAutoBillingItemModel.cs` | `AdtAutoBillingItemId`, `BedFeatureId`, `SchemeId`, `ServiceItemId`, `MinimumChargeAmount`, `PercentageOfBedCharges`, `UsePercentageOfBedCharges`, `IsRepeatable`, `IsActive`, audit. |
| `AdtDepositSettingsModel` | `AdmissionModels/Config/AdtDepositSettingsModel.cs` | `AdtDepositSettingId`, `BedFeatureId`, `SchemeId`, `DepositHeadId`, `MinimumDepositAmount`, `IsOnlyMinimumDeposit`, `IsActive`, audit. |
| `AdtBedFeatureSchemePriceCategoryMapModel` | `AdmissionModels/Config/AdtBedFeatureSchemePriceCategoryMapModel.cs` | `BedFeatureSchemePriceCategoryMapId`, `BedFeatureId`, `SchemeId`, `PriceCategoryId`, `IsActive`, audit. |

### 3.3 Billing settings models (`BillingModels/Config/`)

| Model | Key fields |
|-------|------------|
| `BillingSchemeModel` | `SchemeId`, `SchemeCode`, `SchemeName`, `Description`, `CommunityName`, `ValidFromDate`, `ValidToDate`, `IsMembershipApplicable`, `IsMemberNumberCompulsory`, `DefaultPaymentMode`, `IsCreditApplicable`, `IsCreditOnlyScheme`, `IsOpCreditLimited`, `IsIpCreditLimited`, `IsGeneralCreditLimited`, `GeneralCreditLimit`, `OpCreditLimit`, `IpCreditLimit`, `IsRegistrationCreditApplicable`, `IsOpBillCreditApplicable`, `IsIpBillCreditApplicable`, `IsAdmissionCreditApplicable`, `IsOpPhrmCreditApplicable`, `IsIpPhrmCreditApplicable`, `IsVisitCompulsoryInBilling`, `IsVisitCompulsoryInPharmacy`, `IsBillingCoPayment`, `IsPharmacyCoPayment`, `BillCoPayCashPercent`, `BillCoPayCreditPercent`, `PharmacyCoPayCashPercent`, `PharmacyCoPayCreditPercent`, `IsDiscountApplicable`, `DiscountPercent`, `IsDiscountEditable`, `IsRegDiscountApplicable` (and percent/editable), `IsOpBillDiscountApplicable` (and percent/editable), `IsIpBillDiscountApplicable` (and percent/editable), `IsAdmissionDiscountApplicable` (and percent/editable), `IsOpPhrmDiscountApplicable` (and percent/editable), `IsIpPhrmDiscountApplicable` (and percent/editable), `DefaultCreditOrganizationId`, `DefaultPriceCategoryId`, `ApiIntegrationName`, `FieldSettingParamName`, `IsSystemDefault`, `RegStickerGroupCode`, `HasSubScheme`, `AllowProvisionalBilling`, audit, `[NotMapped] BillingSubSchemes`, `IsCopaymentApplicable`. |
| `BillingSubSchemeModel` | `SubSchemeId`, `SchemeId`, `SubSchemeName`, `DefaultCreditOrganizationId`, audit, `IsActive`. |
| `BillServiceItemModel` | `ServiceItemId`, `ServiceDepartmentId`, `IntegrationItemId`, `IntegrationName`, `ItemCode`, `ItemName`, `IsTaxApplicable`, `Description`, `DisplaySeq`, `IsDoctorMandatory`, `IsOT`, `IsProc`, `ServiceCategoryId`, `AllowMultipleQty`, `DefaultDoctorList`, `IsValidForReporting`, `IsErLabApplicable`, audit, `IsActive`, `IsIncentiveApplicable`. |
| `BillServiceItemSchemeSettingModel` | `ServiceItemSchemeSettingId`, `SchemeId`, `ServiceItemId`, `RegDiscountPercent`, `OpBillDiscountPercent`, `IpBillDiscountPercent`, `AdmissionDiscountPercent`, `IsCoPayment`, `CoPaymentCashPercent`, `CoPaymentCreditPercent`, audit, `IsActive`. |
| `BillMapPriceCategorySchemeModel` | `PriceCategorySchemeMapId`, `SchemeId`, `PriceCategoryId`, `IsDefault`, `IsActive`, audit. |
| `BillMapPriceCategoryServiceItemModel` | `PriceCategoryServiceItemMapId`, `PriceCategoryId`, `ServiceItemId`, `ServiceDepartmentId`, `Price`, `IsDiscountApplicable`, `ItemLegalCode`, `ItemLegalName`, `Discount`, `IsCoPayment`, `CoPaymentCashPercent`, `CoPaymentCreditPercent`, `IsPriceChangeAllowed`, `IsZeroPriceAllowed`, `IsIncentiveApplicable`, `HasAdditionalBillingItems`, `ItemId`, audit, `IsActive`. |
| `BillingAdditionalServiceItemModel` | `AdditionalServiceItemId`, `GroupName`, `ServiceItemId`, `PriceCategoryId`, `ItemName`, `UseItemSelfPrice`, `PercentageOfParentItemForSameDept`, `PercentageOfParentItemForDiffDept`, `MinimumChargeAmount`, `IsPreAnaesthesia`, `WithPreAnaesthesia`, `IsOpServiceItem`, `IsIpServiceItem`, `HasChildServiceItems`, `IsActive`, audit, `Remarks`. |
| `BillingPackageModel` | `BillingPackageId`, `BillingPackageName`, `Description`, `TotalPrice`, `DiscountPercent`, `PackageCode`, `IsActive`, `LabTypeName`, `SchemeId`, `PriceCategoryId`, `BillingItemsXML`, `IsEditable`. |
| `BillingPackageServiceItemModel` | `PackageServiceItemId`, `BillingPackageId`, `ServiceItemId`, `DiscountPercent`, `Quantity`, `PerformerId`, `IsActive`, audit. |
| `BillingCounter` | Counter for sequential billing numbers. |
| `BillingFiscalYear` | Fiscal year list used to scope transactions. |
| `CreditOrganizationModel` | `OrganizationId`, `OrganizationName`, `IsActive`, audit. |
| `CurrencyModel` | `CurrencyId`, `CurrencyCode`, `CurrencyName`. |
| `BillServiceCategoryModel` | `ServiceCategoryId`, `ServiceCategoryName`, `ServiceCategoryCode` (e.g. `BEDCH`), `IsActive`. |
| `BanksModel` | `BankId`, `BankName`, `BankShortName`, `Description`, `IsActive`, audit. |
| `DepositHeadModel` | `DepositHeadId`, `DepositHeadCode`, `DepositHeadName`, `IsDefault`, `Description`, `IsActive`. |

### 3.4 Employee settings models (`EmployeeModels/`)

| Model | Key fields |
|-------|------------|
| `EmployeeModel` | `EmployeeId`, `FirstName`, `MiddleName`, `LastName`, `FullName`, `DateOfBirth`, `DateOfJoining`, `ContactNumber`, `Email`, `ContactAddress`, `IsActive`, `Salutation`, `DepartmentId`, `EmployeeRoleId`, `EmployeeTypeId`, `Gender`, `Extension`, `SpeedDial`, `OfficeHour`, `RoomNo`, `MedCertificationNo`, `Signature`, `LongSignature`, `IsAppointmentApplicable`, `LabSignature`, `RadiologySignature`, `BloodGroup`, `DriverLicenseNo`, `NursingCertificationNo`, `HealthProfessionalCertificationNo`, `DisplaySequence`, `SignatoryImageName`, `IsExternal`, `TDSPercent`, `IsIncentiveApplicable`, `PANNumber`, `OpdNewPatientServiceItemId`, `FollowupServiceItemId`, `OpdOldPatientServiceItemId`, `InternalReferralServiceItemId`, `[NotMapped] SignatoryImageBase64`, `ServiceItemsList`, `LedgerId`, `LedgerType`. |
| `EmployeeRoleModel` | `EmployeeRoleId`, `EmployeeRoleName`, `Description`, `IsActive`, audit. |
| `EmployeeTypeModel` | `EmployeeTypeId`, `EmployeeTypeName`, `Description`, `IsActive`, audit. |
| `EmployeePreferences` | Per-employee preferences (lab favorites, imaging favorites). |
| `EmployeeProfileVM` | View-model used by profile pages. |

### 3.5 Radiology settings models

| Model | File | Key fields |
|-------|------|------------|
| `RadiologyImagingItemModel` | `MasterModels/RadiologyImagingItemModel.cs` | `ImagingItemId`, `ImagingTypeId`, `ImagingItemName`, `ProcedureCode`, `IsValidForReporting`, `TemplateId`, `IsActive`, audit. |
| `RadiologyImagingTypeModel` | `MasterModels/RadiologyImagingTypeModel.cs` | `ImagingTypeId`, `ImagingTypeName`, `ProcedureCoding`, `IsActive`, audit, nav `ImagingItems`. |
| `RadiologyReportTemplateModel` | (in `RadiologyModels`) | `TemplateId`, `ModuleName`, `TemplateCode`, `TemplateName`, `FooterNote`, `IsActive`, audit. |

### 3.6 Security / RBAC models

| Model | File | Key fields |
|-------|------|------------|
| `RbacUser` | `Security/RbacUser.cs` | `UserId`, `EmployeeId`, `UserName`, `Email`, `Password` (encrypted), `IsActive`, `NeedsPasswordUpdate`, audit, `ModifiedBy`, `ModifiedOn`. |
| `RbacRole` | `Security/RbacRole.cs` | `RoleId`, `RoleName`, `RolePriority`, `RoleDescription`, `RoleType`, `ApplicationId`, `DefaultRouteId`, `IsSysAdmin`, audit. |
| `RolePermissionMap` | `Security/RolePermissionMap.cs` | `RolePermissionMapId`, `RoleId`, `PermissionId`, `IsActive`, audit. |
| `UserRoleMap` | `Security/UserRoleMap.cs` | `UserRoleMapId`, `UserId`, `RoleId`, `IsActive`, audit. |
| `RbacPermission` | `Security/RbacPermission.cs` | `PermissionId`, `PermissionName`, `ApplicationId`, `IsActive`, audit. |
| `RbacApplication` | `Security/RbacApplication.cs` | `ApplicationId`, `ApplicationName`, `ApplicationCode`, `Description`, `IsActive`, audit. |
| `RbacRoute` | `Security/DanpheRoute.cs` | `RouteId`, `DisplayName`, `UrlFullPath`, `IsActive`. |
| `PHRMStoreModel` | (under `RbacDbContext`) | `StoreId`, `Name`, `Category`, `PermissionId`, `MaxVerificationLevel`, `StoreVerificationMapList`, `IsActive`. |

### 3.7 Clinical settings models

| Model | File | Key fields |
|-------|------|------------|
| `ClinicalIntakeOutputParameterModel` | `ClinicalModels/ClinicalIntakeOutputParameterModel.cs` | `IntakeOutputId`, `ParameterType`, `ParameterValue`, `ParameterMainId` (parent id; `-1` for top-level), `IsActive`, audit. |

---

## 4. Database Tables

In the SQL Server reference, tables use module prefixes (`MST_*`, `CFG_*`, `MAP_*`, `BIL_*`, `ADT_*`, `RBAC_*`, `RAD_*`, `EMP_*`, `PHRM_*`, `LAB_*`, `CLN_*`). The Cloudflare-native target uses D1 / SQLite where these names map 1:1 to D1 tables with an added `tenant_id` column per `AGENTS.md`.

| Prefix | Table | Source / Purpose |
|--------|-------|------------------|
| **Global** | | |
| `MST_Department` | `DepartmentModel` | Departments (clinical + admin). |
| `MST_ServiceDepartment` | `ServiceDepartmentModel` | Billable sub-units. |
| `MST_IntegrationName` | `IntegrationModel` | Integration-name discriminator list. |
| `MST_Store` (or `PHRM_MST_Store`) | `PHRMStoreModel` | Pharmacy + sub-stores. |
| `MST_Banks` | `BanksModel` | Bank master. |
| `MST_Country` | `CountryModel` | Country list. |
| `MST_CountrySubDivision` | `CountrySubDivisionModel` | State / Province. |
| `MST_Municipality` | `MunicipalityModel` | City / VDC. |
| `MST_Reaction` | `ReactionModel` | Allergy / reaction codes. |
| `MST_PriceCategory` | `PriceCategoryModel` | Pricing tiers. |
| `CFG_Parameters` | `CfgParameterModel` | Key-value runtime config. |
| `CFG_PaymentModesSettings` | `CfgPaymentModesSettings` | Per-page payment-mode UI flags. |
| `MST_PaymentModes` | `PaymentModes` | Master payment modes. |
| `CFG_PaymentPages` | `PaymentPages` | Payment-page registry. |
| `CFG_PrintExportConfiguration` | `PrintExportConfigModel` | Per-module print/export UI config. |
| `CFG_Printer` | `PrinterSettingsModel` | Physical / logical printer config. |
| `MST_Tax` | `TaxModel` | Tax master. |
| `CFG_CoreCFGLookup` | `CoreCFGLookupModel` | Module-level JSON lookup. |
| `RBAC_AuthCookie` | `CookieAuthInfoModel` | Remember-me cookie. |
| `MST_EmailSendDetails` | `EmailSendDetailModel` | Outbound email log. |
| `MST_StoreVerificationMap` | `StoreVerificationMapModel` | Store × verifier × permission map. |
| `MST_ICD10` | `ICD10CodeModel` | ICD-10 codes. |
| `MST_ICD10ReportingGroups` / `MST_ICD10DiseaseGroups` | `ICD10ReportingGroupModel` / `ICD10DiseaseGroupModel` | ICD-10 hierarchy. |
| `MST_ClinicalIntakeOutputParameter` | `ClinicalIntakeOutputParameterModel` | Intake/Output parameter master. |
| **ADT** | | |
| `ADT_MST_Ward` | `WardModel` | Wards. |
| `ADT_Bed` | `BedModel` | Beds. |
| `ADT_MST_BedFeature` | `BedFeature` | Bed type/class. |
| `ADT_MAP_BedFeaturesMap` | `BedFeaturesMap` | Bed × BedFeature scoped by Ward. |
| `ADT_CFG_AutoBillingItem` | `AdtAutoBillingItemModel` | Auto-bill rules. |
| `ADT_CFG_DepositSettings` | `AdtDepositSettingsModel` | Minimum-deposit rules. |
| `ADT_MAP_BedFeatureSchemePriceCategory` | `AdtBedFeatureSchemePriceCategoryMapModel` | BedFeature × Scheme × PriceCategory map. |
| **Billing** | | |
| `BIL_MST_Scheme` | `BillingSchemeModel` | Billing schemes. |
| `BIL_MST_SubScheme` | `BillingSubSchemeModel` | Sub-schemes. |
| `BIL_MST_ServiceItem` | `BillServiceItemModel` | Service items. |
| `BIL_MST_ServiceItemSchemeSetting` | `BillServiceItemSchemeSettingModel` | Per-scheme × service-item overrides. |
| `BIL_MAP_PriceCategoryScheme` | `BillMapPriceCategorySchemeModel` | Scheme × PriceCategory. |
| `BIL_MAP_PriceCategoryServiceItems` | `BillMapPriceCategoryServiceItemModel` | ServiceItem × PriceCategory pricing. |
| `BIL_CFG_AdditionalServiceItem` | `BillingAdditionalServiceItemModel` | Child service items (pre-anaesthesia etc.). |
| `BIL_CFG_Package` | `BillingPackageModel` | Billing packages. |
| `BIL_CFG_PackageServiceItem` | `BillingPackageServiceItemModel` | Package × service-item composition. |
| `BIL_CFG_Counter` | `BillingCounter` | Sequential billing numbers. |
| `BIL_CFG_FiscalYear` | `BillingFiscalYear` | Fiscal years. |
| `BIL_MST_CreditOrganization` | `CreditOrganizationModel` | Credit parties. |
| `BIL_MST_Currency` | `CurrencyModel` | Currencies. |
| `BIL_CFG_ServiceCategory` | `BillServiceCategoryModel` | Service categories (e.g. BEDCH). |
| `BIL_MST_DepositHead` | `DepositHeadModel` | Deposit-head master. |
| `BIL_MST_ReportingItems` | `ReportingItemsModels` | Reporting-side items. |
| `BIL_MST_DynamicReportName` | `DynamicReportNameModels` | Dynamic report names. |
| `BIL_MAP_ReportingItemsBillItem` | `ReportingItemsBillItemMapping` | Reporting × billing map. |
| `BIL_MST_Banks` | `BanksModel` (also in MST_) | Bank master. |
| `BIL_CFG_Printer` | `PrinterSettingsModel` | Printer settings. |
| **Employee** | | |
| `EMP_Employee` | `EmployeeModel` | Employees. |
| `EMP_EmployeeRole` | `EmployeeRoleModel` | Roles. |
| `EMP_EmployeeType` | `EmployeeTypeModel` | Types. |
| `EMP_EmployeePreferences` | `EmployeePreferences` | Per-employee preferences. |
| **Radiology** | | |
| `RAD_MST_ImagingType` | `RadiologyImagingTypeModel` | Imaging types. |
| `RAD_MST_ImagingItem` | `RadiologyImagingItemModel` | Imaging items. |
| `RAD_CFG_ReportTemplate` | `RadiologyReportTemplateModel` | Report templates. |
| **Security / RBAC** | | |
| `RBAC_Application` | `RbacApplication` | Top-level app. |
| `RBAC_Permission` | `RbacPermission` | Scoped permission. |
| `RBAC_Role` | `RbacRole` | Role. |
| `RBAC_RolePermissionMap` | `RolePermissionMap` | Role × permission. |
| `RBAC_User` | `RbacUser` | Login identity. |
| `RBAC_UserRoleMap` | `UserRoleMap` | User × role. |
| `RBAC_Route` | `RbacRoute` | Frontend routes. |
| `RBAC_Store` | `PHRMStoreModel` | Stores (under RBAC for permission scoping). |
| **Pharmacy** | | |
| `PHRM_MST_Store` | `PHRMStoreModel` | Pharmacy main + sub-stores. |
| `PHRM_MST_CreditOrganization` | `CreditOrganizationModel` | Pharmacy credit orgs. |

---

## 5. Key Workflows

### 5.1 Onboarding a new tenant / hospital

1. **Run the schema seed scripts** to create the master rows (Country, Currency, Tax, Default Price Category, Default Scheme, Default Roles, Default Permissions, Default Service Departments).
2. **`POST /api/Settings/Country`** (and sub-divisions / municipalities) — populate geography.
3. **`POST /api/Settings/Department`** — add clinical departments; this also creates the matching `BIL_MST_ServiceDepartment` rows (e.g. OPD, ER, Lab, Radiology, OT).
4. **`POST /api/Settings/PharmacyStore`** — set up the main pharmacy and any substores; each store gets a `ward-<storename>` RBAC permission and a `StoreVerificationMap` for verifiers.
5. **`POST /api/Settings/PriceCategory`** — add pricing tiers (Normal default, EHS, SAARC, Foreigner, Insurance, etc.).
6. **`POST /api/Settings/BillScheme`** (route `BillScheme`) — configure the cash / credit / insurance schemes; with `HasSubScheme=true` the request body also carries `BillingSubSchemes[]`.
7. **`POST /api/Settings/SchemePriceCategoryMap`** — link schemes to their allowed price categories.
8. **`POST /api/Settings/BillServiceItemsPriceCategoryMap`** — set up service-item × price-category price rows.
9. **`POST /api/Settings/Role` + `POST /api/Settings/RolePermissions?roleId=…`** — create roles and bind permissions.
10. **`POST /api/Settings/User` + `POST /api/Settings/UserRoles`** — create users and bind roles. The first user is the sysadmin and gets the `IsSysAdmin` role.
11. **CF Parameters** — `POST /api/Settings/CoreCfgParameter` (or seed) to set `ParameterGroupName="ADT", ParameterName="AutoAddBillingItems"` with a JSON value, hospital name, address, signature location, etc.

### 5.2 Configuring a bed feature (which auto-creates a billable service item)

`POST /api/Settings/BedFeature` with a `BedFeature_DTO`:

1. Insert row in `ADT_MST_BedFeature` with `CreatedBy`, `CreatedOn`.
2. Look up `ServiceDepartment` where `IntegrationName == "Bed Charges"` (in `CoreDbContext`).
3. Insert a `BIL_MST_BillServiceItem` row with `IntegrationItemId = bedFeature.BedFeatureId`, `IntegrationName = "Bed Charges"`, `ServiceDepartmentId = departmentModel.ServiceDepartmentId`, `IsDoctorMandatory=false`, `IsOT=false`, `IsProc=false`, `IsValidForReporting=false`, `IsErLabApplicable=false`, `IsIncentiveApplicable=false`.
4. Both inserts are wrapped in a `Database.BeginTransaction()` and commit/rollback together.

`PUT /api/Settings/BedFeatures` updates both rows' `IsActive` and `Modified*` fields.

### 5.3 Ward creation (which auto-creates an RBAC permission)

`POST /api/Settings/Ward` with a `WardModel`:

1. Validate uniqueness (`CheckForWardDuplicate` looks at `WardName` and `WardCode`).
2. Insert the `ADT_MST_Ward` row.
3. Look up the RBAC `Application` with `ApplicationName="ADT Wards"` and `ApplicationCode="ADTWARD"`.
4. Create a new `RBAC_Permission` named `ward-<wardname>` under that application.
5. Wrap in `Database.BeginTransaction()` and commit/rollback together.
6. On `PUT /api/Settings/Ward`, if `WardName` changed, the matching `ward-<oldname>` permission is renamed to `ward-<newname>`.

### 5.4 Cascading IsActive changes (Lab / Radiology / Bed Charges)

`BillSettingsController` and `RadiologySettingsController` both implement the rule: turning a `BIL_MST_BillServiceItem` off must turn off the source row too. The `UpdateDepartmentItems` helper in `BillSettingsController` checks the service item's `IntegrationName`:

- `IntegrationName == "lab"` → flip `LAB_MST_LabTest.IsActive`.
- `IntegrationName == "radiology"` → flip `RAD_MST_ImagingItem.IsActive`.
- `IntegrationName == "bed charges"` → flip `ADT_MST_BedFeature.IsActive`.

This avoids the situation where a billing item is active but its clinical source is inactive (or vice versa).

`RadiologySettingsController.UpdateImagingItem` does the same on the radiology side: it updates `RAD_MST_ImagingItem`, finds the matching `BIL_MST_BillServiceItem` via `IntegrationItemId + ServiceDepartmentId`, and propagates the `IsActive` flag.

### 5.5 ADT deposit + auto-billing configuration

1. **Auto Billing Items** — `POST /api/Settings/AdtAutoBillingItem` (or legacy `POST /api/Settings/AutoBillingItem` storing a JSON blob in `CFG_Parameters`).
2. **Bed Feature × Scheme × Price-Category Map** — `POST /api/Settings/BedFeatureSchemePriceCategoryMap` with a list body, or `PUT /api/Settings/BedFeatureSchemePriceCategoryMap` to update.
3. **Minimum Deposit Setting** — `POST /api/Settings/MinimumDepositSetting` with `BedFeatureId`, `SchemeId`, `DepositHeadId`, `MinimumDepositAmount`, `IsOnlyMinimumDeposit`. The system enforces transaction commit/rollback and the `BedFeature` and `Scheme` must already exist.
4. The admission flow reads these to know what to auto-bill and what to collect on admission.

### 5.6 Security: assigning a role's permissions

`POST /api/Settings/RolePermissions?roleId=N` with a list of `RolePermissionMap`:

1. **Step 1** — delete all existing rows for that role.
2. **Step 2** — insert the new rows.
3. Returns the number of rows written.

`PUT /api/Settings/RolePermissions` is the update path (each row is marked Modified individually, `CreatedOn`/`CreatedBy` left untouched).

`POST /api/Settings/UserRoles` adds user-role links; `PUT /api/Settings/UserRoles` updates them.

Password reset: `PUT /api/Settings/ResetPassword` only marks `Password`, `ModifiedBy`, `ModifiedOn`, `NeedsPasswordUpdate` as modified — never the username or email.

---

## 6. API Endpoints

All routes are relative to `/api/Settings/`. Route conventions: PascalCase noun paths, `[HttpGet]` / `[HttpPost]` / `[HttpPut]` per action, mostly `[Route("...")]` attribute, JSON body for writes. The base class is `CommonController`, which exposes `InvokeHttpGetFunction`, `InvokeHttpPostFunction`, `InvokeHttpPutFunction`, `this.ReadPostData()`, and pulls the connection string from `MyConfiguration`. The current user is fetched from `HttpContext.Session.Get<RbacUser>("currentuser")` for audit fields.

### 6.1 Global settings (`SettingsController.cs`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/Settings/Departments` | GET | All departments ordered by name. |
| `/api/Settings/PharmacyStores` | GET | Stores where `Category == Substore`. |
| `/api/Settings/IntegrationNames` | GET | Integration names list. |
| `/api/Settings/Countries` | GET | All countries. |
| `/api/Settings/CountrySubDivisions` | GET | All subdivisions. |
| `/api/Settings/Municipalities` | GET | Joined: `MunicipalityName, MunicipalityId, CountryId, CountryName, CountrySubDivisionId, CountrySubDivisionName, Type, IsActive`. |
| `/api/Settings/Reactions` | GET | All reactions. |
| `/api/Settings/CoreCfgParameter` | GET | All `CfgParameterModel` rows. |
| `/api/Settings/PrintExportConfiguration` | GET | All `PrintExportConfigModel` rows. |
| `/api/Settings/OPDServiceItems` | GET | Active OPD service items joined to the **default** `PriceCategory` price. Throws if no default price category exists. |
| `/api/Settings/IntakeOutputType` | GET | Clinical intake/output parameters. |
| `/api/Settings/IntakeOutputTypeForGrid` | GET | Same via `SP_CLN_GetIntakeOutputParameters`. |
| `/api/Settings/PostIntakeOutputVariable` | POST | Create an intake/output variable. |
| `/api/Settings/activate-deactivate-intakeoutput-variables` | PUT | Toggle `IsActive`. |
| `/api/Settings/UpdateIntakeOutputVariable` | PUT | Update name / value / parent. |
| `/api/Settings/GetICD10Groups` | GET | `ReportingGroupId`, `ReportingGroup_SN`, `ReportingGroupName`, `DiseaseGroup_SN`, `DiseaseGroup_ICD`, `DiseaseGroupName`. |
| `/api/Settings/GetStoreVerifiers/{StoreId}` | GET | Store verifier map augmented with `NewRoleName` and `RoleId`. |
| `/api/Settings/BillingCreditOrganization` | GET | Active billing credit orgs. |
| `/api/Settings/PharmacyCreditOrganization` | GET | Active pharmacy credit orgs. |
| `/api/Settings/PriceCategories` | GET | Active price categories with `ShowInRegistration` and `ShowInAdmission` flags. |
| `/api/Settings/GetPaymentModes` | GET | All payment modes. |
| `/api/Settings/GetPaymentModeSettings` | GET | All per-page payment-mode settings. |
| `/api/Settings/UpdatePaymentModeSettings` | PUT | Batch update per-page payment-mode settings. |
| `/api/Settings/UpdateServiceDepartmentStatus` | PUT | Activate / deactivate a service department. |
| `/api/Settings/Department` | POST / PUT | Create / update department. |
| `/api/Settings/PharmacyStore` | POST / PUT | Create / update pharmacy store. |
| `/api/Settings/Country` | POST / PUT | Create / update country. |
| `/api/Settings/CountrySubDivision` | POST / PUT | Create / update subdivision. |
| `/api/Settings/Municipality` | POST | Create or update (checks `MunicipalityId>0`). |
| `/api/Settings/Reaction` | POST / PUT | Create / update reaction. Throws on duplicate `ReactionName` / `ReactionCode`. |
| `/api/Settings/LabTest` | POST | Create a lab test (auto-assigns `LabTestCode = "L-NNNNNN"` and `ProcedureCode = "LAB-NNNNNN"`). |
| `/api/Settings/Bank` | POST / PUT | Create / update bank. |
| `/api/Settings/PrintExportConfiguration` | POST / PUT | Create / update print-export config. |
| `/api/Settings/PriceCategory` | POST | Create a new price category. |
| `/api/Settings/PriceCategory` | PUT | Update a price category. |
| `/api/Settings/PriceCategoryActivation` | PUT | Activate / deactivate a price category. |
| `/api/Settings/StoreActivation` | PUT | Activate / deactivate a store + cascade permissions. |
| `/api/Settings/MunicipalityStatus` | PUT | Toggle a municipality's `IsActive`. |
| `/api/Settings/NursingWardSupplyMap` | GET / POST / PUT | Ward × supply-store map. |
| `/api/Settings/NursingWardSupplyMapByWardId` | GET | Same filtered by ward. |

### 6.2 ADT settings (`ADTSettingsController.cs`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/Settings/AutoBillingItems` | GET | Returns the JSON `AutoAddBillingItems` parameter for the ADT module from `CFG_Parameters`. |
| `/api/Settings/AdtAutoBillingItems` | GET | Row-based list of `AdtAutoBillingItemModel` joined with bed feature, scheme, service item. |
| `/api/Settings/Beds` | GET | Beds with their `BedFeature` list. |
| `/api/Settings/BedFeatures` | GET | Active bed features where the linked `ServiceDepartment.IntegrationName == "bed charges"`. |
| `/api/Settings/BedFeaturesMap?bedId=N` | GET | Bed × feature map for one bed. |
| `/api/Settings/Wards` | GET | All wards. |
| `/api/Settings/BedFeatureSchemePriceCataegoryMap` | GET | All bed-feature × scheme × price-category rows. |
| `/api/Settings/MinimumDepositSettings` | GET | All ADT deposit settings. |
| `/api/Settings/Bed` | POST / PUT | Create / update a bed. PUT cascades to `BedFeaturesMap` to update the ward. |
| `/api/Settings/BedFeaturesMap` | POST / PUT | Create / update the bed-feature map. |
| `/api/Settings/Ward` | POST / PUT | Create / update ward. POST auto-creates `ward-<wardname>` permission. PUT renames the permission on rename. |
| `/api/Settings/AutoBillingItem` | POST / PUT | Legacy JSON-blob create / update of the ADT auto-billing parameter. |
| `/api/Settings/AdtAutoBillingItem` | POST / PUT | Row-based create / update of an auto-billing item. |
| `/api/Settings/BedFeature` | POST | Create a bed feature (auto-creates the matching `BIL_MST_BillServiceItem`). |
| `/api/Settings/BedFeatures` | PUT | Update a bed feature (cascades `IsActive` to the bill item). |
| `/api/Settings/BedFeatureSchemePriceCategoryMap` | POST | Bulk-save the bed-feature × scheme × price-category map. |
| `/api/Settings/BedFeatureSchemePriceCategoryMap` | PUT | Update an existing map row. |
| `/api/Settings/ActivateDeactivateBedFeatureSchemePriceCategoryMap?BedFeatureSchemePricecategoryMapId=N` | PUT | Toggle a map row's `IsActive`. |
| `/api/Settings/MinimumDepositSetting` | POST / PUT | Create / update a deposit setting. |
| `/api/Settings/ActivateDeactivateMinimumDepositSetting?AdtDepositSettingId=N` | PUT | Toggle a deposit setting's `IsActive`. |
| `/api/Settings/ActivateDeactivateAutoBillingItem?AdtAutoBillingItemId=N&IsActive=...` | PUT | Toggle an auto-billing item's `IsActive`. |

### 6.3 Billing settings (`BillSettingsController.cs`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/Settings/ServiceDepartments` | GET | All service departments joined to department, with `IntegrationName`, `IsActive`, `ParentServiceDepartmentId`. |
| `/api/Settings/BillingItemList?showInactiveItems=true/false` | GET | Legacy `BIL_MST_BillItemPrice` list filtered to `PriceCategoryId == 1` (default). |
| `/api/Settings/ServiceItemList` | GET | New `BIL_MST_BillServiceItem` list (joined to service department, `ServiceCategoryName` empty). |
| `/api/Settings/ServiceCategories` | GET | Active service categories. |
| `/api/Settings/ReportingItemsList` | GET | All `ReportingItemsModels`. |
| `/api/Settings/DynamicReportingNameList` | GET | All `DynamicReportNameModels`. |
| `/api/Settings/BillItemPriceChangeHistory?serviceDeptId=N&itemId=N` | GET | Union of `BillItemPriceHistory` and current `BIL_MST_BillItemPrice` rows; joined to `RBAC_User` for `UserName`. |
| `/api/Settings/BillingPackageList` | GET | All billing packages joined to price category. |
| `/api/Settings/BillingPackageServiceItemList?BillingPackageId=N&PriceCategoryId=N` | GET | Package items with `Price` and `PerformerName`. |
| `/api/Settings/MembershipTypes` | GET | All billing schemes (alias for membership types). |
| `/api/Billing/BillingSchemes` | GET | All schemes with sub-schemes. |
| `/api/Billing/BillingSubSchemesBySchemeId?SchemeId=N` | GET | Sub-schemes under a scheme. |
| `/api/Billing/BillingScheme?SchemeId=N` | GET | One scheme with sub-schemes. |
| `/api/Settings/SchemesForBillingReport` | GET | Active schemes (`Id` + `Name`) for billing reports. |
| `/api/Settings/CreditOrganizations` | GET | All credit organizations. |
| `/api/Settings/BillingItems?itemId=N&servDeptName=…` | GET | One billing item with `Price` from default price category. |
| `/api/Settings/AdditionalServiceItems` | GET | Additional service items joined to price category. |
| `/api/Settings/BillingItemsByIntegrationName?itemId=N&integrationName=…` | GET | One billing item by integration name + item id. |
| `/api/Settings/BillItemsByServiceDepartmentName?servDeptName=…` | GET | All billing items for a service department. |
| `/api/Settings/BillItemsByIntegrationName?integrationName=…` | GET | All billing items for an integration name. |
| `/api/Settings/PrinterSettings` | GET | Active printer settings. |
| `/api/Settings/AllPrinterSettings` | GET | All printer settings. |
| `/api/Settings/BillingToReportingItemMapping?reportingItemsId=N` | GET | Reporting × billing map for a reporting item. |
| `/api/Settings/BilCfgItemsVsPriceCategory?BillItemPriceId=N` | GET | All price-category maps for a bill item. |
| `/api/Settings/ServiceItemsVsPriceCategory?ServiceItemId=N` | GET | Same on the new schema. |
| `/api/Settings/SchemePriceCategoryMappedItems` | GET | All scheme × price-category map rows. |
| `/api/Settings/DepositHeads` | GET | All deposit heads. |
| `/api/Settings/ServiceDepartment` | POST / PUT | Create / update a service department. |
| `/api/Settings/BillingItem` | POST / PUT | Legacy create / update on `BIL_MST_BillItemPrice`. |
| `/api/Settings/ServiceItem` | POST / PUT | New `BIL_MST_BillServiceItem` create / update (cascades `IsActive` to integration tables via `UpdateDepartmentItems`). |
| `/api/Settings/ActivateDeactivateServiceItem` | PUT | Toggle a service item's `IsActive`. |
| `/api/Settings/ReportingItem` | POST / PUT | Create / update reporting item. |
| `/api/Settings/BillingToReportingItemMapping` | POST | Create a reporting × billing map. |
| `/api/Settings/BillingAndReportingItemMapping` | PUT | Update a reporting × billing map. |
| `/api/Settings/BillingPackage` | POST / PUT | Create / update a billing package. |
| `/api/Settings/ActivateDeactivateBillingPackage?BillingPackageId=N` | PUT | Toggle a billing package's `IsActive`. |
| `/api/Settings/CreditOrganization` | POST / PUT | Create / update a credit organization. |
| `/api/Settings/MembershipType` | POST / PUT | Create / update a membership type. |
| `/api/Settings/BillScheme` | POST / PUT | Create / update a billing scheme; PUT also handles sub-scheme inserts/updates inside a transaction. |
| `/api/Settings/BillSchemeActivation?SchemeId=N&IsActive=…` | PUT | Toggle a scheme's `IsActive`. |
| `/api/Settings/SchemePriceCategoryMap` | POST / PUT | Bulk save / update scheme × price-category map. |
| `/api/Settings/ActivateDeactivateSchemePriceCategoryMapItem?PriceCategorySchemeMapId=N&Status=…` | PUT | Toggle a map row's `IsActive`. |
| `/api/Settings/ActivateDeactivateSubScheme?SubSchemeId=N` | PUT | Toggle a sub-scheme's `IsActive`. |
| `/api/Settings/MembershipType` | POST / PUT | Same as above. |
| `/api/Settings/PrinterSetting` | POST / PUT | Create / update a printer setting. |
| `/api/Settings/BillItemsPriceCategoryMap` | POST / PUT | Legacy create / update of price-category map. |
| `/api/Settings/BillServiceItemsPriceCategoryMap` | POST / PUT | New create / update of price-category × service-item map. |
| `/api/Settings/AdditionalServiceItem` | POST / PUT | Create / update an additional service item. |
| `/api/Settings/ActivateDeactivateAdditionalServiceItem?additionalServiceItemId=N&isActive=…` | PUT | Toggle an additional service item's `IsActive`. |
| `/api/Settings/DepositHead` | POST / PUT | Create / update a deposit head. |
| `/api/Settings/ActivateDeactivateDepositHead?depositHeadId=N` | PUT | Toggle a deposit head's `IsActive`. |

### 6.4 Employee settings (`EmployeeSettingsController.cs`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/Settings/Employees` | GET | All non-external employees with department / role / type names, signatures, certification numbers, OPD service-item ids, `IsAppointmentApplicable`, `IsIncentiveApplicable`, `TDSPercent`, `PANNumber`, `BloodGroup`. |
| `/api/Settings/EmployeeRoles` | GET | All employee roles. |
| `/api/Settings/EmployeeTypes?ShowIsActive=true/false` | GET | All employee types; if `ShowIsActive=true` returns only active. |
| `/api/Settings/EmployeeSignatoryImage?employeeId=N` | GET | Returns the signatory image as a Base64 string read from `wwwroot/fileuploads/EmployeeSignatures/`. |
| `/api/Settings/ExternalReferrers` | GET | All `IsExternal=true` employees. |
| `/api/Settings/Referrers` | GET | Active doctors / external referrers (any active employee where `IsExternal=true` OR `IsAppointmentApplicable=true`). |
| `/api/Settings/Employees` | POST / PUT | Create / update an employee (writes `SignatoryImageBase64` to disk if provided, links `BIL_MST_BillServiceItem` rows via `UpdateBillItemsOfEmployee`). |
| `/api/Settings/EmployeeRoles` | POST / PUT | Create / update a role. |
| `/api/Settings/EmployeeTypes` | POST / PUT | Create / update a type. |
| `/api/Settings/ExternalReferrer` | POST / PUT | Create / update an external referrer (stored in the same `EMP_Employee` table with `IsExternal=true`; `FirstName` and `LastName` are hard-coded to `"External"`). |

### 6.5 Radiology settings (`RadiologySettingsController.cs`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/Settings/ImagingItems` | GET | All imaging items with `ImagingTypeName`, `ProcedureCode`, `TemplateId`, `IsValidForReporting`. |
| `/api/Settings/ImagingTypes` | GET | All imaging types. |
| `/api/Settings/ReportTemplates` | GET | All report templates. |
| `/api/Settings/ReportTemplate?templateId=N` | GET | One report template. |
| `/api/Settings/ImagingItem` | POST / PUT | Create / update an imaging item. PUT cascades `IsActive` to the matching `BIL_MST_BillServiceItem` for the radiology service department. |
| `/api/Settings/ImagingType` | POST / PUT | Create / update an imaging type. |
| `/api/Settings/ReportTemplate` | POST / PUT | Create / update a report template. |

### 6.6 Security / RBAC (`SecuritySettingsController.cs`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/Settings/Applications` | GET | All applications with their permissions + roles. |
| `/api/Settings/Routes` | GET | All RBAC routes. |
| `/api/Settings/Permissions` | GET | All permissions with their application name. |
| `/api/Settings/Roles` | GET | All non-sysadmin roles with route + application names. |
| `/api/Settings/Users` | GET | All users joined to `EMP_Employee.FullName` and `MST_Department.DepartmentName`. |
| `/api/Settings/RolePermissions?roleId=N` | GET | All permissions for a role. |
| `/api/Settings/UserRoles?userId=N` | GET | All roles for a user. |
| `/api/Settings/User` | POST / PUT | Create / update a user. POST encrypts the password via `RBAC.EncryptPassword`. |
| `/api/Settings/Role` | POST / PUT | Create / update a role. |
| `/api/Settings/RolePermissions?roleId=N` | POST | Replace-all: delete existing role-permission rows, then add the supplied list. |
| `/api/Settings/UserRoles` | POST | Add user-role links. |
| `/api/Settings/RolePermissions` | PUT | Update role-permission rows in place. |
| `/api/Settings/UserRoles` | PUT | Update user-role rows in place. |
| `/api/Settings/ResetPassword` | PUT | Reset password (only updates `Password`, `ModifiedBy`, `ModifiedOn`, `NeedsPasswordUpdate`). |
| `/api/Settings/UserIsActive` | PUT | Toggle `IsActive` only. |

### 6.7 View controller (`SettingsViewController.cs`)

The following cshtml actions are gated by `[DanpheViewFilter("settings-…-view")]` (a custom attribute that checks `validRouteList` for the current user):

| Action | View name | Route filter |
|--------|-----------|--------------|
| `SettingsMain()` | `SettingsMain` | `settings-view` |
| `UserAdd()` | `UserAdd` | (no filter — public to logged-in users) |
| `ApplicationAdd()` | `ApplicationAdd` | (no filter) |
| `DepartmentsManage()` | `DepartmentsManage` | `settings-departmentsmanage-view` |
| `RadiologyManage()` | `RadiologyManage` | `settings-radiologymanage-view` |
| `ADTManage()` | `ADTManage` | `settings-adtmanage-view` |
| `EmployeeManage()` | `EmployeeManage` | `settings-employeemanage-view` |
| `SecurityManage()` | `SecurityManage` | `ssettings-securitymanage-view` (note: double-`s` typo preserved) |
| `BillingManage()` | `BillingManage` | (no filter) |
| `GeolocationManage()` | `GeolocationManage` | `settings-geolocationmanage-view` |
| `ClinicalManage()` | `ClinicalManage` | `settings-clinicalmanage-view` |

---

## 7. Cross-Module Interactions

The Settings module is the producer of master data and the consumer of nothing — every other module reads from it. The interactions below are the most consequential:

| Consumer module | What it reads | Source table / endpoint |
|-----------------|---------------|------------------------|
| **Patient Registration** | Country / Sub-Division / Municipality, Price Category, Scheme, OPD Service Items. | `MST_Country`, `MST_CountrySubDivision`, `MST_Municipality`, `MST_PriceCategory`, `BIL_MST_Scheme`, `ServiceItem` (with `IntegrationName="OPD"`). |
| **Visit / Appointment** | Employee list (where `IsAppointmentApplicable=true` and `IsActive=true`), Doctor service items. | `/api/Settings/Employees` filtered + `OpdNewPatientServiceItemId` / `OpdOldPatientServiceItemId` / `FollowupServiceItemId`. |
| **ADT (Admission)** | Ward, Bed, BedFeature, AutoBillingItems, MinimumDepositSettings, BedFeature × Scheme × Price-Category, Service Department (`IntegrationName = "Bed Charges"`), Credit Org, Scheme. | `ADT_MST_Ward`, `ADT_Bed`, `ADT_MST_BedFeature`, `ADT_CFG_AutoBillingItem`, `ADT_CFG_DepositSettings`, `ADT_MAP_BedFeatureSchemePriceCategory`, `BIL_MST_CreditOrganization`, `BIL_MST_Scheme`. |
| **Billing (Transaction)** | Service Items, Service Departments, Price Categories, Schemes, Sub-Schemes, Price-Category Maps, Credit Organizations, Membership Types, Reporting Items, Printer Settings. | `BIL_MST_BillServiceItem`, `BIL_MST_ServiceDepartment`, `MST_PriceCategory`, `BIL_MST_Scheme`, `BIL_MST_SubScheme`, `BIL_MAP_PriceCategoryServiceItems`, `BIL_MAP_PriceCategoryScheme`, `BIL_MST_CreditOrganization`, `BIL_CFG_AdditionalServiceItem`, `BIL_MST_ReportingItems`, `BIL_CFG_Printer`. |
| **Pharmacy** | Pharmacy Stores, Pharmacy Credit Organizations, Payment Modes, Payment Page Settings. | `PHRM_MST_Store`, `PHRM_MST_CreditOrganization`, `MST_PaymentModes`, `CFG_PaymentModesSettings`. |
| **Inventory / Sub-Stores** | Stores (where `Category == Substore`), `StoreVerificationMap` (verifier permissions), `WardSubStoresMapModel`. | `MST_Store`, `MST_StoreVerificationMap`, `WardSubStoresMapModel`. |
| **Lab** | Lab Tests (created via `POST /api/Settings/LabTest`), `BIL_MST_BillServiceItem` (where `IntegrationName="lab"`), `MST_Department`. | `LAB_MST_LabTest`, `BIL_MST_BillServiceItem`, `MST_Department`. |
| **Radiology** | Imaging Items, Imaging Types, Report Templates, `BIL_MST_BillServiceItem` (where `IntegrationName="radiology"`). | `RAD_MST_ImagingItem`, `RAD_MST_ImagingType`, `RAD_CFG_ReportTemplate`. |
| **Clinical** | Intake / Output parameter list, ICD-10 codes and groups. | `CLN_ClinicalIntakeOutputParameter`, `MST_ICD10*`. |
| **Reports** | Print/Export Configuration, Tax, Currency, Fiscal Year, Reporting Items, Dynamic Report Names. | `CFG_PrintExportConfiguration`, `MST_Tax`, `BIL_MST_Currency`, `BIL_CFG_FiscalYear`, `BIL_MST_ReportingItems`, `BIL_MST_DynamicReportName`. |
| **Security (every request)** | RBAC Users, Roles, Permissions, Role-Permission Maps, User-Role Maps, Cookie Auth, Routes. | `RBAC_User`, `RBAC_Role`, `RBAC_Permission`, `RBAC_RolePermissionMap`, `RBAC_UserRoleMap`, `RBAC_AuthCookie`, `RBAC_Route`. |
| **Geolocation** | Country / Sub-Division / Municipality. | `MST_Country*`. |
| **Core / Hospital Info** | Core CFG Parameters (e.g. `SignatureLocationPath`, `AutoAddBillingItems` JSON, hospital name/address, email send details). | `CFG_Parameters`, `MST_EmailSendDetails`. |
| **Notifications / Email** | Email Send Details. | `MST_EmailSendDetails`. |
| **External Referral** | External Referrers (Employees with `IsExternal=true`). | `EMP_Employee` (filtered). |
| **Print/Export (any module)** | Print/Export Configuration per module, Printer Settings. | `CFG_PrintExportConfiguration`, `BIL_CFG_Printer`. |
| **Coupon / Patient-Insurance / Marketing Referral** | Schemes, Price Categories, Credit Organizations. | `BIL_MST_Scheme`, `MST_PriceCategory`, `BIL_MST_CreditOrganization`. |

Cascading effects the Settings module performs:

- Creating a `BedFeature` auto-creates a `BillServiceItem` (`IntegrationName = "Bed Charges"`).
- Creating a `Ward` auto-creates an `RBAC_Permission` (`ward-<wardname>` under `ADT Wards`).
- Renaming a `Ward` renames its permission.
- Activating/deactivating a `Ward` activates/deactivates its permission.
- Activating/deactivating a `Store` activates/deactivates its permission.
- Activating/deactivating a `BIL_MST_BillServiceItem` (by `IntegrationName`) activates/deactivates the matching integration row (Lab, Radiology, Bed Charges).
- Creating a service item with `IntegrationName = "Lab"` and `IntegrationItemId = labTestId` ties the billing side to the lab-test side.

---

## 8. Key Business Rules

### 8.1 Default values and invariants

1. **One default Price Category is mandatory.** The system throws `InvalidOperationException("There is no default PriceCategory set in the system, Please set if first")` if no `PriceCategory` with `IsDefault=true` exists when `GET /api/Settings/OPDServiceItems` is called.
2. **One default Deposit Head is recommended.** `DepositHead_DTO.IsDefault` is a single-row expected invariant enforced in UI.
3. **Exactly one active service item per (ServiceDepartment, IntegrationItemId) pair** is expected for the cascading `IsActive` logic to work.
4. **Bed features are billable.** Every bed feature must have a matching `BillServiceItem` with `IntegrationName = "Bed Charges"`. The system auto-creates this on `POST /api/Settings/BedFeature`.
5. **Wards are permission-scoped.** Every ward auto-gets an RBAC permission `ward-<wardname>` under the `ADT Wards` application. Renaming the ward renames the permission.
6. **Store names are permission-scoped.** Same pattern as wards for `PharmacyStore` and `Substore` (managed in legacy `SubstoreBL`).
7. **Employee types and roles** are RBAC-side metadata. The list of roles/types is plain CRUD; the RBAC permissions for these are managed in `SecuritySettingsController`.
8. **External referrers** are stored in the same `EMP_Employee` table with `IsExternal=true`. `FirstName` and `LastName` are hard-coded to `"External"` so the NOT-NULL DB constraint is satisfied; the actual `ReferrerName` lives in `FullName` (and `LastName` is overwritten on display).
9. **RBAC sysadmin role** is hidden from the standard security settings UI: the `Roles` endpoint filters `IsSysAdmin == false`. Only system-level code can create / modify the sysadmin role.
10. **Password reset** only modifies `Password`, `ModifiedBy`, `ModifiedOn`, `NeedsPasswordUpdate` on the user. Username, email, and other fields are not touched.
11. **User-Role and Role-Permission maps** are full-replace on POST (delete + insert in one transaction) and in-place update on PUT.
12. **Tax labels** are dynamic via `coreService.taxLabel` and the `SettingsGridColumnSettings` class — the same UI works for hospitals with VAT, GST, Service Charge, etc.
13. **Currency / fiscal year** are scoped by `BIL_CFG_FiscalYear` and `BIL_MST_Currency`. Billing transactions are tagged with the active fiscal year at insert time.
14. **Print/Export Configuration** has separate flags for NP date, EN date, and filter date range so Nepali / English / dual-calendar hospitals can choose.
15. **Payment Mode Settings** are grouped by `PaymentPageId` (one row per page × sub-category). `IsRemarksMandatory`, `ShowPaymentDetails`, `DisplaySequence`, and `IsActive` drive the billing/pharmacy settle-page UI.
16. **Auto-billing items** are gated by `IsRepeatable` — a repeatable item can be added multiple times during a single admission (e.g. a daily charge).
17. **Bed-feature × scheme × price-category map** is checked during admission to ensure the chosen price category is allowed for the patient's bed feature + scheme.
18. **Min deposit `IsOnlyMinimumDeposit=true`** means: collect at least the configured amount, no more is required (over-collection blocked). `false` means the amount is a minimum, more can be collected.
19. **Bed transfer / ward change** cascades through `BedFeaturesMap` — when a bed is moved to a different ward, the `BedFeaturesMap` rows for that bed are updated to the new `WardId`.
20. **Service items have `ServiceCategoryId`** for grouping (e.g. `BEDCH` for bed charges). The category list is exposed via `GET /api/Settings/ServiceCategories`.
21. **Imaging items have `IsValidForReporting`** — only those marked `true` show up in reporting dropdowns.
22. **Imaging items have `TemplateId`** — the report template used to render this study's report.
23. **Reporting items** can be mapped to one or more billing items via `BIL_MAP_ReportingItemsBillItem`, allowing cross-departmental reports.
24. **Printer settings** carry `mh` / `ml` / `Width_Lines` / `Height_Lines` / `HeaderGap_Lines` / `FooterGap_Lines` for raw text-mode printers (the system also supports HTML mode for modern printers).

### 8.2 Tenant isolation

Per `AGENTS.md` and the Cloudflare-native migration:

- Every settings table must have a `tenant_id` column in the D1 / SQLite target schema.
- Every controller method must scope reads and writes by `tenant_id` derived from the JWT (or RBAC user) — never trust the request body to set the tenant.
- Auto-generated `id` columns (e.g. `WardId`, `SchemeId`) must remain globally unique only because they're not naturally tenant-scoped; in the new schema they may be replaced with composite primary keys `(tenant_id, id)` or globally-unique `uuid` columns.
- `RBAC_Permission` rows that are auto-created (ward permissions, store permissions) are tenant-scoped.
- `BillServiceItemPriceCategoryMap` prices are tenant-scoped — a Normal price for tenant A and a Normal price for tenant B can differ.
- Default seed data (default scheme, default price category, default payment modes, default roles) is inserted per-tenant on first onboarding.

### 8.3 Auth / RBAC

- All write endpoints require the request to come from an authenticated user (`RbacUser` in `HttpContext.Session`); audit fields (`CreatedBy`, `ModifiedBy`) are pulled from `currentUser.EmployeeId`.
- The `[DanpheViewFilter(...)]` attribute on `SettingsViewController` checks the `validRouteList` session variable for the required permission before rendering the cshtml.
- The Angular frontend re-checks authorization via `AuthGuardService` on every route under `/Settings/ADTManage`, `/Settings/BillingManage`, `/Settings/EmployeeManage`, `/Settings/SecurityManage`, `/Settings/RadiologyManage`, `/Settings/DepartmentsManage`, etc.

### 8.4 Audit trail

- Every settings entity carries `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`, `IsActive`.
- The `AdminParametersModel` and `AuditTableDisplayName` (in `SystemAdminModels/`) plus `AuditTrailModel` and `DatabaseLogModel` provide a general-purpose audit mechanism that the Settings module writes to on every successful save.
- Soft-delete is preferred over hard-delete: most entities use `IsActive` toggling. The only places that hard-delete are the `RolePermissionMap` / `UserRoleMap` replace operations (which delete before re-inserting in a single transaction).

### 8.5 Error handling and idempotency

- The controllers wrap work in `Func<object>` lambdas and pass them to `InvokeHttpGetFunction` / `InvokeHttpPostFunction` / `InvokeHttpPutFunction` from `CommonController`, which catches exceptions and serializes them as a `DanpheHTTPResponse<object>` with `Status = "Failed"` and an `ErrorMessage`.
- `SaveBed`, `AddWard`, `SaveBedFeature`, `UpdateBedFeatureSchemePriceCategoryMap`, `ActivateDeactivateBedFeatureSchemePriceCategoryMap`, `UpdateMinimumDepositSetting`, `ActivateDeactivateMinimumDepositSetting`, `AddAdtBedFeatureSchemePriceCategory`, `AddAdtAutoBillingItem`, `UpdateAutoBillingItem`, `AddBillScheme`, `UpdateBillScheme`, `SaveSchemePriceCategoryMap`, `UpdateSchemePriceCategoryMap`, `ActivateDeactivateSchemePriceCategoryMapItem` all use `Database.BeginTransaction()` with explicit Commit / Rollback for atomicity.
- `GetICD10Groups` returns a `DanpheHTTPResponse<object>` directly (rather than via the `InvokeHttp*Function` helper) so the result shape is slightly different (no `Results` wrapper, but `responseData.Status` / `responseData.Results`).
- `UpdatePaymentModeSettings`, `ActivatePriceCategory`, `GetPaymentModes`, `GetPaymentModeSettings` all return `Ok(responseData)` directly with a manually-built `DanpheHTTPResponse<object>` (Status / Results / ErrorMessage).
