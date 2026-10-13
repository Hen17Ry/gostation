"""Audit d'accessibilité d'arbres uiautomator (un fichier XML par écran).

Signale les éléments actionnables (cliquables, cochables, champs) sans nom accessible (ni
content-desc, ni texte dans leurs descendants) et ceux dont la zone visible fait moins de 48 dp
(les hitSlop de React Native ne figurent pas dans l'arbre : à vérifier au cas par cas). Un élément
actionnable sans nom contenu dans une cible actionnable nommée (interrupteur visuel d'une ligne
« switch ») fait partie de cette cible : il n'est pas audité à part. Un élément imbriqué qui a son
propre nom (bouton Itinéraire d'une carte de résultat) reste une cible distincte, auditée.
Usage : python3 a11y-audit.py <densité dpi> <dump.xml>...
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

density = int(sys.argv[1]) / 160
problems = 0
for path in sys.argv[2:]:
    root = ET.parse(path).getroot()
    findings = []

    def label(node):
        own = (node.get('content-desc') or node.get('text') or '').strip()
        if own:
            return own
        for child in node.iter():
            text = (child.get('content-desc') or child.get('text') or '').strip()
            if text:
                return text
        return ''

    def actionable(node):
        return node.get('clickable') == 'true' or node.get('checkable') == 'true' or node.get('class', '').endswith('EditText')

    def audited(node, inside_target=False):
        """Nœuds actionnables à auditer, hors ceux sans nom d'une cible parente nommée."""
        own = actionable(node) and node.get('enabled') != 'false'
        if own and (not inside_target or label(node)):
            yield node
        for child in node:
            yield from audited(child, inside_target or (own and bool(label(node))))

    for node in audited(root):
        # Couches de la carte (MapLibre) et conteneurs plein écran : hors périmètre.
        if 'maplibre' in node.get('class', '').lower():
            continue
        (x1, y1), (x2, y2) = [tuple(map(int, p.split(','))) for p in node.get('bounds')[1:-1].split('][')]
        w, h = (x2 - x1) / density, (y2 - y1) / density
        name = label(node)
        rid = node.get('resource-id') or ''
        if not name:
            findings.append(f'  ✗ sans nom accessible : {node.get("class")} {rid} ({w:.0f}×{h:.0f} dp)')
        if min(w, h) < 48 and w * h < 2400 * 4:
            findings.append(f'  · cible {w:.0f}×{h:.0f} dp < 48 : « {name[:40]} » {rid}')
    print(f'{Path(path).stem} : {"OK" if not findings else str(len(findings)) + " point(s)"}')
    for f in findings:
        print(f)
    problems += sum(1 for f in findings if '✗' in f)
sys.exit(1 if problems else 0)
