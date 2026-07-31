-- Migration: 0075_tier2_ports.sql
-- Description: Tier 2 EHR feature ports from DanpheEMR
-- Features: Track Anything, LBF Forms, Questionnaires, Prior Authorization
-- All tables include tenant_id for multi-tenant isolation

-- =====================================================================
-- 1. TRACK ANYTHING MODULE
-- =====================================================================

-- 1a. Track Anything Categories
CREATE TABLE IF NOT EXISTS TRK_Category (
    CategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    CategoryName TEXT NOT NULL,
    Description TEXT,
    ParentCategoryId INTEGER,
    DisplayOrder INTEGER DEFAULT 0,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT,
    FOREIGN KEY (ParentCategoryId) REFERENCES TRK_Category(CategoryId)
);
CREATE INDEX IF NOT EXISTS idx_trk_category_tenant ON TRK_Category(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trk_category_active ON TRK_Category(tenant_id, IsActive);

-- 1b. Track Anything Configuration
CREATE TABLE IF NOT EXISTS TRK_Configuration (
    ConfigurationId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    CategoryId INTEGER,
    PatientId INTEGER,
    TrackName TEXT NOT NULL,
    TrackDescription TEXT,
    DataType TEXT NOT NULL DEFAULT 'number' CHECK (DataType IN ('number', 'text', 'date', 'boolean')),
    Units TEXT,
    NormalRangeMin REAL,
    NormalRangeMax REAL,
    CriticalLow REAL,
    CriticalHigh REAL,
    TargetValue REAL,
    DisplayOrder INTEGER DEFAULT 0,
    IsActive INTEGER DEFAULT 1,
    AllowDecimals INTEGER DEFAULT 1,
    ShowTrend INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT,
    FOREIGN KEY (CategoryId) REFERENCES TRK_Category(CategoryId)
);
CREATE INDEX IF NOT EXISTS idx_trk_config_tenant ON TRK_Configuration(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trk_config_category ON TRK_Configuration(tenant_id, CategoryId);
CREATE INDEX IF NOT EXISTS idx_trk_config_patient ON TRK_Configuration(tenant_id, PatientId);

-- 1c. Track Anything Data
CREATE TABLE IF NOT EXISTS TRK_Data (
    DataId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ConfigurationId INTEGER NOT NULL,
    PatientId INTEGER NOT NULL,
    PatientVisitId INTEGER,
    TrackValue TEXT NOT NULL,
    NumericValue REAL,
    TrackDate TEXT NOT NULL,
    Notes TEXT,
    Source TEXT,
    VerifiedBy INTEGER,
    VerifiedOn TEXT,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT,
    IsActive INTEGER DEFAULT 1,
    FOREIGN KEY (ConfigurationId) REFERENCES TRK_Configuration(ConfigurationId)
);
CREATE INDEX IF NOT EXISTS idx_trk_data_tenant ON TRK_Data(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trk_data_config ON TRK_Data(tenant_id, ConfigurationId);
CREATE INDEX IF NOT EXISTS idx_trk_data_patient ON TRK_Data(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_trk_data_date ON TRK_Data(tenant_id, TrackDate);

-- 1d. Track Anything Templates
CREATE TABLE IF NOT EXISTS TRK_Template (
    TemplateId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    TemplateName TEXT NOT NULL,
    TemplateDescription TEXT,
    TemplateType TEXT NOT NULL DEFAULT 'general' CHECK (TemplateType IN ('general', 'vitals', 'labs', 'chronic', 'mental-health')),
    IsSystem INTEGER DEFAULT 0,
    IsActive INTEGER DEFAULT 1,
    CreatedBy INTEGER,
    CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
    ModifiedBy INTEGER,
    ModifiedOn TEXT
);
CREATE INDEX IF NOT EXISTS idx_trk_template_tenant ON TRK_Template(tenant_id);

-- 1e. Track Anything Template Items
CREATE TABLE IF NOT EXISTS TRK_TemplateItem (
    TemplateItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    TemplateId INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    TrackName TEXT NOT NULL,
    TrackDescription TEXT,
    DataType TEXT NOT NULL DEFAULT 'number',
    Units TEXT,
    NormalRangeMin REAL,
    NormalRangeMax REAL,
    DisplayOrder INTEGER DEFAULT 0,
    FOREIGN KEY (TemplateId) REFERENCES TRK_Template(TemplateId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trk_template_item_tenant ON TRK_TemplateItem(tenant_id, TemplateId);

-- =====================================================================
-- 2. LBF FORMS (List Based Forms / Form Builder)
-- =====================================================================

-- 2a. LBF Form Definitions
CREATE TABLE IF NOT EXISTS LbfForm (
    FormId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    FormName TEXT NOT NULL,
    FormTitle TEXT NOT NULL,
    FormDescription TEXT,
    FormSchema TEXT NOT NULL,
    LayoutConfig TEXT,
    ValidationRules TEXT,
    Category TEXT,
    Specialty TEXT,
    SubCategory TEXT,
    IsEncounterForm INTEGER DEFAULT 1,
    IsPatientPortal INTEGER DEFAULT 0,
    AllowMultipleSubmissions INTEGER DEFAULT 0,
    MaxSubmissionsPerEncounter INTEGER,
    AcoSpec TEXT,
    AllowedRoles TEXT,
    AllowedProviders TEXT,
    EnableServicesSection INTEGER DEFAULT 0,
    EnableProductsSection INTEGER DEFAULT 0,
    EnableDiagnosesSection INTEGER DEFAULT 0,
    EnableReferralsSection INTEGER DEFAULT 0,
    IsActive INTEGER DEFAULT 1,
    IsTemplate INTEGER DEFAULT 0,
    TemplateId INTEGER,
    Version TEXT DEFAULT '1.0.0',
    ParentFormId INTEGER,
    CreatedById INTEGER NOT NULL,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TEXT,
    UpdatedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lbf_form_tenant ON LbfForm(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lbf_form_name ON LbfForm(tenant_id, FormName);
CREATE INDEX IF NOT EXISTS idx_lbf_form_category ON LbfForm(tenant_id, Category);
CREATE INDEX IF NOT EXISTS idx_lbf_form_active ON LbfForm(tenant_id, IsActive);

-- 2b. LBF Form Fields
CREATE TABLE IF NOT EXISTS LbfFormField (
    FieldId INTEGER PRIMARY KEY AUTOINCREMENT,
    FormId INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    FieldName TEXT NOT NULL,
    FieldLabel TEXT NOT NULL,
    FieldCode TEXT,
    FieldType TEXT NOT NULL,
    DataType TEXT NOT NULL,
    FieldConfig TEXT,
    ValidationRules TEXT,
    ConditionalLogic TEXT,
    OptionList TEXT,
    OptionListId TEXT,
    SectionId TEXT,
    DisplayOrder INTEGER DEFAULT 0,
    ColumnSpan INTEGER DEFAULT 1,
    RowSpan INTEGER DEFAULT 1,
    Placeholder TEXT,
    HelpText TEXT,
    DefaultValue TEXT,
    IsReadOnly INTEGER DEFAULT 0,
    IsHidden INTEGER DEFAULT 0,
    IsRequired INTEGER DEFAULT 0,
    MinValue REAL,
    MaxValue REAL,
    MinLength INTEGER,
    MaxLength INTEGER,
    Pattern TEXT,
    IsGraphable INTEGER DEFAULT 0,
    IsHistorical INTEGER DEFAULT 0,
    SourceTable TEXT,
    SourceColumn TEXT,
    IsActive INTEGER DEFAULT 1,
    FOREIGN KEY (FormId) REFERENCES LbfForm(FormId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lbf_field_tenant ON LbfFormField(tenant_id, FormId);

-- 2c. LBF Form Submissions
CREATE TABLE IF NOT EXISTS LbfFormSubmission (
    SubmissionId INTEGER PRIMARY KEY AUTOINCREMENT,
    FormId INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER NOT NULL,
    ProviderId INTEGER,
    SubmissionDate TEXT NOT NULL,
    SubmissionStatus TEXT DEFAULT 'completed',
    SubmissionMode TEXT DEFAULT 'electronic',
    FormData TEXT NOT NULL,
    DiagnosisCodes TEXT,
    ServiceCodes TEXT,
    ClinicalNotes TEXT,
    SignedById INTEGER,
    SignedAt TEXT,
    ReviewedById INTEGER,
    ReviewedAt TEXT,
    CreatedById INTEGER NOT NULL,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TEXT,
    UpdatedById INTEGER,
    IsActive INTEGER DEFAULT 1,
    DeletedAt TEXT,
    DeletedById INTEGER,
    FOREIGN KEY (FormId) REFERENCES LbfForm(FormId)
);
CREATE INDEX IF NOT EXISTS idx_lbf_submission_tenant ON LbfFormSubmission(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lbf_submission_form ON LbfFormSubmission(tenant_id, FormId);
CREATE INDEX IF NOT EXISTS idx_lbf_submission_patient ON LbfFormSubmission(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_lbf_submission_encounter ON LbfFormSubmission(tenant_id, EncounterId);
CREATE INDEX IF NOT EXISTS idx_lbf_submission_active ON LbfFormSubmission(tenant_id, IsActive);

-- 2d. LBF Field Values (for reporting)
CREATE TABLE IF NOT EXISTS LbfFieldValue (
    ValueId INTEGER PRIMARY KEY AUTOINCREMENT,
    SubmissionId INTEGER NOT NULL,
    FieldId INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    FieldValue TEXT,
    ValueNormalized TEXT,
    ValueUnit TEXT,
    FileUrl TEXT,
    FileName TEXT,
    FileSize INTEGER,
    FileMimeType TEXT,
    SignatureData TEXT,
    SignatureMeta TEXT,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (SubmissionId) REFERENCES LbfFormSubmission(SubmissionId) ON DELETE CASCADE,
    FOREIGN KEY (FieldId) REFERENCES LbfFormField(FieldId)
);
CREATE INDEX IF NOT EXISTS idx_lbf_field_value_tenant ON LbfFieldValue(tenant_id, SubmissionId);

-- 2e. LBF Form Sections
CREATE TABLE IF NOT EXISTS LbfFormSection (
    SectionId INTEGER PRIMARY KEY AUTOINCREMENT,
    FormId INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    SectionName TEXT NOT NULL,
    SectionTitle TEXT NOT NULL,
    SectionSubtitle TEXT,
    SectionConfig TEXT,
    InitialExpanded INTEGER DEFAULT 1,
    DisplayOrder INTEGER DEFAULT 0,
    ConditionalLogic TEXT,
    SectionStyle TEXT,
    IconName TEXT,
    FOREIGN KEY (FormId) REFERENCES LbfForm(FormId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lbf_section_tenant ON LbfFormSection(tenant_id, FormId);

-- 2f. LBF Form Templates
CREATE TABLE IF NOT EXISTS LbfFormTemplate (
    TemplateId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    TemplateName TEXT NOT NULL,
    TemplateTitle TEXT NOT NULL,
    TemplateDescription TEXT,
    FormSchema TEXT NOT NULL,
    Category TEXT,
    Specialty TEXT,
    Tags TEXT,
    UsageCount INTEGER DEFAULT 0,
    IsPublic INTEGER DEFAULT 0,
    IsRecommended INTEGER DEFAULT 0,
    SourceFormId INTEGER,
    CreatedById INTEGER NOT NULL,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lbf_template_tenant ON LbfFormTemplate(tenant_id);

-- 2g. LBF Form Access Log
CREATE TABLE IF NOT EXISTS LbfFormAccessLog (
    LogId INTEGER PRIMARY KEY AUTOINCREMENT,
    SubmissionId INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    AccessDate TEXT NOT NULL,
    AccessType TEXT NOT NULL,
    UserId INTEGER NOT NULL,
    UserRoleId TEXT,
    IpAddress TEXT,
    UserAgent TEXT,
    ChangeDescription TEXT,
    OldValue TEXT,
    NewValue TEXT,
    FOREIGN KEY (SubmissionId) REFERENCES LbfFormSubmission(SubmissionId)
);
CREATE INDEX IF NOT EXISTS idx_lbf_access_log_tenant ON LbfFormAccessLog(tenant_id, SubmissionId);

-- =====================================================================
-- 3. QUESTIONNAIRE ASSESSMENTS (LForms)
-- =====================================================================

-- 3a. Questionnaire Definitions
CREATE TABLE IF NOT EXISTS Questionnaire (
    QuestionnaireId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    QuestionnaireCode TEXT NOT NULL,
    Title TEXT NOT NULL,
    Description TEXT,
    Version TEXT,
    LFormsData TEXT NOT NULL,
    FhirMapping TEXT,
    Category TEXT,
    Specialty TEXT,
    EstimatedDuration INTEGER,
    ScoringMethod TEXT,
    IsActive INTEGER DEFAULT 1,
    PublishedDate TEXT,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_tenant ON Questionnaire(tenant_id);
CREATE INDEX IF NOT EXISTS idx_questionnaire_code ON Questionnaire(tenant_id, QuestionnaireCode);
CREATE INDEX IF NOT EXISTS idx_questionnaire_active ON Questionnaire(tenant_id, IsActive);

-- 3b. Questionnaire Responses
CREATE TABLE IF NOT EXISTS QuestionnaireResponse (
    ResponseId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    QuestionnaireId INTEGER NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER NOT NULL,
    ResponseDate TEXT NOT NULL,
    ResponseMode TEXT DEFAULT 'clinical',
    CompletedBy INTEGER,
    CompletionMethod TEXT,
    LFormsResponse TEXT NOT NULL,
    TotalScore REAL,
    ScoreInterpretation TEXT,
    RiskLevel TEXT,
    DiagnosisCodes TEXT,
    ClinicalNotes TEXT,
    FollowupRequired INTEGER DEFAULT 0,
    FollowupNotes TEXT,
    CreatedById INTEGER NOT NULL,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    IsActive INTEGER DEFAULT 1,
    DeletedAt TEXT,
    DeletedById INTEGER,
    FOREIGN KEY (QuestionnaireId) REFERENCES Questionnaire(QuestionnaireId)
);
CREATE INDEX IF NOT EXISTS idx_qr_tenant ON QuestionnaireResponse(tenant_id);
CREATE INDEX IF NOT EXISTS idx_qr_patient ON QuestionnaireResponse(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_qr_encounter ON QuestionnaireResponse(tenant_id, EncounterId);
CREATE INDEX IF NOT EXISTS idx_qr_active ON QuestionnaireResponse(tenant_id, IsActive);

-- 3c. Questionnaire Items
CREATE TABLE IF NOT EXISTS QuestionnaireItem (
    ItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    QuestionnaireId INTEGER NOT NULL,
    ItemCode TEXT,
    ItemPath TEXT NOT NULL,
    Text TEXT NOT NULL,
    ItemType TEXT NOT NULL,
    Required INTEGER DEFAULT 0,
    AnswerOptions TEXT,
    MinValue REAL,
    MaxValue REAL,
    ScoreWeight REAL DEFAULT 1,
    ScoreMapping TEXT,
    DisplayOrder INTEGER DEFAULT 0,
    FOREIGN KEY (QuestionnaireId) REFERENCES Questionnaire(QuestionnaireId)
);
CREATE INDEX IF NOT EXISTS idx_qi_tenant ON QuestionnaireItem(tenant_id, QuestionnaireId);

-- 3d. Score Interpretations
CREATE TABLE IF NOT EXISTS QuestionnaireScoreInterpretation (
    InterpretationId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    QuestionnaireId INTEGER NOT NULL,
    MinScore REAL NOT NULL,
    MaxScore REAL NOT NULL,
    Interpretation TEXT NOT NULL,
    Description TEXT,
    Recommendation TEXT,
    Icd10Code TEXT,
    DisplayOrder INTEGER DEFAULT 0,
    FOREIGN KEY (QuestionnaireId) REFERENCES Questionnaire(QuestionnaireId)
);
CREATE INDEX IF NOT EXISTS idx_qsi_tenant ON QuestionnaireScoreInterpretation(tenant_id, QuestionnaireId);

-- =====================================================================
-- 4. PRIOR AUTHORIZATION
-- =====================================================================

-- 4a. Prior Authorization Requests
CREATE TABLE IF NOT EXISTS PriorAuthorization (
    AuthId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER NOT NULL,
    RequestDate TEXT NOT NULL,
    RequestType TEXT NOT NULL,
    Priority TEXT DEFAULT 'routine',
    ServiceCode TEXT NOT NULL,
    ServiceDescription TEXT NOT NULL,
    ServiceDate TEXT,
    DiagnosisCodes TEXT NOT NULL,
    OrderingProviderId INTEGER NOT NULL,
    RenderingProviderId INTEGER,
    InsuranceId INTEGER,
    InsuranceCompany TEXT,
    PolicyNumber TEXT,
    GroupNumber TEXT,
    AuthNumber TEXT,
    AuthStatus TEXT DEFAULT 'pending',
    AuthDate TEXT,
    AuthStartDate TEXT,
    AuthEndDate TEXT,
    AuthQuantity INTEGER,
    AuthUnits TEXT,
    ApprovedAmount REAL,
    PatientResponsibility REAL,
    DenialCode TEXT,
    DenialReason TEXT,
    ClinicalNotes TEXT,
    Attachments TEXT,
    ExternalAuthId TEXT,
    SubmittedById INTEGER,
    SubmittedDate TEXT,
    ReviewedById INTEGER,
    ReviewedDate TEXT,
    IsActive INTEGER DEFAULT 1,
    DeletedAt TEXT,
    DeletedById INTEGER,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_prior_auth_tenant ON PriorAuthorization(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prior_auth_patient ON PriorAuthorization(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_prior_auth_status ON PriorAuthorization(tenant_id, AuthStatus);
CREATE INDEX IF NOT EXISTS idx_prior_auth_active ON PriorAuthorization(tenant_id, IsActive);

-- 4b. Prior Authorization Items
CREATE TABLE IF NOT EXISTS PriorAuthorizationItem (
    ItemId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    AuthId INTEGER NOT NULL,
    ItemSequence INTEGER NOT NULL,
    ServiceCode TEXT NOT NULL,
    ServiceDescription TEXT NOT NULL,
    Quantity INTEGER DEFAULT 1,
    UnitPrice REAL,
    TotalPrice REAL,
    AuthStatus TEXT DEFAULT 'pending',
    AuthNumber TEXT,
    AuthQuantity INTEGER,
    DenialCode TEXT,
    DenialReason TEXT,
    FOREIGN KEY (AuthId) REFERENCES PriorAuthorization(AuthId)
);
CREATE INDEX IF NOT EXISTS idx_prior_auth_item_tenant ON PriorAuthorizationItem(tenant_id, AuthId);

-- 4c. Prior Authorization Communications
CREATE TABLE IF NOT EXISTS PriorAuthorizationCommunication (
    CommunicationId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    AuthId INTEGER NOT NULL,
    CommunicationType TEXT NOT NULL,
    CommunicationDate TEXT NOT NULL,
    Direction TEXT NOT NULL,
    ContactName TEXT,
    ContactPhone TEXT,
    ContactFax TEXT,
    ContactEmail TEXT,
    ContactOrganization TEXT,
    Subject TEXT,
    Notes TEXT,
    Attachments TEXT,
    FollowupRequired INTEGER DEFAULT 0,
    FollowupDate TEXT,
    FollowupNotes TEXT,
    CreatedById INTEGER NOT NULL,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (AuthId) REFERENCES PriorAuthorization(AuthId)
);
CREATE INDEX IF NOT EXISTS idx_prior_auth_comm_tenant ON PriorAuthorizationCommunication(tenant_id, AuthId);

-- 4d. Prior Authorization Templates
CREATE TABLE IF NOT EXISTS PriorAuthorizationTemplate (
    TemplateId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    TemplateName TEXT NOT NULL,
    RequestType TEXT NOT NULL,
    ServiceCode TEXT,
    ServiceDescription TEXT,
    DefaultPriority TEXT DEFAULT 'routine',
    RequiredFields TEXT,
    ClinicalCriteria TEXT,
    InsuranceCompanyId INTEGER,
    PayerAuthRules TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prior_auth_template_tenant ON PriorAuthorizationTemplate(tenant_id);
