"""
Strict verification of EN mode in presentation.html and docs/presentation.html,
and verification of all 16 bilingual SVG diagrams.
"""
import re
import os
from html.parser import HTMLParser

KO_REGEX = re.compile(r'[\uac00-\ud7a3]')

class EnModeTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ko_stack = []
        self.script_or_style = False
        self.violations = []
        self.current_line = 1

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        classes = attrs_dict.get('class', '').split()
        is_ko = 'lang-ko' in classes
        self.ko_stack.append(is_ko)
        if tag in ('script', 'style'):
            self.script_or_style = True

    def handle_endtag(self, tag):
        if self.ko_stack:
            self.ko_stack.pop()
        if tag in ('script', 'style'):
            self.script_or_style = False

    def handle_data(self, data):
        line = self.getpos()[0]
        # If currently inside a lang-ko tag or inside script/style, it is hidden in EN mode
        if any(self.ko_stack) or self.script_or_style:
            return
        
        hangul = KO_REGEX.findall(data)
        if hangul:
            clean_text = ' '.join(data.split())
            if clean_text:
                self.violations.append((line, clean_text, hangul))

def verify_html(file_path):
    print(f"\n--- Checking {file_path} ---")
    with open(file_path, 'r', encoding='utf-8') as f:
        html = f.read()

    parser = EnModeTextExtractor()
    parser.feed(html)

    if parser.violations:
        print(f"FAILED: Found {len(parser.violations)} Korean text leaks in EN mode:")
        for line, text, chars in parser.violations:
            print(f"  Line {line}: '{text}' (Hangul: {chars[:5]})")
        return False
    else:
        print(f"SUCCESS: 0 Korean characters found in EN mode for {file_path}!")
        return True

def verify_svgs():
    print(f"\n--- Checking SVG Diagrams ---")
    image_dir = os.path.join(os.path.dirname(__file__), "..", "docs", "image")
    all_ok = True
    
    en_svgs = [f for f in os.listdir(image_dir) if f.endswith("_en.svg")]
    ko_svgs = [f for f in os.listdir(image_dir) if f.endswith("_ko.svg")]
    
    print(f"Found {len(ko_svgs)} Korean SVGs and {len(en_svgs)} English SVGs.")
    if len(en_svgs) != 8 or len(ko_svgs) != 8:
        print(f"WARNING: Expected 8 pairs of SVGs, found {len(ko_svgs)} KO and {len(en_svgs)} EN.")
        all_ok = False

    for f_name in en_svgs:
        p = os.path.join(image_dir, f_name)
        with open(p, 'r', encoding='utf-8') as f:
            content = f.read()
        hangul = KO_REGEX.findall(content)
        if hangul:
            print(f"FAILED: {f_name} contains Korean characters: {set(hangul)}")
            all_ok = False
        else:
            print(f"SUCCESS: {f_name} is 100% pure English.")

    return all_ok

if __name__ == '__main__':
    root_html = os.path.join(os.path.dirname(__file__), "..", "presentation.html")
    docs_html = os.path.join(os.path.dirname(__file__), "..", "docs", "presentation.html")

    v1 = verify_html(root_html)
    v2 = verify_html(docs_html)
    v3 = verify_svgs()

    if v1 and v2 and v3:
        print("\n==========================================")
        print("ALL AUDITS PASSED PERFECTLY (100% CLEAN)!")
        print("==========================================")
    else:
        print("\nSOME AUDITS FAILED. Please review above logs.")
        exit(1)
