import re

with open('frontend/src/i18n/dictionaries.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_keys = {
    'en': {
        'drop_brackets': 'Drag and drop your bracketed sequences. Our engine will align, fuse, and color-grade to architectural standards.',
        'load': 'Load',
        'sequence_identified': 'Sequence Identified',
        'commence_processing': 'Commence Processing',
        'cancel': 'Cancel'
    },
    'sk': {
        'drop_brackets': 'Potiahnite a pustite svoje sady expozícií. Náš nástroj ich zarovná, zlúči a farebne upraví podľa architektonických štandardov.',
        'load': 'Načítať',
        'sequence_identified': 'Sekvencia identifikovaná',
        'commence_processing': 'Začať spracovanie',
        'cancel': 'Zrušiť'
    },
    'es': {
        'drop_brackets': 'Arrastre y suelte sus secuencias. Nuestro motor alineará, fusionará y corregirá el color según estándares arquitectónicos.',
        'load': 'Cargar',
        'sequence_identified': 'Secuencia identificada',
        'commence_processing': 'Comenzar procesamiento',
        'cancel': 'Cancelar'
    },
    'it': {
        'drop_brackets': 'Trascina e rilascia le tue sequenze. Il nostro motore allineerà, fonderà e correggerà il colore secondo standard architettonici.',
        'load': 'Carica',
        'sequence_identified': 'Sequenza identificata',
        'commence_processing': 'Inizia elaborazione',
        'cancel': 'Annulla'
    },
    'el': {
        'drop_brackets': 'Σύρετε και αφήστε τις ακολουθίες σας. Η μηχανή μας θα ευθυγραμμίσει, θα συγχωνεύσει και θα διορθώσει το χρώμα σύμφωνα με τα αρχιτεκτονικά πρότυπα.',
        'load': 'Φόρτωση',
        'sequence_identified': 'Η ακολουθία αναγνωρίστηκε',
        'commence_processing': 'Έναρξη επεξεργασίας',
        'cancel': 'Ακύρωση'
    }
}

for lang, keys in new_keys.items():
    # replace drop_brackets
    pattern = r"(  " + lang + r": {[\s\S]*?)(    drop_brackets: ')([^']+)(')"
    content = re.sub(pattern, lambda m: m.group(1) + m.group(2) + keys['drop_brackets'] + m.group(4), content, count=1)
    
    # insert other keys at the end of the lang block
    pattern_end = r"(  " + lang + r": {[\s\S]*?)(  },)"
    
    def repl_end(m):
        block = m.group(1)
        if block.strip().endswith(','):
            pass
        else:
            block = block.rstrip() + ',\n'
        
        add = f"    load: '{keys['load']}',\n    sequence_identified: '{keys['sequence_identified']}',\n    commence_processing: '{keys['commence_processing']}',\n    cancel: '{keys['cancel']}'\n"
        return block + add + m.group(2)
        
    content = re.sub(pattern_end, repl_end, content, count=1)

with open('frontend/src/i18n/dictionaries.ts', 'w', encoding='utf-8') as f:
    f.write(content)
