#!/usr/bin/env python3
"""Baut aus src/ die eigenständige Datei dist/netlab.html."""
from pathlib import Path
root = Path(__file__).parent
s = (root / 'src' / 'shell.html').read_text(encoding='utf-8')
for key, name in [('ENGINE', 'engine.js'), ('LABS', 'labs.js'), ('SANDBOX', 'sandbox.js'), ('APP', 'app.js')]:
    s = s.replace('/*__%s__*/' % key, (root / 'src' / name).read_text(encoding='utf-8'))
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'netlab.html').write_text(s, encoding='utf-8')
print('dist/netlab.html geschrieben (%d KB)' % (len(s) // 1024))
