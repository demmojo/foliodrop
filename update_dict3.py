import re

with open('frontend/src/i18n/dictionaries.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_keys = {
    'en': {
        'hdr_fusion_engine': 'HDR Fusion Engine',
        'critical_inspection': 'Critical Inspection',
        'before_raw': 'Before: Raw Bracket'
    },
    'sk': {
        'hdr_fusion_engine': 'Nástroj na zlučovanie HDR',
        'critical_inspection': 'Kritická kontrola',
        'before_raw': 'Pred: Surová expozícia'
    },
    'es': {
        'hdr_fusion_engine': 'Motor de Fusión HDR',
        'critical_inspection': 'Inspección crítica',
        'before_raw': 'Antes: Soporte original'
    },
    'it': {
        'hdr_fusion_engine': 'Motore di Fusione HDR',
        'critical_inspection': 'Ispezione critica',
        'before_raw': 'Prima: Scatto originale'
    },
    'el': {
        'hdr_fusion_engine': 'Μηχανή συγχώνευσης HDR',
        'critical_inspection': 'Κρίσιμη επιθεώρηση',
        'before_raw': 'Πριν: Αρχική λήψη'
    }
}

for lang, keys in new_keys.items():
    pattern_end = r"(  " + lang + r": {[\s\S]*?)(  },)"
    
    def repl_end(m):
        block = m.group(1)
        if block.strip().endswith(','):
            pass
        else:
            block = block.rstrip() + ',\n'
        
        add = f"    hdr_fusion_engine: '{keys['hdr_fusion_engine']}',\n    critical_inspection: '{keys['critical_inspection']}',\n    before_raw: '{keys['before_raw']}'\n"
        return block + add + m.group(2)
        
    content = re.sub(pattern_end, repl_end, content, count=1)

with open('frontend/src/i18n/dictionaries.ts', 'w', encoding='utf-8') as f:
    f.write(content)
