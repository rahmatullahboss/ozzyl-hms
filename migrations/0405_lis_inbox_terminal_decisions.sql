-- Make final analyzer inbox review decisions immutable.
-- Corrections or rematches must create a new superseding inbox observation
-- rather than rewriting accepted or rejected clinical evidence.

CREATE TRIGGER IF NOT EXISTS trg_lis_analyzer_inbox_terminal_decision_immutable
BEFORE UPDATE ON lis_analyzer_inbox
FOR EACH ROW
WHEN OLD.disposition IN ('accepted', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'terminal analyzer inbox decision cannot be modified');
END;
