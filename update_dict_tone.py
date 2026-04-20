import re

with open('frontend/src/i18n/dictionaries.ts', 'r', encoding='utf-8') as f:
    content = f.read()

updates = {
    'import_exposures': {
        'en': 'Upload Photos',
        'sk': 'Nahrať Fotografie',
        'es': 'Subir Fotos',
        'it': 'Carica Foto',
        'el': 'Ανέβασμα Φωτογραφιών'
    },
    'drop_brackets': {
        'en': "Drag and drop your photos. We'll automatically enhance them for your real estate listings.",
        'sk': 'Potiahnite a pustite vaše fotografie. Automaticky ich vylepšíme pre vaše ponuky nehnuteľností.',
        'es': 'Arrastre y suelte sus fotos. Las mejoraremos automáticamente para sus listados de bienes raíces.',
        'it': 'Trascina e rilascia le tue foto. Le miglioreremo automaticamente per i tuoi annunci immobiliari.',
        'el': 'Σύρετε και αφήστε τις φωτογραφίες σας. Θα τις βελτιώσουμε αυτόματα για τις αγγελίες ακινήτων σας.'
    },
    'resume_previous_session': {
        'en': 'Resume previous upload',
        'sk': 'Obnoviť predchádzajúce nahrávanie',
        'es': 'Reanudar carga anterior',
        'it': 'Riprendi caricamento precedente',
        'el': 'Συνέχιση προηγούμενης μεταφόρτωσης'
    },
    'sequence_identified': {
        'en': 'Photos Ready',
        'sk': 'Fotografie pripravené',
        'es': 'Fotos Listas',
        'it': 'Foto Pronte',
        'el': 'Φωτογραφίες Έτοιμες'
    },
    'ready_for_fusion': {
        'en': 'Ready to Enhance',
        'sk': 'Pripravené na vylepšenie',
        'es': 'Listo para mejorar',
        'it': 'Pronto per il miglioramento',
        'el': 'Έτοιμο για Βελτίωση'
    },
    'raw_brackets': {
        'en': 'Uploaded Photos',
        'sk': 'Nahrané Fotografie',
        'es': 'Fotos Subidas',
        'it': 'Foto Caricate',
        'el': 'Ανεβασμένες Φωτογραφίες'
    },
    'final_compositions': {
        'en': 'Enhanced Photos',
        'sk': 'Vylepšené Fotografie',
        'es': 'Fotos Mejoradas',
        'it': 'Foto Migliorate',
        'el': 'Βελτιωμένες Φωτογραφίες'
    },
    'properties_detected': {
        'en': 'Rooms Detected',
        'sk': 'Zistené Miestnosti',
        'es': 'Habitaciones Detectadas',
        'it': 'Stanze Rilevate',
        'el': 'Δωμάτια που Εντοπίστηκαν'
    },
    'commence_processing': {
        'en': 'Enhance Photos',
        'sk': 'Vylepšiť Fotografie',
        'es': 'Mejorar Fotos',
        'it': 'Migliora Foto',
        'el': 'Βελτίωση Φωτογραφιών'
    },
    'crafting_imagery': {
        'en': 'Enhancing Photos',
        'sk': 'Vylepšovanie Fotografií',
        'es': 'Mejorando Fotos',
        'it': 'Miglioramento Foto',
        'el': 'Βελτίωση Φωτογραφιών'
    },
    'hdr_fusion_engine': {
        'en': 'Folio AI Enhancement',
        'sk': 'Vylepšenie Folio AI',
        'es': 'Mejora con IA de Folio',
        'it': 'Miglioramento IA di Folio',
        'el': 'Βελτίωση AI του Folio'
    },
    'critical_inspection': {
        'en': 'Detail View',
        'sk': 'Detailný pohľad',
        'es': 'Vista Detallada',
        'it': 'Vista Dettagliata',
        'el': 'Λεπτομερής Προβολή'
    },
    'before_raw': {
        'en': 'Before',
        'sk': 'Predtým',
        'es': 'Antes',
        'it': 'Prima',
        'el': 'Πριν'
    },
    'after_fused': {
        'en': 'After',
        'sk': 'Potom',
        'es': 'Después',
        'it': 'Dopo',
        'el': 'Μετά'
    },
    'project_review': {
        'en': 'Review',
        'sk': 'Kontrola',
        'es': 'Revisión',
        'it': 'Revisione',
        'el': 'Ανασκόπηση'
    },
    'curated_exposures': {
        'en': 'Your Enhanced Photos',
        'sk': 'Vaše vylepšené fotografie',
        'es': 'Tus fotos mejoradas',
        'it': 'Le tue foto migliorate',
        'el': 'Οι βελτιωμένες φωτογραφίες σας'
    },
    'split_sequence': {
        'en': 'Start New Room Here',
        'sk': 'Začať novú miestnosť tu',
        'es': 'Empezar nueva habitación aquí',
        'it': 'Inizia nuova stanza qui',
        'el': 'Ξεκινήστε νέο δωμάτιο εδώ'
    }
}

for key, translations in updates.items():
    for lang, value in translations.items():
        # Using string matching to avoid regex escaping issues with single quotes
        start_marker = f"  {lang}: {{"
        key_marker = f"    {key}: '"
        
        # find lang block
        block_start = content.find(start_marker)
        if block_start == -1: continue
        
        # find next lang block or end of dict
        next_block = content.find("  },", block_start)
        if next_block == -1: next_block = len(content)
        
        # find the key within this block
        key_pos = content.find(key_marker, block_start, next_block)
        if key_pos != -1:
            val_start = key_pos + len(key_marker)
            val_end = content.find("',", val_start, next_block)
            if val_end == -1:
                val_end = content.find("'\n", val_start, next_block)
            
            if val_end != -1:
                content = content[:val_start] + value.replace("'", "\\'") + content[val_end:]

with open('frontend/src/i18n/dictionaries.ts', 'w', encoding='utf-8') as f:
    f.write(content)
