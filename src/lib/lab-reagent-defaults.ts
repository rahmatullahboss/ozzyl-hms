export interface DefaultLabConsumable {
  code: string;
  name: string;
  category: 'reagent' | 'tube' | 'strip' | 'film' | 'chemical' | 'kit' | 'slide' | 'syringe' | 'other';
  unit: string;
  unitPrice: number;
  reorderLevel: number;
  reorderQty: number;
  storageCondition?: string | null;
  description?: string | null;
}

export interface DefaultLabTestReagentProfile {
  testCode: string;
  testName: string;
  testCategory: string;
  testPrice: number;
  aliases?: string[];
  consumables: Array<DefaultLabConsumable & {
    qtyPerTest: number;
    mandatory?: boolean;
    notes?: string | null;
  }>;
}

const TEST_EQUIVALENT_NOTE = 'Default no-LIS starter value: 1 test-equivalent. Validate/override per analyzer kit IFU and hospital SOP.';
const COLLECTION_NOTE = 'Default collection consumable; disable if this item is tracked separately or not used by the hospital.';
const NON_REAGENT_NOTE = 'Default diagnostic consumable starter value. Validate/override per device, kit, and hospital SOP.';

type DefaultMappedConsumable = DefaultLabConsumable & {
  qtyPerTest: number;
  mandatory?: boolean;
  notes?: string | null;
};

function reagentTest(code: string, name: string, description: string, reorderLevel = 100, reorderQty = 500): DefaultMappedConsumable {
  return {
    code,
    name,
    category: 'reagent',
    unit: 'test',
    unitPrice: 0,
    reorderLevel,
    reorderQty,
    storageCondition: '2-8C or per kit IFU',
    description,
    qtyPerTest: 1,
    notes: TEST_EQUIVALENT_NOTE,
  };
}

function kitTest(code: string, name: string, description: string, reorderLevel = 20, reorderQty = 100): DefaultMappedConsumable {
  return {
    code,
    name,
    category: 'kit',
    unit: 'test',
    unitPrice: 0,
    reorderLevel,
    reorderQty,
    storageCondition: 'Per analyzer/kit IFU',
    description,
    qtyPerTest: 1,
    notes: TEST_EQUIVALENT_NOTE,
  };
}

function pieceConsumable(code: string, name: string, description: string, storageCondition = 'Room temperature'): DefaultMappedConsumable {
  return {
    code,
    name,
    category: 'other',
    unit: 'pcs',
    unitPrice: 0,
    reorderLevel: 100,
    reorderQty: 500,
    storageCondition,
    description,
    qtyPerTest: 1,
    notes: COLLECTION_NOTE,
  };
}

function filmTest(code: string, name: string, description: string, reorderLevel = 50, reorderQty = 200): DefaultMappedConsumable {
  return {
    code,
    name,
    category: 'film',
    unit: 'test',
    unitPrice: 0,
    reorderLevel,
    reorderQty,
    storageCondition: 'Room temperature',
    description,
    qtyPerTest: 1,
    notes: NON_REAGENT_NOTE,
  };
}

function gelTest(code: string, name: string, description: string, reorderLevel = 50, reorderQty = 200): DefaultMappedConsumable {
  return {
    code,
    name,
    category: 'other',
    unit: 'test',
    unitPrice: 0,
    reorderLevel,
    reorderQty,
    storageCondition: 'Room temperature',
    description,
    qtyPerTest: 1,
    notes: NON_REAGENT_NOTE,
  };
}

export const DEFAULT_LAB_TEST_REAGENT_PROFILES: DefaultLabTestReagentProfile[] = [
  {
    testCode: 'CBC',
    testName: 'Complete Blood Count',
    testCategory: 'Hematology',
    testPrice: 500,
    aliases: ['CBC', 'Complete Blood Count'],
    consumables: [
      { code: 'CBC-REAGENT-TEST', name: 'CBC reagent pack - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: 'Per analyzer/kit IFU', description: 'Generic CBC analyzer reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
      { code: 'EDTA-TUBE', name: 'EDTA sample tube', category: 'tube', unit: 'pcs', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: 'Room temperature', description: 'Default CBC blood collection tube', qtyPerTest: 1, notes: 'Default collection consumable; disable if tubes are tracked separately.' },
    ],
  },
  {
    testCode: 'ESR',
    testName: 'ESR',
    testCategory: 'Hematology',
    testPrice: 150,
    aliases: ['ESR', 'Erythrocyte Sedimentation Rate'],
    consumables: [
      { code: 'ESR-TUBE-TEST', name: 'ESR tube/kit - test equivalent', category: 'tube', unit: 'test', unitPrice: 0, reorderLevel: 50, reorderQty: 200, storageCondition: 'Per kit IFU', description: 'Generic ESR tube or kit test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'RBS',
    testName: 'Random Blood Sugar',
    testCategory: 'Biochemistry',
    testPrice: 150,
    aliases: ['RBS', 'Random Blood Sugar', 'Blood Sugar Random'],
    consumables: [
      { code: 'GLUCOSE-REAGENT-TEST', name: 'Glucose reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic glucose chemistry reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'FBS',
    testName: 'Fasting Blood Sugar',
    testCategory: 'Biochemistry',
    testPrice: 150,
    aliases: ['FBS', 'BSF', 'Fasting Blood Sugar', 'Blood Sugar Fasting'],
    consumables: [
      { code: 'GLUCOSE-REAGENT-TEST', name: 'Glucose reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic glucose chemistry reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'PPBS',
    testName: 'Blood Sugar 2hr PP',
    testCategory: 'Biochemistry',
    testPrice: 150,
    aliases: ['PPBS', 'BS2H', 'Blood Sugar 2hr PP', 'Blood Sugar 2 Hour PP', 'Postprandial Blood Sugar'],
    consumables: [
      { code: 'GLUCOSE-REAGENT-TEST', name: 'Glucose reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic glucose chemistry reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'HBA1C',
    testName: 'HbA1c',
    testCategory: 'Biochemistry',
    testPrice: 800,
    aliases: ['HBA1C', 'HbA1c', 'Glycated Hemoglobin'],
    consumables: [
      { code: 'HBA1C-REAGENT-TEST', name: 'HbA1c reagent/cartridge - test equivalent', category: 'kit', unit: 'test', unitPrice: 0, reorderLevel: 20, reorderQty: 100, storageCondition: 'Per analyzer/kit IFU', description: 'Generic HbA1c cartridge/reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'CREAT',
    testName: 'Serum Creatinine',
    testCategory: 'Biochemistry',
    testPrice: 400,
    aliases: ['CREAT', 'Creatinine', 'Serum Creatinine'],
    consumables: [
      { code: 'CREATININE-REAGENT-TEST', name: 'Creatinine reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic creatinine chemistry reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'LIPID',
    testName: 'Lipid Profile',
    testCategory: 'Biochemistry',
    testPrice: 800,
    aliases: ['LIPID', 'Lipid Profile'],
    consumables: [
      { code: 'CHOL-REAGENT-TEST', name: 'Total cholesterol reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic total cholesterol reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
      { code: 'TG-REAGENT-TEST', name: 'Triglycerides reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic triglycerides reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
      { code: 'HDL-REAGENT-TEST', name: 'HDL cholesterol reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic HDL reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
      { code: 'LDL-REAGENT-TEST', name: 'LDL reagent - test equivalent', category: 'reagent', unit: 'test', unitPrice: 0, reorderLevel: 100, reorderQty: 500, storageCondition: '2-8C or per kit IFU', description: 'Generic LDL reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },
  {
    testCode: 'LFT',
    testName: 'Liver Function Test',
    testCategory: 'Biochemistry',
    testPrice: 600,
    aliases: ['LFT', 'Liver Function Test', 'Liver Profile'],
    consumables: [
      reagentTest('ALT-REAGENT-TEST', 'ALT reagent - test equivalent', 'Generic ALT reagent test equivalent'),
      reagentTest('AST-REAGENT-TEST', 'AST reagent - test equivalent', 'Generic AST reagent test equivalent'),
      reagentTest('ALP-REAGENT-TEST', 'ALP reagent - test equivalent', 'Generic ALP reagent test equivalent'),
      reagentTest('BIL-T-REAGENT-TEST', 'Total bilirubin reagent - test equivalent', 'Generic total bilirubin reagent test equivalent'),
      reagentTest('BIL-D-REAGENT-TEST', 'Direct bilirubin reagent - test equivalent', 'Generic direct bilirubin reagent test equivalent'),
      reagentTest('TP-REAGENT-TEST', 'Total protein reagent - test equivalent', 'Generic total protein reagent test equivalent'),
      reagentTest('ALB-REAGENT-TEST', 'Albumin reagent - test equivalent', 'Generic albumin reagent test equivalent'),
    ],
  },
  {
    testCode: 'KFT',
    testName: 'Kidney Function Test',
    testCategory: 'Biochemistry',
    testPrice: 600,
    aliases: ['KFT', 'RFT', 'Renal Function Test', 'Kidney Function Test', 'Renal Profile', 'Kidney Profile'],
    consumables: [
      reagentTest('UREA-REAGENT-TEST', 'Urea reagent - test equivalent', 'Generic urea chemistry reagent test equivalent'),
      reagentTest('CREATININE-REAGENT-TEST', 'Creatinine reagent - test equivalent', 'Generic creatinine chemistry reagent test equivalent'),
      reagentTest('URIC-ACID-REAGENT-TEST', 'Uric acid reagent - test equivalent', 'Generic uric acid chemistry reagent test equivalent'),
    ],
  },
  {
    testCode: 'TSH',
    testName: 'TSH',
    testCategory: 'Hormone',
    testPrice: 700,
    aliases: ['TSH', 'Thyroid Stimulating Hormone'],
    consumables: [
      { code: 'TSH-REAGENT-TEST', name: 'TSH reagent/cartridge - test equivalent', category: 'kit', unit: 'test', unitPrice: 0, reorderLevel: 20, reorderQty: 100, storageCondition: '2-8C or per kit IFU', description: 'Generic TSH immunoassay reagent test equivalent', qtyPerTest: 1, notes: TEST_EQUIVALENT_NOTE },
    ],
  },

  // Hematology / blood bank starter profiles
  {
    testCode: 'HB',
    testName: 'Hemoglobin',
    testCategory: 'Hematology',
    testPrice: 150,
    aliases: ['HB', 'Hb%', 'Hemoglobin', 'Haemoglobin'],
    consumables: [reagentTest('HB-REAGENT-TEST', 'Hemoglobin reagent - test equivalent', 'Generic hemoglobin reagent test equivalent'), pieceConsumable('EDTA-TUBE', 'EDTA sample tube', 'Default blood collection tube')],
  },
  {
    testCode: 'PLT',
    testName: 'Platelet Count',
    testCategory: 'Hematology',
    testPrice: 250,
    aliases: ['PLT', 'Platelet', 'Platelet Count'],
    consumables: [reagentTest('CBC-REAGENT-TEST', 'CBC reagent pack - test equivalent', 'Generic CBC analyzer reagent test equivalent'), pieceConsumable('EDTA-TUBE', 'EDTA sample tube', 'Default blood collection tube')],
  },
  {
    testCode: 'BLOOD-GROUP',
    testName: 'Blood Grouping and Rh Typing',
    testCategory: 'Hematology',
    testPrice: 200,
    aliases: ['Blood Group', 'Blood Grouping', 'ABO', 'Rh Typing', 'ABO/Rh'],
    consumables: [reagentTest('ANTI-A-REAGENT-TEST', 'Anti-A reagent - test equivalent', 'Generic blood grouping Anti-A reagent test equivalent'), reagentTest('ANTI-B-REAGENT-TEST', 'Anti-B reagent - test equivalent', 'Generic blood grouping Anti-B reagent test equivalent'), reagentTest('ANTI-D-REAGENT-TEST', 'Anti-D reagent - test equivalent', 'Generic Rh typing Anti-D reagent test equivalent')],
  },
  {
    testCode: 'BT-CT',
    testName: 'Bleeding Time and Clotting Time',
    testCategory: 'Hematology',
    testPrice: 250,
    aliases: ['BT', 'CT', 'BT CT', 'Bleeding Time', 'Clotting Time'],
    consumables: [pieceConsumable('LANCET', 'Sterile lancet', 'Default lancet for capillary sample'), pieceConsumable('CAPILLARY-TUBE', 'Capillary tube', 'Default capillary tube consumable')],
  },
  {
    testCode: 'MP',
    testName: 'Malarial Parasite',
    testCategory: 'Hematology',
    testPrice: 300,
    aliases: ['MP', 'MPS', 'Malaria Parasite', 'Malarial Parasite', 'Malarial Parasite Screen'],
    consumables: [pieceConsumable('MICROSCOPE-SLIDE', 'Microscope slide', 'Default microscopy slide'), reagentTest('GIEMSA-STAIN-TEST', 'Giemsa stain - test equivalent', 'Generic microscopy stain test equivalent')],
  },

  // Biochemistry individual tests commonly sold outside panels
  { testCode: 'UREA', testName: 'Blood Urea', testCategory: 'Biochemistry', testPrice: 300, aliases: ['Urea', 'Blood Urea', 'Serum Urea'], consumables: [reagentTest('UREA-REAGENT-TEST', 'Urea reagent - test equivalent', 'Generic urea chemistry reagent test equivalent')] },
  { testCode: 'URIC-ACID', testName: 'Serum Uric Acid', testCategory: 'Biochemistry', testPrice: 300, aliases: ['Uric Acid', 'Serum Uric Acid'], consumables: [reagentTest('URIC-ACID-REAGENT-TEST', 'Uric acid reagent - test equivalent', 'Generic uric acid chemistry reagent test equivalent')] },
  { testCode: 'SGPT', testName: 'SGPT / ALT', testCategory: 'Biochemistry', testPrice: 300, aliases: ['SGPT', 'ALT', 'Alanine Aminotransferase'], consumables: [reagentTest('ALT-REAGENT-TEST', 'ALT reagent - test equivalent', 'Generic ALT reagent test equivalent')] },
  { testCode: 'SGOT', testName: 'SGOT / AST', testCategory: 'Biochemistry', testPrice: 300, aliases: ['SGOT', 'AST', 'Aspartate Aminotransferase'], consumables: [reagentTest('AST-REAGENT-TEST', 'AST reagent - test equivalent', 'Generic AST reagent test equivalent')] },
  { testCode: 'ALP', testName: 'Alkaline Phosphatase', testCategory: 'Biochemistry', testPrice: 300, aliases: ['ALP', 'Alkaline Phosphatase'], consumables: [reagentTest('ALP-REAGENT-TEST', 'ALP reagent - test equivalent', 'Generic ALP reagent test equivalent')] },
  { testCode: 'BILIRUBIN', testName: 'Bilirubin Total/Direct', testCategory: 'Biochemistry', testPrice: 350, aliases: ['Bilirubin', 'BILT', 'S Bilirubin', 'Total Bilirubin', 'Direct Bilirubin', 'Serum Bilirubin (Total)'], consumables: [reagentTest('BIL-T-REAGENT-TEST', 'Total bilirubin reagent - test equivalent', 'Generic total bilirubin reagent test equivalent'), reagentTest('BIL-D-REAGENT-TEST', 'Direct bilirubin reagent - test equivalent', 'Generic direct bilirubin reagent test equivalent')] },
  { testCode: 'CHOLESTEROL', testName: 'Total Cholesterol', testCategory: 'Biochemistry', testPrice: 300, aliases: ['Cholesterol', 'Total Cholesterol'], consumables: [reagentTest('CHOL-REAGENT-TEST', 'Total cholesterol reagent - test equivalent', 'Generic total cholesterol reagent test equivalent')] },
  { testCode: 'TRIGLYCERIDE', testName: 'Triglycerides', testCategory: 'Biochemistry', testPrice: 300, aliases: ['TG', 'Triglyceride', 'Triglycerides'], consumables: [reagentTest('TG-REAGENT-TEST', 'Triglycerides reagent - test equivalent', 'Generic triglycerides reagent test equivalent')] },
  { testCode: 'HDL', testName: 'HDL Cholesterol', testCategory: 'Biochemistry', testPrice: 400, aliases: ['HDL', 'HDL Cholesterol'], consumables: [reagentTest('HDL-REAGENT-TEST', 'HDL cholesterol reagent - test equivalent', 'Generic HDL reagent test equivalent')] },
  { testCode: 'LDL', testName: 'LDL Cholesterol', testCategory: 'Biochemistry', testPrice: 400, aliases: ['LDL', 'LDL Cholesterol'], consumables: [reagentTest('LDL-REAGENT-TEST', 'LDL reagent - test equivalent', 'Generic LDL reagent test equivalent')] },
  { testCode: 'ELECTROLYTES', testName: 'Serum Electrolytes', testCategory: 'Biochemistry', testPrice: 700, aliases: ['Electrolytes', 'Na K Cl', 'Sodium Potassium Chloride'], consumables: [kitTest('ELECTROLYTE-REAGENT-TEST', 'Electrolyte reagent/electrode pack - test equivalent', 'Generic electrolyte analyzer reagent or electrode test equivalent', 50, 200)] },
  { testCode: 'CALCIUM', testName: 'Serum Calcium', testCategory: 'Biochemistry', testPrice: 350, aliases: ['Calcium', 'Serum Calcium', 'Ca'], consumables: [reagentTest('CALCIUM-REAGENT-TEST', 'Calcium reagent - test equivalent', 'Generic calcium chemistry reagent test equivalent')] },
  { testCode: 'AMYLASE', testName: 'Serum Amylase', testCategory: 'Biochemistry', testPrice: 600, aliases: ['Amylase', 'Serum Amylase'], consumables: [reagentTest('AMYLASE-REAGENT-TEST', 'Amylase reagent - test equivalent', 'Generic amylase chemistry reagent test equivalent', 50, 200)] },
  { testCode: 'LIPASE', testName: 'Serum Lipase', testCategory: 'Biochemistry', testPrice: 800, aliases: ['Lipase', 'Serum Lipase'], consumables: [reagentTest('LIPASE-REAGENT-TEST', 'Lipase reagent - test equivalent', 'Generic lipase chemistry reagent test equivalent', 50, 200)] },

  // Hormone / immunoassay profiles
  { testCode: 'T3', testName: 'T3', testCategory: 'Hormone', testPrice: 600, aliases: ['T3', 'Triiodothyronine'], consumables: [kitTest('T3-REAGENT-TEST', 'T3 reagent/cartridge - test equivalent', 'Generic T3 immunoassay test equivalent')] },
  { testCode: 'T4', testName: 'T4', testCategory: 'Hormone', testPrice: 600, aliases: ['T4', 'Thyroxine'], consumables: [kitTest('T4-REAGENT-TEST', 'T4 reagent/cartridge - test equivalent', 'Generic T4 immunoassay test equivalent')] },
  { testCode: 'FT4', testName: 'Free T4', testCategory: 'Hormone', testPrice: 700, aliases: ['FT4', 'Free T4'], consumables: [kitTest('FT4-REAGENT-TEST', 'Free T4 reagent/cartridge - test equivalent', 'Generic FT4 immunoassay test equivalent')] },
  { testCode: 'BETA-HCG', testName: 'Beta hCG', testCategory: 'Hormone', testPrice: 800, aliases: ['Beta HCG', 'bHCG', 'Serum Pregnancy Test'], consumables: [kitTest('BETA-HCG-REAGENT-TEST', 'Beta hCG reagent/cartridge - test equivalent', 'Generic beta hCG immunoassay test equivalent')] },

  // Serology / rapid card profiles
  { testCode: 'CRP', testName: 'C-Reactive Protein', testCategory: 'Serology', testPrice: 500, aliases: ['CRP', 'C Reactive Protein'], consumables: [kitTest('CRP-KIT-TEST', 'CRP kit - test equivalent', 'Generic CRP latex/card/quantitative kit test equivalent')] },
  { testCode: 'RF', testName: 'Rheumatoid Factor', testCategory: 'Serology', testPrice: 500, aliases: ['RF', 'Rheumatoid Factor'], consumables: [kitTest('RF-KIT-TEST', 'RF kit - test equivalent', 'Generic RF latex/card/quantitative kit test equivalent')] },
  { testCode: 'ASO', testName: 'ASO Titre', testCategory: 'Serology', testPrice: 500, aliases: ['ASO', 'ASO Titre', 'Anti Streptolysin O'], consumables: [kitTest('ASO-KIT-TEST', 'ASO kit - test equivalent', 'Generic ASO latex/card/quantitative kit test equivalent')] },
  { testCode: 'HBsAg', testName: 'HBsAg', testCategory: 'Serology', testPrice: 400, aliases: ['HBsAg', 'Hepatitis B Surface Antigen'], consumables: [kitTest('HBSAG-KIT-TEST', 'HBsAg kit - test equivalent', 'Generic HBsAg rapid/ELISA kit test equivalent')] },
  { testCode: 'HCV', testName: 'Anti-HCV', testCategory: 'Serology', testPrice: 600, aliases: ['HCV', 'ANTIHCV', 'Anti HCV', 'Anti-HCV', 'Anti-HCV Antibody'], consumables: [kitTest('HCV-KIT-TEST', 'Anti-HCV kit - test equivalent', 'Generic HCV rapid/ELISA kit test equivalent')] },
  { testCode: 'HIV', testName: 'HIV 1/2', testCategory: 'Serology', testPrice: 600, aliases: ['HIV', 'HIV 1/2', 'Anti HIV'], consumables: [kitTest('HIV-KIT-TEST', 'HIV kit - test equivalent', 'Generic HIV rapid/ELISA kit test equivalent')] },
  { testCode: 'VDRL', testName: 'VDRL/RPR', testCategory: 'Serology', testPrice: 400, aliases: ['VDRL', 'RPR'], consumables: [kitTest('VDRL-KIT-TEST', 'VDRL/RPR kit - test equivalent', 'Generic VDRL/RPR kit test equivalent')] },
  { testCode: 'DENGUE-NS1', testName: 'Dengue NS1 Antigen', testCategory: 'Serology', testPrice: 800, aliases: ['DENGUE', 'Dengue NS1', 'NS1', 'Dengue Antigen'], consumables: [kitTest('DENGUE-NS1-KIT-TEST', 'Dengue NS1 kit - test equivalent', 'Generic dengue NS1 rapid/ELISA kit test equivalent')] },
  { testCode: 'DENGUE-IGM-IGG', testName: 'Dengue IgM/IgG', testCategory: 'Serology', testPrice: 800, aliases: ['Dengue IgM', 'Dengue IgG', 'Dengue IgM IgG', 'Dengue Antibody'], consumables: [kitTest('DENGUE-IGM-IGG-KIT-TEST', 'Dengue IgM/IgG kit - test equivalent', 'Generic dengue antibody rapid/ELISA kit test equivalent')] },
  { testCode: 'WIDAL', testName: 'Widal Test', testCategory: 'Serology', testPrice: 500, aliases: ['Widal', 'Widal Test'], consumables: [kitTest('WIDAL-KIT-TEST', 'Widal kit - test equivalent', 'Generic Widal slide/tube kit test equivalent')] },
  { testCode: 'TYPHOID-IGM-IGG', testName: 'Typhoid IgM/IgG', testCategory: 'Serology', testPrice: 700, aliases: ['Typhoid IgM', 'Typhoid IgG', 'Typhoid IgM IgG'], consumables: [kitTest('TYPHOID-IGM-IGG-KIT-TEST', 'Typhoid IgM/IgG kit - test equivalent', 'Generic typhoid rapid kit test equivalent')] },
  { testCode: 'H-PYLORI', testName: 'H. pylori Antibody/Antigen', testCategory: 'Serology', testPrice: 700, aliases: ['H Pylori', 'H. pylori', 'Helicobacter pylori'], consumables: [kitTest('H-PYLORI-KIT-TEST', 'H. pylori kit - test equivalent', 'Generic H. pylori rapid/ELISA kit test equivalent')] },

  // Urine, stool, coagulation, cardiac and device consumables
  { testCode: 'URINE-RE', testName: 'Urine R/E', testCategory: 'Urine', testPrice: 200, aliases: ['URINE', 'Urine R/E', 'Urine RE', 'Urine Routine', 'Urine Routine Examination'], consumables: [pieceConsumable('URINE-CONTAINER', 'Urine container', 'Default urine sample container'), reagentTest('URINE-STRIP-TEST', 'Urine strip - test equivalent', 'Generic urine dipstick test equivalent')] },
  { testCode: 'PREG-TEST', testName: 'Urine Pregnancy Test', testCategory: 'Urine', testPrice: 300, aliases: ['Pregnancy Test', 'UPT', 'Urine Pregnancy Test'], consumables: [kitTest('PREGNANCY-CARD-TEST', 'Pregnancy test card - test equivalent', 'Generic urine pregnancy card test equivalent')] },
  { testCode: 'STOOL-RE', testName: 'Stool R/E', testCategory: 'Stool', testPrice: 250, aliases: ['STOOL', 'Stool R/E', 'Stool RE', 'Stool Routine', 'Stool Routine Examination'], consumables: [pieceConsumable('STOOL-CONTAINER', 'Stool container', 'Default stool sample container'), pieceConsumable('MICROSCOPE-SLIDE', 'Microscope slide', 'Default microscopy slide')] },
  { testCode: 'OCCULT-BLOOD', testName: 'Stool Occult Blood', testCategory: 'Stool', testPrice: 400, aliases: ['Occult Blood', 'FOBT', 'Stool Occult Blood'], consumables: [kitTest('OCCULT-BLOOD-KIT-TEST', 'Occult blood kit - test equivalent', 'Generic FOBT kit test equivalent')] },
  { testCode: 'PT-INR', testName: 'PT/INR', testCategory: 'Coagulation', testPrice: 700, aliases: ['PT', 'INR', 'PT INR', 'Prothrombin Time', 'Prothrombin Time (PT)'], consumables: [reagentTest('PT-REAGENT-TEST', 'PT reagent - test equivalent', 'Generic prothrombin time reagent test equivalent', 50, 200)] },
  { testCode: 'APTT', testName: 'APTT', testCategory: 'Coagulation', testPrice: 700, aliases: ['APTT', 'aPTT', 'Activated Partial Thromboplastin Time'], consumables: [reagentTest('APTT-REAGENT-TEST', 'APTT reagent - test equivalent', 'Generic APTT reagent test equivalent', 50, 200)] },
  { testCode: 'TROPONIN-I', testName: 'Troponin I', testCategory: 'Cardiac Marker', testPrice: 1200, aliases: ['TROPON', 'Troponin', 'Troponin I', 'cTnI'], consumables: [kitTest('TROPONIN-I-KIT-TEST', 'Troponin I kit - test equivalent', 'Generic troponin I rapid/quantitative kit test equivalent', 10, 50)] },
  { testCode: 'CK-MB', testName: 'CK-MB', testCategory: 'Cardiac Marker', testPrice: 800, aliases: ['CKMB', 'CK-MB'], consumables: [kitTest('CK-MB-KIT-TEST', 'CK-MB kit - test equivalent', 'Generic CK-MB rapid/quantitative kit test equivalent', 10, 50)] },

  // Specialty immunoassay, vitamin and fertility panels
  { testCode: 'FERRITIN', testName: 'Ferritin', testCategory: 'Immunoassay', testPrice: 1200, aliases: ['Ferritin', 'Serum Ferritin'], consumables: [kitTest('FERRITIN-REAGENT-TEST', 'Ferritin reagent/cartridge - test equivalent', 'Generic ferritin immunoassay test equivalent', 20, 100)] },
  { testCode: 'VIT-D', testName: 'Vitamin D', testCategory: 'Immunoassay', testPrice: 1800, aliases: ['Vitamin D', '25 OH Vitamin D', '25(OH)D', 'Vit D'], consumables: [kitTest('VIT-D-REAGENT-TEST', 'Vitamin D reagent/cartridge - test equivalent', 'Generic vitamin D immunoassay test equivalent', 10, 50)] },
  { testCode: 'VIT-B12', testName: 'Vitamin B12', testCategory: 'Immunoassay', testPrice: 1600, aliases: ['Vitamin B12', 'B12', 'Vit B12'], consumables: [kitTest('VIT-B12-REAGENT-TEST', 'Vitamin B12 reagent/cartridge - test equivalent', 'Generic vitamin B12 immunoassay test equivalent', 10, 50)] },
  { testCode: 'PSA', testName: 'PSA', testCategory: 'Immunoassay', testPrice: 1200, aliases: ['PSA', 'Prostate Specific Antigen'], consumables: [kitTest('PSA-REAGENT-TEST', 'PSA reagent/cartridge - test equivalent', 'Generic PSA immunoassay test equivalent', 20, 100)] },
  { testCode: 'PROLACTIN', testName: 'Prolactin', testCategory: 'Hormone', testPrice: 900, aliases: ['Prolactin', 'PRL'], consumables: [kitTest('PROLACTIN-REAGENT-TEST', 'Prolactin reagent/cartridge - test equivalent', 'Generic prolactin immunoassay test equivalent', 20, 100)] },
  { testCode: 'LH', testName: 'LH', testCategory: 'Hormone', testPrice: 900, aliases: ['LH', 'Luteinizing Hormone'], consumables: [kitTest('LH-REAGENT-TEST', 'LH reagent/cartridge - test equivalent', 'Generic LH immunoassay test equivalent', 20, 100)] },
  { testCode: 'FSH', testName: 'FSH', testCategory: 'Hormone', testPrice: 900, aliases: ['FSH', 'Follicle Stimulating Hormone'], consumables: [kitTest('FSH-REAGENT-TEST', 'FSH reagent/cartridge - test equivalent', 'Generic FSH immunoassay test equivalent', 20, 100)] },
  { testCode: 'TESTOSTERONE', testName: 'Testosterone', testCategory: 'Hormone', testPrice: 1200, aliases: ['Testosterone', 'Total Testosterone'], consumables: [kitTest('TESTOSTERONE-REAGENT-TEST', 'Testosterone reagent/cartridge - test equivalent', 'Generic testosterone immunoassay test equivalent', 20, 100)] },
  { testCode: 'PROGESTERONE', testName: 'Progesterone', testCategory: 'Hormone', testPrice: 1200, aliases: ['Progesterone'], consumables: [kitTest('PROGESTERONE-REAGENT-TEST', 'Progesterone reagent/cartridge - test equivalent', 'Generic progesterone immunoassay test equivalent', 20, 100)] },
  { testCode: 'E2', testName: 'Estradiol', testCategory: 'Hormone', testPrice: 1200, aliases: ['E2', 'Estradiol', 'Oestradiol'], consumables: [kitTest('E2-REAGENT-TEST', 'Estradiol reagent/cartridge - test equivalent', 'Generic estradiol immunoassay test equivalent', 20, 100)] },

  // Infection screening and microbiology starter profiles
  { testCode: 'COVID-AG', testName: 'COVID-19 Antigen', testCategory: 'Serology', testPrice: 800, aliases: ['COVID', 'COVID Antigen', 'COVID-19 Rapid Antigen', 'Covid-19 Ag', 'SARS-CoV-2 Antigen'], consumables: [kitTest('COVID-AG-KIT-TEST', 'COVID-19 antigen kit - test equivalent', 'Generic SARS-CoV-2 antigen kit test equivalent', 20, 100), pieceConsumable('SWAB', 'Sterile swab', 'Default swab collection consumable')] },
  { testCode: 'COVID-PCR', testName: 'COVID-19 PCR', testCategory: 'Molecular', testPrice: 2500, aliases: ['COVID PCR', 'RT PCR', 'SARS-CoV-2 PCR'], consumables: [kitTest('PCR-EXTRACTION-TEST', 'PCR extraction reagent - test equivalent', 'Generic molecular extraction reagent test equivalent', 10, 50), kitTest('COVID-PCR-REAGENT-TEST', 'COVID-19 PCR reagent - test equivalent', 'Generic SARS-CoV-2 PCR reagent test equivalent', 10, 50), pieceConsumable('VTM-TUBE', 'VTM tube', 'Default viral transport media tube consumable', '2-8C or per kit IFU')] },
  { testCode: 'URINE-CS', testName: 'Urine Culture and Sensitivity', testCategory: 'Microbiology', testPrice: 1200, aliases: ['UCR', 'Urine C/S', 'Urine CS', 'Urine Culture', 'Urine Culture Sensitivity', 'Urine Culture & Sensitivity'], consumables: [pieceConsumable('URINE-CONTAINER', 'Urine container', 'Default urine sample container'), kitTest('CULTURE-MEDIA-TEST', 'Culture media - test equivalent', 'Generic culture media plate/test equivalent', 50, 200), kitTest('AST-DISC-TEST', 'Antibiotic sensitivity disc set - test equivalent', 'Generic antibiotic sensitivity disc test equivalent', 50, 200)] },
  { testCode: 'BLOOD-CS', testName: 'Blood Culture and Sensitivity', testCategory: 'Microbiology', testPrice: 1800, aliases: ['Blood C/S', 'Blood CS', 'Blood Culture', 'Blood Culture Sensitivity'], consumables: [kitTest('BLOOD-CULTURE-BOTTLE-TEST', 'Blood culture bottle - test equivalent', 'Generic blood culture bottle test equivalent', 20, 100), kitTest('AST-DISC-TEST', 'Antibiotic sensitivity disc set - test equivalent', 'Generic antibiotic sensitivity disc test equivalent', 50, 200)] },
  { testCode: 'STOOL-CS', testName: 'Stool Culture and Sensitivity', testCategory: 'Microbiology', testPrice: 1200, aliases: ['Stool C/S', 'Stool CS', 'Stool Culture'], consumables: [pieceConsumable('STOOL-CONTAINER', 'Stool container', 'Default stool sample container'), kitTest('CULTURE-MEDIA-TEST', 'Culture media - test equivalent', 'Generic culture media plate/test equivalent', 50, 200), kitTest('AST-DISC-TEST', 'Antibiotic sensitivity disc set - test equivalent', 'Generic antibiotic sensitivity disc test equivalent', 50, 200)] },
  { testCode: 'THROAT-SWAB-CS', testName: 'Throat Swab Culture and Sensitivity', testCategory: 'Microbiology', testPrice: 1200, aliases: ['Throat Swab C/S', 'Throat Swab CS', 'Throat Culture'], consumables: [pieceConsumable('SWAB', 'Sterile swab', 'Default swab collection consumable'), kitTest('CULTURE-MEDIA-TEST', 'Culture media - test equivalent', 'Generic culture media plate/test equivalent', 50, 200), kitTest('AST-DISC-TEST', 'Antibiotic sensitivity disc set - test equivalent', 'Generic antibiotic sensitivity disc test equivalent', 50, 200)] },
  { testCode: 'SPUTUM-AFB', testName: 'Sputum AFB', testCategory: 'Microbiology', testPrice: 600, aliases: ['AFB', 'Sputum AFB', 'Acid Fast Bacilli'], consumables: [pieceConsumable('SPUTUM-CONTAINER', 'Sputum container', 'Default sputum sample container'), pieceConsumable('MICROSCOPE-SLIDE', 'Microscope slide', 'Default microscopy slide'), reagentTest('ZN-STAIN-TEST', 'Ziehl-Neelsen stain - test equivalent', 'Generic AFB stain test equivalent', 50, 200)] },
  { testCode: 'GRAM-STAIN', testName: 'Gram Stain', testCategory: 'Microbiology', testPrice: 500, aliases: ['Gram Stain', 'Gram staining'], consumables: [pieceConsumable('MICROSCOPE-SLIDE', 'Microscope slide', 'Default microscopy slide'), reagentTest('GRAM-STAIN-REAGENT-TEST', 'Gram stain reagent set - test equivalent', 'Generic Gram stain reagent test equivalent', 50, 200)] },
  { testCode: 'SEMEN-ANALYSIS', testName: 'Semen Analysis', testCategory: 'Andrology', testPrice: 700, aliases: ['Semen Analysis', 'Semen R/E', 'Semen RE'], consumables: [pieceConsumable('SEMEN-CONTAINER', 'Semen container', 'Default semen sample container'), pieceConsumable('MICROSCOPE-SLIDE', 'Microscope slide', 'Default microscopy slide')] },

  // Demo diagnostic/device consumable profiles used when diagnostic items are stored in lab_test_catalog
  { testCode: 'ECG', testName: 'ECG', testCategory: 'Cardiology', testPrice: 500, aliases: ['ECG', 'EKG', 'Electrocardiogram', 'Electrocardiogram (ECG)'], consumables: [{ code: 'ECG-PAPER-TEST', name: 'ECG thermal paper - test equivalent', category: 'other', unit: 'test', unitPrice: 0, reorderLevel: 50, reorderQty: 200, storageCondition: 'Room temperature', description: 'Default ECG paper test equivalent', qtyPerTest: 1, notes: NON_REAGENT_NOTE }] },
  { testCode: 'ECHO', testName: 'Echocardiography', testCategory: 'Cardiology', testPrice: 2500, aliases: ['ECHO', 'Echocardiography'], consumables: [gelTest('ULTRASOUND-GEL-TEST', 'Ultrasound gel - test equivalent', 'Default ultrasound/echo gel test equivalent')] },
  { testCode: 'CXR', testName: 'Chest X-Ray', testCategory: 'Radiology', testPrice: 400, aliases: ['CXR', 'Chest X-Ray', 'Chest Xray'], consumables: [filmTest('XRAY-FILM-TEST', 'X-Ray film/digital media - test equivalent', 'Default X-Ray film or digital media test equivalent')] },
  { testCode: 'ABDXR', testName: 'Abdomen X-Ray', testCategory: 'Radiology', testPrice: 400, aliases: ['ABDXR', 'Abdomen X-Ray', 'Abdomen Xray'], consumables: [filmTest('XRAY-FILM-TEST', 'X-Ray film/digital media - test equivalent', 'Default X-Ray film or digital media test equivalent')] },
  { testCode: 'USG', testName: 'Ultrasonogram — Whole Abdomen', testCategory: 'Ultrasound', testPrice: 800, aliases: ['USG', 'Ultrasonogram', 'Ultrasonogram — Whole Abdomen', 'Ultrasonogram - Whole Abdomen'], consumables: [gelTest('ULTRASOUND-GEL-TEST', 'Ultrasound gel - test equivalent', 'Default ultrasound/echo gel test equivalent')] },
  { testCode: 'USGLV', testName: 'Ultrasonogram — Lower Abdomen', testCategory: 'Ultrasound', testPrice: 600, aliases: ['USGLV', 'Ultrasonogram — Lower Abdomen', 'Ultrasonogram - Lower Abdomen'], consumables: [gelTest('ULTRASOUND-GEL-TEST', 'Ultrasound gel - test equivalent', 'Default ultrasound/echo gel test equivalent')] },
  { testCode: 'USGNCK', testName: 'Ultrasonogram — Neck', testCategory: 'Ultrasound', testPrice: 600, aliases: ['USGNCK', 'Ultrasonogram — Neck', 'Ultrasonogram - Neck'], consumables: [gelTest('ULTRASOUND-GEL-TEST', 'Ultrasound gel - test equivalent', 'Default ultrasound/echo gel test equivalent')] },
];

async function findOrCreateLabTest(db: D1Database, tenantId: string | number, profile: DefaultLabTestReagentProfile): Promise<number> {
  const aliases = [profile.testCode, profile.testName, ...(profile.aliases ?? [])];
  const codeAliases = aliases.map((v) => v.toUpperCase());
  const nameAliases = aliases.map((v) => v.toLowerCase());
  const existing = await db.prepare(`
    SELECT id FROM lab_test_catalog
    WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
      AND (UPPER(code) IN (${codeAliases.map(() => '?').join(',')}) OR lower(name) IN (${nameAliases.map(() => '?').join(',')}))
    ORDER BY CASE WHEN UPPER(code) = UPPER(?) THEN 0 ELSE 1 END, id
    LIMIT 1
  `).bind(tenantId, ...codeAliases, ...nameAliases, profile.testCode).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  const result = await db.prepare(`
    INSERT INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
    VALUES (?, ?, ?, ?, 1, ?)
  `).bind(profile.testCode, profile.testName, profile.testCategory, profile.testPrice, tenantId).run();
  return Number(result.meta.last_row_id ?? 0);
}

async function findOrCreateConsumable(db: D1Database, tenantId: string | number, consumable: DefaultLabConsumable): Promise<number> {
  const existing = await db.prepare(`
    SELECT id FROM lab_consumables
    WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
      AND (UPPER(code) = UPPER(?) OR lower(name) = lower(?))
    ORDER BY CASE WHEN UPPER(code) = UPPER(?) THEN 0 ELSE 1 END, id
    LIMIT 1
  `).bind(tenantId, consumable.code, consumable.name, consumable.code).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  const result = await db.prepare(`
    INSERT INTO lab_consumables
      (code, name, category, unit, unit_price, reorder_level, reorder_qty, storage_condition, description, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    consumable.code,
    consumable.name,
    consumable.category,
    consumable.unit,
    consumable.unitPrice,
    consumable.reorderLevel,
    consumable.reorderQty,
    consumable.storageCondition ?? null,
    consumable.description ?? null,
    tenantId,
  ).run();
  return Number(result.meta.last_row_id ?? 0);
}

export async function seedLabReagentDefaults(db: D1Database, tenantId: string | number): Promise<{ tests: number; consumables: number; mappings: number }> {
  let tests = 0;
  let consumables = 0;
  let mappings = 0;

  for (const profile of DEFAULT_LAB_TEST_REAGENT_PROFILES) {
    const labTestId = await findOrCreateLabTest(db, tenantId, profile);
    if (!labTestId) continue;
    tests += 1;

    for (const consumable of profile.consumables) {
      const consumableId = await findOrCreateConsumable(db, tenantId, consumable);
      if (!consumableId) continue;
      consumables += 1;

      const existingMap = await db.prepare(`
        SELECT id FROM lab_test_consumable_map
        WHERE tenant_id = ? AND lab_test_id = ? AND consumable_id = ?
        LIMIT 1
      `).bind(tenantId, labTestId, consumableId).first<{ id: number }>();
      if (existingMap?.id) continue;

      await db.prepare(`
        INSERT INTO lab_test_consumable_map (lab_test_id, consumable_id, qty_per_test, is_mandatory, notes, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        labTestId,
        consumableId,
        consumable.qtyPerTest,
        consumable.mandatory === false ? 0 : 1,
        consumable.notes ?? TEST_EQUIVALENT_NOTE,
        tenantId,
      ).run();
      mappings += 1;
    }
  }

  return { tests, consumables, mappings };
}
