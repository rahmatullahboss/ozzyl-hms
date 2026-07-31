#!/usr/bin/env python3
"""
Batch i18n fixer for remaining HMS pages.
Adds useTranslation hooks and replaces hardcoded strings with t() calls.
"""
import json
import re

# ─── BillingMasterPage.tsx fixes ───
# This file already has useTranslation(['billing', 'common'])
# We need to add t() calls to all the tab components

billing_fixes = [
    # Schemes tab
    ("'New Scheme'", "t('master.schemes.newScheme')"),
    ("'Edit Billing Scheme'", "t('master.schemes.editScheme')"),
    ("'New Billing Scheme'", "t('master.schemes.newSchemeTitle')"),
    ("'Scheme Name *'", "t('master.schemes.schemeNameLabel')"),
    ("'Code'", "t('master.schemes.code')", 2),  # appears twice
    ("'Discount %'", "t('master.schemes.discountPercent')"),
    ("'Type'", "t('master.schemes.typeLabel')"),
    ("<option value=\"general\">General</option>", "<option value=\"general\">{t('master.schemes.general')}</option>"),
    ("<option value=\"insurance\">Insurance</option>", "<option value=\"insurance\">{t('master.schemes.insurance')}</option>"),
    ("<option value=\"government\">Government</option>", "<option value=\"government\">{t('master.schemes.government')}</option>"),
    ("<option value=\"corporate\">Corporate</option>", "<option value=\"corporate\">{t('master.schemes.corporate')}</option>"),
    ("'Cancel'", "t('master.common.cancel')"),
    ("'Saving…'", "t('master.common.saving')"),
    ("'Update'", "t('master.common.update')"),
    ("'Create'", "t('master.common.create')"),
    ("'Scheme updated'", "t('master.schemes.schemeUpdated')"),
    ("'Scheme created'", "t('master.schemes.schemeCreated')"),
    ("'Failed'", "t('master.common.saveFailed')"),
    ("'Deactivate this scheme?'", "t('master.common.deactivate')"),
    ("'Deactivated'", "t('master.common.deactivated')"),
    ("'No schemes'", "t('master.schemes.noSchemes')"),
    ("'Create your first billing scheme.'", "t('master.schemes.noSchemesDesc')"),
    ("'Active'", "t('master.schemes.active')"),
    ("'Inactive'", "t('master.schemes.inactive')"),
]

# Print the billing fixes for manual review
print("BillingMasterPage fixes to apply:")
for fix in billing_fixes:
    print(f"  {fix[0]} -> {fix[1]}")

print("\nDone. Apply these fixes manually or use a more sophisticated script.")
