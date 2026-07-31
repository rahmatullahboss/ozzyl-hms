import { createDeterministicSourceId, createSourceEvidenceSha256, normalizeIdentityText } from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface ServiceCatalogBackfillPreparedStatement {
  bind(...values: unknown[]): ServiceCatalogBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface ServiceCatalogBackfillDatabase {
  prepare(sql: string): ServiceCatalogBackfillPreparedStatement;
  batch(statements: ServiceCatalogBackfillPreparedStatement[]): Promise<unknown[]>;
}
export interface ServiceCatalogBackfillOptions {
  tenantId: string;
  runPublicId: string;
  currencyCode: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}
export interface ServiceCatalogBackfillCounts {
  scanned: number;
  itemsCreated: number;
  pricesCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}
export interface ServiceCatalogBackfillResult {
  completed: boolean;
  counts: ServiceCatalogBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface PriceRow { price_public_id: string; amount_minor: number }
interface DepartmentRow { id: number; department_code: string; department_name: string }
interface BillingItemRow { id: number; service_department_id: number; item_code: string; item_name: string; price: number; is_active: number; created_at: string | null }
interface CategoryPriceRow { id: number; service_item_id: number; price_category_id: number; price: number; is_active: number; created_at: string | null }
interface LabRow { id: number; code: string; name: string; category: string | null; price: number; is_active: number; billing_service_item_id: number | null; created_at: string | null }
interface RadiologyRow { id: number; procedure_code: string; name: string; price_paisa: number; is_active: number; billing_service_item_id: number | null; created_at: string | null }
interface ConsultationRow { id: number; doctor_id: number; appointment_type: string; fee: number; is_active: number; created_at: string | null }
interface BedRow { id: number; bed_type: string | null; rate_per_day: number; status: string | null; created_at: string | null }
interface ProcedureRow { id: number; name: string; default_charge: number; is_active: number; created_at: string | null }
interface MedicineRow { id: number; name: string; generic_name: string | null; unit_price: number; unit: string | null; is_active: number; created_at: string | null }
interface Context {
  db: ServiceCatalogBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  currencyCode: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
}
interface StartCounts { items: number; prices: number; mappings: number; issues: number }

type ItemKind = 'laboratory' | 'radiology' | 'consultation' | 'bed' | 'procedure' | 'product' | 'other';
type PriceContext = 'base' | 'price_category' | 'appointment_type' | 'bed_rate' | 'sale';

const SOURCE_BILLING = 'legacy_billing_service_item';
const SOURCE_CATEGORY_PRICE = 'legacy_billing_price_category';
const SOURCE_LAB = 'legacy_lab_test';
const SOURCE_RADIOLOGY = 'legacy_radiology_item';
const SOURCE_CONSULTATION = 'legacy_consultation_fee';
const SOURCE_BED = 'legacy_bed';
const SOURCE_PROCEDURE = 'legacy_ot_procedure';
const SOURCE_MEDICINE = 'legacy_medicine';

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}
function currency(value: string): string {
  exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError('currencyCode must be three uppercase letters');
  return value;
}
function limit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive integer');
  return value;
}
function legacyUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  return toUtcIso(`${iso}+06:00`);
}
function normalizedCode(value: string | null | undefined): string | null {
  const text = value?.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '-');
  return text || null;
}
function majorMinor(value: number | string): number {
  const units = toMinorUnits(String(value));
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new RangeError('price outside supported minor-unit range');
  }
  return units;
}
function integerMajorMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('integer major-unit price is invalid');
  const units = BigInt(value) * 100n;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('price outside supported minor-unit range');
  return Number(units);
}
async function all<T>(s: ServiceCatalogBackfillPreparedStatement): Promise<T[]> { return (await s.all<T>()).results; }
async function tableCount(db: ServiceCatalogBackfillDatabase, table: string, tenantId: string, tail = ''): Promise<number> {
  return Number((await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?${tail}`).bind(tenantId).first<CountRow>())?.count ?? 0);
}
async function capture(db: ServiceCatalogBackfillDatabase, tenantId: string): Promise<StartCounts> {
  return {
    items: await tableCount(db, 'canonical_service_catalog_items', tenantId),
    prices: await tableCount(db, 'canonical_service_prices', tenantId),
    mappings: await tableCount(db, 'canonical_source_mappings', tenantId, " AND entity_type IN ('service_catalog_item','service_price')"),
    issues: await tableCount(db, 'canonical_processing_issues', tenantId, " AND issue_type='service_catalog_backfill'"),
  };
}
async function result(db: ServiceCatalogBackfillDatabase, tenantId: string, start: StartCounts, scanned: number, completed: boolean): Promise<ServiceCatalogBackfillResult> {
  const end = await capture(db, tenantId);
  return { completed, counts: { scanned, itemsCreated: end.items-start.items, pricesCreated:end.prices-start.prices, mappingsCreated:end.mappings-start.mappings, issuesCreated:end.issues-start.issues } };
}
async function ensureRun(ctx: Omit<Context,'runId'|'remaining'|'scanned'>): Promise<RunRow> {
  let row = await ctx.db.prepare('SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1').bind(ctx.tenantId,ctx.runPublicId).first<RunRow>();
  if (!row) {
    await ctx.db.prepare(`INSERT INTO canonical_migration_runs(tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,created_at_utc,updated_at_utc) VALUES(?,?,'0508_canonical_service_catalog.sql','backfill','running',?,?,?)`).bind(ctx.tenantId,ctx.runPublicId,ctx.nowUtc,ctx.nowUtc,ctx.nowUtc).run();
    row = await ctx.db.prepare('SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1').bind(ctx.tenantId,ctx.runPublicId).first<RunRow>();
  }
  if (!row) throw new Error('Failed to create service catalog run');
  if (row.status === 'failed' || row.status === 'cancelled') {
    throw new Error(`Service catalog backfill run is terminal: ${row.status}`);
  }
  return row;
}
async function checkpoint(ctx: Context, sourceType: string): Promise<CheckpointRow> {
  let row = await ctx.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints WHERE tenant_id=? AND migration_run_id=? AND entity_type='service_catalog' AND source_type=? AND partition_key='' LIMIT 1`).bind(ctx.tenantId,ctx.runId,sourceType).first<CheckpointRow>();
  if (!row) {
    const id=await createDeterministicSourceId('chk',ctx.tenantId,'service_catalog_backfill',`${ctx.runPublicId}:${sourceType}`);
    await ctx.db.prepare(`INSERT INTO canonical_backfill_checkpoints(tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,partition_key,status,started_at_utc,created_at_utc,updated_at_utc) VALUES(?,?,?,'service_catalog',?,'','running',?,?,?)`).bind(ctx.tenantId,id,ctx.runId,sourceType,ctx.nowUtc,ctx.nowUtc,ctx.nowUtc).run();
    row = await ctx.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints WHERE tenant_id=? AND migration_run_id=? AND entity_type='service_catalog' AND source_type=? AND partition_key='' LIMIT 1`).bind(ctx.tenantId,ctx.runId,sourceType).first<CheckpointRow>();
  }
  if (!row) throw new Error(`Failed to create checkpoint for ${sourceType}`);
  return row;
}
function progress(ctx: Context, cp: CheckpointRow, cursor: string, created=0, mapped=0, skipped=0, exceptions=0) {
  return ctx.db.prepare(`UPDATE canonical_backfill_checkpoints SET cursor_value=?,scanned_count=scanned_count+1,created_count=created_count+?,mapped_count=mapped_count+?,skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=? WHERE tenant_id=? AND id=?`).bind(cursor,created,mapped,skipped,exceptions,ctx.nowUtc,ctx.tenantId,cp.id);
}
async function existing(ctx: Context, entityType: string, sourceType: string, sourceId: string): Promise<MappingRow|null> {
  return ctx.db.prepare('SELECT canonical_public_id,mapping_status,evidence_sha256 FROM canonical_source_mappings WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1').bind(ctx.tenantId,entityType,sourceType,sourceId).first<MappingRow>();
}
function mapStmt(ctx: Context, entityType: 'service_catalog_item'|'service_price', canonicalId: string|null, sourceType: string, sourceId: string, table: string, status: 'mapped'|'ambiguous'|'rejected', evidence: string) {
  return ctx.db.prepare(`INSERT OR IGNORE INTO canonical_source_mappings(tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,created_at_utc,updated_at_utc) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)`).bind(ctx.tenantId,entityType,canonicalId,sourceType,sourceId,table,status,ctx.runId,evidence,ctx.nowUtc,ctx.nowUtc);
}
async function issue(ctx: Context, code: string, sourceType: string, sourceId: string|null, key: string, summary: string, details?: Record<string,number|string>) {
  const fp=await createDeterministicSourceId('fp',ctx.tenantId,code,key); const id=await createDeterministicSourceId('iss',ctx.tenantId,code,key);
  return ctx.db.prepare(`INSERT INTO canonical_processing_issues(tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,source_type,source_public_id,fingerprint,severity,status,occurrence_count,summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc) VALUES(?,?,?,'service_catalog_backfill',?,'service_catalog',?,?,?,'error','open',1,?,?,?,?,?,?) ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET migration_run_id=excluded.migration_run_id,occurrence_count=canonical_processing_issues.occurrence_count+1,last_seen_at_utc=excluded.last_seen_at_utc,details_json=excluded.details_json,updated_at_utc=excluded.updated_at_utc`).bind(ctx.tenantId,id,ctx.runId,code,sourceType,sourceId,fp,summary,details?JSON.stringify(details):null,ctx.nowUtc,ctx.nowUtc,ctx.nowUtc,ctx.nowUtc);
}
function classify(dept: DepartmentRow|undefined): ItemKind {
  const key=`${dept?.department_code??''} ${dept?.department_name??''}`.toLowerCase();
  if (/lab|patholog|diagnostic/.test(key)) return 'laboratory';
  if (/radio|imaging|xray|ultra|ct|mri/.test(key)) return 'radiology';
  if (/consult|doctor|opd/.test(key)) return 'consultation';
  if (/bed|cabin|ward/.test(key)) return 'bed';
  if (/procedure|operation|ot|surgery/.test(key)) return 'procedure';
  if (/pharmacy|medicine|product/.test(key)) return 'product';
  return 'other';
}
function itemStmt(ctx: Context, id: string, kind: ItemKind, code: string|null, name: string, unit: string, active: boolean, evidence: string) {
  return ctx.db.prepare(`INSERT OR IGNORE INTO canonical_service_catalog_items(tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256,created_at_utc,updated_at_utc) VALUES(?,?,?,?,?,?,?, ?,?,?)`).bind(ctx.tenantId,id,kind,code,name,unit,active?'active':'inactive',evidence,ctx.nowUtc,ctx.nowUtc);
}
async function priceStatements(ctx: Context, input: { serviceId:string; sourceType:string; sourceId:string; sourceTable:string; context:PriceContext; contextKey:string; amount:number; validFrom:string; active:boolean; evidence:string }): Promise<{statements:ServiceCatalogBackfillPreparedStatement[]; issueCount:number}> {
  const overlap = await ctx.db.prepare(
    `SELECT price_public_id, amount_minor FROM canonical_service_prices
     WHERE tenant_id=? AND service_public_id=? AND price_context_type=?
       AND price_context_key=? AND status='active'
       AND (valid_to_utc IS NULL OR valid_to_utc>?)
     ORDER BY valid_from_utc DESC LIMIT 1`,
  ).bind(ctx.tenantId,input.serviceId,input.context,input.contextKey,input.validFrom).first<PriceRow>();
  if (overlap && overlap.amount_minor === input.amount) {
    return {statements:[mapStmt(ctx,'service_price',overlap.price_public_id,input.sourceType,input.sourceId,input.sourceTable,'mapped',input.evidence)],issueCount:0};
  }
  if (overlap) {
    return {statements:[await issue(ctx,'SERVICE_PRICE_PERIOD_OVERLAP',input.sourceType,input.sourceId,`${input.serviceId}:${input.context}:${input.contextKey}`,'Effective price context overlaps an existing active price.'),mapStmt(ctx,'service_price',null,input.sourceType,input.sourceId,input.sourceTable,'ambiguous',input.evidence)],issueCount:1};
  }
  const pid=await createDeterministicSourceId('prc',ctx.tenantId,`${input.sourceType}:price`,`${input.sourceId}:${input.context}:${input.contextKey}`);
  return {statements:[ctx.db.prepare(`INSERT OR IGNORE INTO canonical_service_prices(tenant_id,price_public_id,service_public_id,price_context_type,price_context_key,amount_minor,currency_code,valid_from_utc,status,source_evidence_sha256,created_at_utc,updated_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ctx.tenantId,pid,input.serviceId,input.context,input.contextKey,input.amount,ctx.currencyCode,input.validFrom,input.active?'active':'inactive',input.evidence,ctx.nowUtc,ctx.nowUtc),mapStmt(ctx,'service_price',pid,input.sourceType,input.sourceId,input.sourceTable,'mapped',input.evidence)],issueCount:0};
}
async function skip(ctx:Context,cp:CheckpointRow,id:string){await ctx.db.batch([progress(ctx,cp,id,0,0,1,0)]);ctx.scanned++;ctx.remaining--;}
async function handleExisting(
  ctx: Context,
  cp: CheckpointRow,
  entityType: 'service_catalog_item' | 'service_price',
  sourceType: string,
  sourceId: string,
  evidence: string,
): Promise<boolean> {
  const prior = await existing(ctx, entityType, sourceType, sourceId);
  if (!prior) return false;
  if (prior.evidence_sha256 !== evidence) {
    await ctx.db.batch([
      await issue(
        ctx,
        'SERVICE_SOURCE_EVIDENCE_CHANGED',
        sourceType,
        sourceId,
        `${sourceType}:${sourceId}:evidence-changed`,
        'Previously mapped service source evidence changed and requires review.',
      ),
      progress(ctx, cp, sourceId, 0, 0, 1, 1),
    ]);
    ctx.scanned += 1;
    ctx.remaining -= 1;
    return true;
  }
  await skip(ctx, cp, sourceId);
  return true;
}
async function runPhase<T extends {id:number}>(ctx:Context,type:string,rows:T[],fn:(ctx:Context,cp:CheckpointRow,row:T)=>Promise<void>){const cp=await checkpoint(ctx,type);const cursor=Number(cp.cursor_value??0);for(const row of rows.filter(r=>r.id>cursor)){if(ctx.remaining<=0){await ctx.db.prepare("UPDATE canonical_backfill_checkpoints SET status='paused',updated_at_utc=? WHERE tenant_id=? AND id=?").bind(ctx.nowUtc,ctx.tenantId,cp.id).run();return false;}await fn(ctx,cp,row);}await ctx.db.prepare("UPDATE canonical_backfill_checkpoints SET status='completed',completed_at_utc=?,updated_at_utc=? WHERE tenant_id=? AND id=?").bind(ctx.nowUtc,ctx.nowUtc,ctx.tenantId,cp.id).run();return true;}

async function processBilling(ctx:Context,cp:CheckpointRow,row:BillingItemRow,depts:Map<number,DepartmentRow>,dup:Set<string>){const sid=String(row.id);const code=normalizedCode(row.item_code);const duplicate=code?dup.has(code):false;const evidence=await createSourceEvidenceSha256({sourceType:SOURCE_BILLING,sourcePublicId:sid,departmentId:row.service_department_id,code,name:normalizeIdentityText(row.item_name),price:String(row.price),active:row.is_active===1});if(await handleExisting(ctx,cp,'service_catalog_item',SOURCE_BILLING,sid,evidence))return;const publicId=await createDeterministicSourceId('svc',ctx.tenantId,SOURCE_BILLING,sid);const statements=[itemStmt(ctx,publicId,classify(depts.get(row.service_department_id)),duplicate?null:code,row.item_name,'service',row.is_active===1,evidence),mapStmt(ctx,'service_catalog_item',publicId,SOURCE_BILLING,sid,'billing_service_items','mapped',evidence)];let exceptions=0; if(duplicate){statements.push(await issue(ctx,'SERVICE_CODE_DUPLICATE',SOURCE_BILLING,null,`billing-code:${code}`,'Multiple billing service items share one normalized code.'));exceptions++;}try{const price=await priceStatements(ctx,{serviceId:publicId,sourceType:SOURCE_BILLING,sourceId:sid,sourceTable:'billing_service_items',context:'base',contextKey:'',amount:majorMinor(row.price),validFrom:legacyUtc(row.created_at,ctx.nowUtc),active:row.is_active===1,evidence});statements.push(...price.statements);exceptions+=price.issueCount;}catch{statements.push(mapStmt(ctx,'service_price',null,SOURCE_BILLING,sid,'billing_service_items','ambiguous',evidence),await issue(ctx,'SERVICE_PRICE_INEXACT_MINOR_CONVERSION',SOURCE_BILLING,sid,`billing-price:${sid}`,'Billing service price cannot be represented exactly in integer minor units.'));exceptions++;}statements.push(progress(ctx,cp,sid,1,2,0,exceptions));await ctx.db.batch(statements);ctx.scanned++;ctx.remaining--;}

async function processLinked(ctx:Context,cp:CheckpointRow,row:LabRow|RadiologyRow,type:typeof SOURCE_LAB|typeof SOURCE_RADIOLOGY,dup:Set<string>){const sid=String(row.id);const linked=row.billing_service_item_id;const code=normalizedCode(type===SOURCE_LAB?(row as LabRow).code:(row as RadiologyRow).procedure_code);const name=type===SOURCE_LAB?(row as LabRow).name:(row as RadiologyRow).name;const active=row.is_active===1;const sourceAmount=type===SOURCE_LAB?integerMajorMinor((row as LabRow).price):(row as RadiologyRow).price_paisa;const evidence=await createSourceEvidenceSha256({sourceType:type,sourcePublicId:sid,code,name:normalizeIdentityText(name),amountMinor:sourceAmount,billingServiceItemId:linked,active});if(await handleExisting(ctx,cp,'service_catalog_item',type,sid,evidence))return;if(linked!=null){const bill=await existing(ctx,'service_catalog_item',SOURCE_BILLING,String(linked));if(bill?.canonical_public_id){const base=await ctx.db.prepare("SELECT price_public_id,amount_minor FROM canonical_service_prices WHERE tenant_id=? AND service_public_id=? AND price_context_type='base' AND price_context_key='' ORDER BY valid_from_utc DESC LIMIT 1").bind(ctx.tenantId,bill.canonical_public_id).first<PriceRow>();const statements=[mapStmt(ctx,'service_catalog_item',bill.canonical_public_id,type,sid,type===SOURCE_LAB?'lab_test_catalog':'radiology_imaging_items','mapped',evidence)];let ex=0;if(base&&base.amount_minor===sourceAmount){statements.push(mapStmt(ctx,'service_price',base.price_public_id,type,sid,type===SOURCE_LAB?'lab_test_catalog':'radiology_imaging_items','mapped',evidence));}else{statements.push(mapStmt(ctx,'service_price',null,type,sid,type===SOURCE_LAB?'lab_test_catalog':'radiology_imaging_items','ambiguous',evidence),await issue(ctx,'SERVICE_LINKED_PRICE_CONFLICT',type,sid,`${type}:${sid}:linked-price`,'Linked service source price conflicts with the billing service price.',{sourceAmountMinor:sourceAmount,billingAmountMinor:base?.amount_minor??-1}));ex++;}statements.push(progress(ctx,cp,sid,0,1,0,ex));await ctx.db.batch(statements);ctx.scanned++;ctx.remaining--;return;}}
const duplicate=code?dup.has(code):false;const publicId=await createDeterministicSourceId('svc',ctx.tenantId,type,sid);const codeOwner=code?await ctx.db.prepare('SELECT service_public_id FROM canonical_service_catalog_items WHERE tenant_id=? AND canonical_code=? LIMIT 1').bind(ctx.tenantId,code).first<{service_public_id:string}>():null;const codeConflict=duplicate||Boolean(codeOwner&&codeOwner.service_public_id!==publicId);const kind:ItemKind=type===SOURCE_LAB?'laboratory':'radiology';const statements=[itemStmt(ctx,publicId,kind,codeConflict?null:code,name,'service',active,evidence),mapStmt(ctx,'service_catalog_item',publicId,type,sid,type===SOURCE_LAB?'lab_test_catalog':'radiology_imaging_items','mapped',evidence)];let ex=0;if(codeConflict){statements.push(await issue(ctx,'SERVICE_CODE_DUPLICATE',type,null,`catalog-code:${code}`,'Multiple source services claim one normalized canonical code.'));ex++;}const price=await priceStatements(ctx,{serviceId:publicId,sourceType:type,sourceId:sid,sourceTable:type===SOURCE_LAB?'lab_test_catalog':'radiology_imaging_items',context:'base',contextKey:'',amount:sourceAmount,validFrom:legacyUtc(row.created_at,ctx.nowUtc),active,evidence});statements.push(...price.statements);ex+=price.issueCount;statements.push(progress(ctx,cp,sid,1,2,0,ex));await ctx.db.batch(statements);ctx.scanned++;ctx.remaining--;}

async function processCategory(ctx:Context,cp:CheckpointRow,row:CategoryPriceRow,dup:Set<string>){const sid=String(row.id);const key=`${row.service_item_id}:${row.price_category_id}`;const bill=await existing(ctx,'service_catalog_item',SOURCE_BILLING,String(row.service_item_id));const evidence=await createSourceEvidenceSha256({sourceType:SOURCE_CATEGORY_PRICE,sourcePublicId:sid,serviceItemId:row.service_item_id,priceCategoryId:row.price_category_id,price:String(row.price),active:row.is_active===1});if(await handleExisting(ctx,cp,'service_price',SOURCE_CATEGORY_PRICE,sid,evidence))return;if(!bill?.canonical_public_id){await ctx.db.batch([mapStmt(ctx,'service_price',null,SOURCE_CATEGORY_PRICE,sid,'billing_item_price_category_maps','ambiguous',evidence),await issue(ctx,'SERVICE_SOURCE_MAPPING_MISSING',SOURCE_CATEGORY_PRICE,sid,`category:${sid}:billing`,'Price-category source has no mapped billing service item.'),progress(ctx,cp,sid,0,1,0,1)]);ctx.scanned++;ctx.remaining--;return;}if(dup.has(key)){await ctx.db.batch([mapStmt(ctx,'service_price',null,SOURCE_CATEGORY_PRICE,sid,'billing_item_price_category_maps','ambiguous',evidence),await issue(ctx,'SERVICE_PRICE_PERIOD_OVERLAP',SOURCE_CATEGORY_PRICE,null,`category-overlap:${key}`,'Multiple active price-category rows overlap the same service context.'),progress(ctx,cp,sid,0,1,0,1)]);ctx.scanned++;ctx.remaining--;return;}let statements:ServiceCatalogBackfillPreparedStatement[]=[];let ex=0;try{const price=await priceStatements(ctx,{serviceId:bill.canonical_public_id,sourceType:SOURCE_CATEGORY_PRICE,sourceId:sid,sourceTable:'billing_item_price_category_maps',context:'price_category',contextKey:String(row.price_category_id),amount:majorMinor(row.price),validFrom:legacyUtc(row.created_at,ctx.nowUtc),active:row.is_active===1,evidence});statements=price.statements;ex=price.issueCount;}catch{statements=[mapStmt(ctx,'service_price',null,SOURCE_CATEGORY_PRICE,sid,'billing_item_price_category_maps','ambiguous',evidence),await issue(ctx,'SERVICE_PRICE_INEXACT_MINOR_CONVERSION',SOURCE_CATEGORY_PRICE,sid,`category-price:${sid}`,'Price-category value cannot be represented exactly in minor units.')];ex=1;}statements.push(progress(ctx,cp,sid,0,1,0,ex));await ctx.db.batch(statements);ctx.scanned++;ctx.remaining--;}

async function simpleSource(ctx:Context,cp:CheckpointRow,input:{id:number;type:string;table:string;kind:ItemKind;name:string;code:string|null;unit:string;active:boolean;amount:()=>number;context:PriceContext;contextKey:string;created:string|null;evidenceData:Record<string,unknown>;extraIssues?:()=>Promise<ServiceCatalogBackfillPreparedStatement[]>;publicKey?:string}){const sid=String(input.id);const evidence=await createSourceEvidenceSha256({sourceType:input.type,sourcePublicId:sid,...input.evidenceData});if(await handleExisting(ctx,cp,'service_catalog_item',input.type,sid,evidence))return;const publicId=await createDeterministicSourceId('svc',ctx.tenantId,input.type,input.publicKey??sid);const codeOwner=input.code?await ctx.db.prepare('SELECT service_public_id FROM canonical_service_catalog_items WHERE tenant_id=? AND canonical_code=? LIMIT 1').bind(ctx.tenantId,input.code).first<{service_public_id:string}>():null;const codeConflict=Boolean(codeOwner&&codeOwner.service_public_id!==publicId);const statements=[itemStmt(ctx,publicId,input.kind,codeConflict?null:input.code,input.name,input.unit,input.active,evidence),mapStmt(ctx,'service_catalog_item',publicId,input.type,sid,input.table,'mapped',evidence)];let ex=0;if(codeConflict){statements.push(await issue(ctx,'SERVICE_CODE_DUPLICATE',input.type,sid,`catalog-code:${input.code}`,'Multiple source services claim one normalized canonical code.'));ex++;}if(input.extraIssues){const issues=await input.extraIssues();statements.push(...issues);ex+=issues.length;}try{const p=await priceStatements(ctx,{serviceId:publicId,sourceType:input.type,sourceId:sid,sourceTable:input.table,context:input.context,contextKey:input.contextKey,amount:input.amount(),validFrom:legacyUtc(input.created,ctx.nowUtc),active:input.active,evidence});statements.push(...p.statements);ex+=p.issueCount;}catch{statements.push(mapStmt(ctx,'service_price',null,input.type,sid,input.table,'ambiguous',evidence),await issue(ctx,'SERVICE_PRICE_INEXACT_MINOR_CONVERSION',input.type,sid,`${input.type}-price:${sid}`,'Source price cannot be represented exactly in minor units.'));ex++;}statements.push(progress(ctx,cp,sid,1,2,0,ex));await ctx.db.batch(statements);ctx.scanned++;ctx.remaining--;}

export async function backfillServiceCatalog(db:ServiceCatalogBackfillDatabase,options:ServiceCatalogBackfillOptions):Promise<ServiceCatalogBackfillResult>{const tenantId=exact(options.tenantId,'tenantId');const runPublicId=exact(options.runPublicId,'runPublicId');const currencyCode=currency(options.currencyCode);const nowUtc=toUtcIso(options.nowUtc??new Date());const start=await capture(db,tenantId);const base={db,tenantId,runPublicId,currencyCode,nowUtc};const run=await ensureRun(base);if(run.status==='succeeded')return result(db,tenantId,start,0,true);const ctx:Context={...base,runId:run.id,remaining:limit(options.maxSourceRecords),scanned:0};
const depts=await all<DepartmentRow>(db.prepare('SELECT id,department_code,department_name FROM billing_service_departments WHERE CAST(tenant_id AS TEXT)=?').bind(tenantId));const deptMap=new Map(depts.map(x=>[x.id,x]));const billing=await all<BillingItemRow>(db.prepare('SELECT id,service_department_id,item_code,item_name,price,is_active,created_at FROM billing_service_items WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));const codeCounts=new Map<string,number>();for(const r of billing){const c=normalizedCode(r.item_code);if(c)codeCounts.set(c,(codeCounts.get(c)??0)+1);}const billingDup=new Set([...codeCounts].filter(([,n])=>n>1).map(([c])=>c));if(!await runPhase(ctx,SOURCE_BILLING,billing,(a,b,r)=>processBilling(a,b,r,deptMap,billingDup)))return result(db,tenantId,start,ctx.scanned,false);
const categories=await all<CategoryPriceRow>(db.prepare('SELECT id,service_item_id,price_category_id,price,is_active,created_at FROM billing_item_price_category_maps WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));const catCounts=new Map<string,number>();for(const r of categories){const k=`${r.service_item_id}:${r.price_category_id}`;if(r.is_active===1)catCounts.set(k,(catCounts.get(k)??0)+1);}const catDup=new Set([...catCounts].filter(([,n])=>n>1).map(([k])=>k));if(!await runPhase(ctx,SOURCE_CATEGORY_PRICE,categories,(a,b,r)=>processCategory(a,b,r,catDup)))return result(db,tenantId,start,ctx.scanned,false);
const labs=await all<LabRow>(db.prepare('SELECT id,code,name,category,price,is_active,billing_service_item_id,created_at FROM lab_test_catalog WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));const labCounts=new Map<string,number>();for(const r of labs){const c=normalizedCode(r.code);if(c)labCounts.set(c,(labCounts.get(c)??0)+1);}const labDup=new Set([...labCounts].filter(([,n])=>n>1).map(([c])=>c));if(!await runPhase(ctx,SOURCE_LAB,labs,(a,b,r)=>processLinked(a,b,r,SOURCE_LAB,labDup)))return result(db,tenantId,start,ctx.scanned,false);
const radios=await all<RadiologyRow>(db.prepare('SELECT id,procedure_code,name,price_paisa,is_active,billing_service_item_id,created_at FROM radiology_imaging_items WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));const radCounts=new Map<string,number>();for(const r of radios){const c=normalizedCode(r.procedure_code);if(c)radCounts.set(c,(radCounts.get(c)??0)+1);}const radDup=new Set([...radCounts].filter(([,n])=>n>1).map(([c])=>c));if(!await runPhase(ctx,SOURCE_RADIOLOGY,radios,(a,b,r)=>processLinked(a,b,r,SOURCE_RADIOLOGY,radDup)))return result(db,tenantId,start,ctx.scanned,false);
const consultations=await all<ConsultationRow>(db.prepare('SELECT id,doctor_id,appointment_type,fee,is_active,created_at FROM doctor_appointment_fees WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));if(!await runPhase(ctx,SOURCE_CONSULTATION,consultations,(a,b,r)=>simpleSource(a,b,{id:r.id,type:SOURCE_CONSULTATION,table:'doctor_appointment_fees',kind:'consultation',name:`Consultation ${r.appointment_type}`,code:`CONSULT-${r.doctor_id}-${normalizedCode(r.appointment_type)}`,unit:'encounter',active:r.is_active===1,amount:()=>integerMajorMinor(r.fee),context:'appointment_type',contextKey:normalizeIdentityText(r.appointment_type)??'unknown',created:r.created_at,evidenceData:{doctorId:r.doctor_id,appointmentType:normalizeIdentityText(r.appointment_type),feeMajor:r.fee}})))return result(db,tenantId,start,ctx.scanned,false);
const beds=await all<BedRow>(db.prepare('SELECT id,bed_type,rate_per_day,status,created_at FROM beds WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));const bedTypeRates=new Map<string,Set<number>>();for(const r of beds){const t=normalizeIdentityText(r.bed_type)??'unknown';let amount:number;try{amount=majorMinor(r.rate_per_day);}catch{continue;}const s=bedTypeRates.get(t)??new Set<number>();s.add(amount);bedTypeRates.set(t,s);}if(!await runPhase(ctx,SOURCE_BED,beds,async(a,b,r)=>{const t=normalizeIdentityText(r.bed_type)??'unknown';let amount=0;try{amount=majorMinor(r.rate_per_day);}catch{}const conflict=(bedTypeRates.get(t)?.size??0)>1;return simpleSource(a,b,{id:r.id,type:SOURCE_BED,table:'beds',kind:'bed',name:`Bed ${r.bed_type?.trim()||'Unknown'}`,code:null,unit:'day',active:r.status?.toLowerCase() !== 'inactive',amount:()=>majorMinor(r.rate_per_day),context:'bed_rate',contextKey:t,created:r.created_at,publicKey:t,evidenceData:{bedType:t,amountMinor:amount},extraIssues:conflict?()=>Promise.all([issue(a,'SERVICE_BED_TYPE_PRICE_CONFLICT',SOURCE_BED,null,`bed-type:${t}`,'One bed type has multiple active rates.',{rateCount:bedTypeRates.get(t)?.size??0})]):undefined});}))return result(db,tenantId,start,ctx.scanned,false);
const procedures=await all<ProcedureRow>(db.prepare('SELECT id,name,default_charge,is_active,created_at FROM ot_procedures WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));if(!await runPhase(ctx,SOURCE_PROCEDURE,procedures,(a,b,r)=>simpleSource(a,b,{id:r.id,type:SOURCE_PROCEDURE,table:'ot_procedures',kind:'procedure',name:r.name,code:null,unit:'procedure',active:r.is_active===1,amount:()=>majorMinor(r.default_charge),context:'base',contextKey:'',created:r.created_at,evidenceData:{name:normalizeIdentityText(r.name),charge:String(r.default_charge)}})))return result(db,tenantId,start,ctx.scanned,false);
const medicines=await all<MedicineRow>(db.prepare('SELECT id,name,generic_name,unit_price,unit,is_active,created_at FROM medicines WHERE CAST(tenant_id AS TEXT)=? ORDER BY id').bind(tenantId));if(!await runPhase(ctx,SOURCE_MEDICINE,medicines,(a,b,r)=>{const u=normalizeIdentityText(r.unit)??'unknown';return simpleSource(a,b,{id:r.id,type:SOURCE_MEDICINE,table:'medicines',kind:'product',name:r.name,code:null,unit:u,active:r.is_active===1,amount:()=>majorMinor(r.unit_price),context:'sale',contextKey:'',created:r.created_at,evidenceData:{name:normalizeIdentityText(r.name),generic:normalizeIdentityText(r.generic_name),unit:u,price:String(r.unit_price)},extraIssues:u==='unknown'?()=>Promise.all([issue(a,'SERVICE_UNIT_MISSING',SOURCE_MEDICINE,String(r.id),`medicine-unit:${r.id}`,'Product source is missing an explicit unit.')]):undefined});}))return result(db,tenantId,start,ctx.scanned,false);
const out=await result(db,tenantId,start,ctx.scanned,true);await db.prepare("UPDATE canonical_migration_runs SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=? WHERE tenant_id=? AND id=?").bind(nowUtc,JSON.stringify(out.counts),nowUtc,tenantId,run.id).run();return out;}
