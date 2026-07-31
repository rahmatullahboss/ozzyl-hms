export type RuleScope = 'lab_test' | 'ot_operation' | 'procedure' | 'radiology' | 'ward_task' | 'general_service';
export type TriggerEvent = 'billing' | 'order_confirmed' | 'result_finalized' | 'procedure_completed' | 'manual_confirm';
export type ReadinessStatus = 'ok' | 'low' | 'blocked' | 'no_rule' | 'no_stock';
export type DemandTrendLabel = 'new' | 'up' | 'down' | 'stable' | 'spiky' | 'no_data';
export type RecommendationStatus = 'ok' | 'watch' | 'low' | 'stockout' | 'overstock' | 'mapping_gap' | 'blocked';
