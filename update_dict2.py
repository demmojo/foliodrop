import re

with open('frontend/src/i18n/dictionaries.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_keys = {
    'en': {'close': 'Close'},
    'sk': {'close': 'Zavrieť'},
    'es': {'close': 'Cerrar'},
    'it': {'close': 'Chiudi'},
    'el': {'close': 'Κλείσιμο'}
}

for lang, keys in new_keys.items():
    pattern_end = r"(  " + lang + r": {[\s\S]*?)(  },)"
    
    def repl_end(m):
        block = m.group(1)
        if block.strip().endswith(','):
            pass
        else:
            block = block.rstrip() + ',\n'
        
        add = f"    close: '{keys['close']}'\n"
        return block + add + m.group(2)
        
    content = re.sub(pattern_end, repl_end, content, count=1)

with open('frontend/src/i18n/dictionaries.ts', 'w', encoding='utf-8') as f:
    f.write(content)
