import json
import os

target_files = [
    'apps/ozzyl-lifestyle/public/locales/en/patients.json',
    'apps/ozzyl-lifestyle/public/locales/bn/patients.json'
]

def replace_term(text, lang):
    if not isinstance(text, str):
        return text
    if lang == 'en':
        text = text.replace('Patient Portal', 'Ozzyl Lifestyle')
        text = text.replace('patient portal', 'Ozzyl Lifestyle')
        text = text.replace('Patient dashboard', 'Customer dashboard')
        text = text.replace('patient dashboard', 'customer dashboard')
        text = text.replace('Patient information', 'Customer information')
        text = text.replace('patient information', 'customer information')
        text = text.replace('Verified Patient', 'Verified Customer')
        text = text.replace('Patient Identity', 'Customer Identity')
        text = text.replace('Patient hub', 'Customer hub')
        text = text.replace('patient hub', 'customer hub')
        text = text.replace('Patient files', 'Customer files')
        text = text.replace('patient files', 'customer files')
        text = text.replace('Patient-entered', 'Self-entered')
        text = text.replace('patient-entered', 'self-entered')
        text = text.replace('patient-noted', 'self-noted')
        text = text.replace('Patient', 'Customer')
        text = text.replace('patient', 'customer')
    else:
        # Bengali
        text = text.replace('পেশেন্ট পোর্টাল', 'ওজিল লাইফস্টাইল')
        text = text.replace('রোগী পোর্টাল', 'ওজিল লাইফস্টাইল')
        text = text.replace('পেশেন্ট ড্যাশবোর্ড', 'গ্রাহক ড্যাশবোর্ড')
        text = text.replace('রোগীর ড্যাশবোর্ড', 'গ্রাহক ড্যাশবোর্ড')
        text = text.replace('রোগীর পরিচয়', 'গ্রাহকের পরিচয়')
        text = text.replace('যাচাইকৃত রোগী', 'যাচাইকৃত গ্রাহক')
        text = text.replace('পেশেন্ট হিসেবে', 'গ্রাহক হিসেবে')
        text = text.replace('রোগী', 'সদস্য')
        text = text.replace('পেশেন্ট', 'সদস্য')
    return text

def modify_dict(d, lang):
    for k, v in d.items():
        if isinstance(v, str):
            d[k] = replace_term(v, lang)
        elif isinstance(v, dict):
            modify_dict(v, lang)

for fpath in target_files:
    if not os.path.exists(fpath):
        print("Not found:", fpath)
        continue
    
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    lang = 'en' if '/en/' in fpath else 'bn'
    
    if 'patientDashboard' in data:
        modify_dict(data['patientDashboard'], lang)
    if 'patientLogin' in data:
        modify_dict(data['patientLogin'], lang)
    if 'patientDuplicates' in data:
        # Maybe not necessary but good
        pass

    # Let's also modify general terms that match "Patient Portal" at the root level
    if 'patientPortal' in data:
        data['patientPortal'] = replace_term(data['patientPortal'], lang)
        
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("Updated translations.")
