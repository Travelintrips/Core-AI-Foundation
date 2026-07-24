#!/usr/bin/env python3
"""
Mass-remove VITE_ADMIN_API_KEY references from the ai-platform frontend.

Patterns removed:
  - Variable declarations reading VITE_ADMIN_API_KEY
  - "x-admin-api-key" / "X-Admin-Api-Key" header entries
  - Inline import.meta.env.VITE_ADMIN_API_KEY in header objects
  - if (key) headers["x-admin-api-key"] = key; assignments
  - Spread patterns: ...(key ? { "x-admin-api-key": key } : {})

Auth comment lines in services are updated to describe cookie auth.
"""

import re
import os
import sys

# ─── Patterns that match entire lines to REMOVE ──────────────────────────────

LINE_REMOVAL_PATTERNS = [
    # const key = import.meta.env.VITE_ADMIN_API_KEY ...
    re.compile(
        r'^[ \t]*(?:export\s+)?(?:const|let|var)\s+'
        r'(?:key|ADMIN_KEY|k|API_KEY|adminKey|KEY)\s*=\s*'
        r'(?:\(\(import\.meta as any\)\.env\?\.\[?"VITE_ADMIN_API_KEY"?\]|'
        r'import\.meta\.env(?:\??)\[?"VITE_ADMIN_API_KEY"?\])'
        r'[^\n]*$'
    ),
    # const ADMIN_HEADERS = { "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? "" };
    re.compile(
        r'^[ \t]*(?:export\s+)?(?:const|let|var)\s+ADMIN_HEADERS\s*=\s*\{[^}]*"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"[^}]*\}\s*;?[ \t]*$'
    ),
    # "x-admin-api-key": key,   or  "X-Admin-Api-Key": ADMIN_KEY,  etc.
    re.compile(
        r'^[ \t]*"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"\s*:\s*[^,\n]+,?[ \t]*$'
    ),
    # ...(key ? { "x-admin-api-key": key } : {}),
    re.compile(
        r'^[ \t]*\.\.\.\(\s*(?:key|ADMIN_KEY|k|API_KEY|adminKey|KEY)\s*\?'
        r'\s*\{\s*"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"\s*:\s*[^}]+\}\s*:\s*\{\s*\}\s*\)\s*,?[ \t]*$'
    ),
    # if (key) headers["x-admin-api-key"] = key;
    re.compile(
        r'^[ \t]*if\s*\(\s*(?:key|ADMIN_KEY|k|API_KEY|adminKey|KEY)\s*\)'
        r'\s*headers\s*\[\s*"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"\s*\]\s*=\s*[^;]+;[ \t]*$'
    ),
    # headers: { "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? "" },   (inline)
    re.compile(
        r'^[ \t]*(?:headers\s*:\s*)?\{[^}]*"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"\s*:\s*'
        r'import\.meta\.env[^}]*\}[^}]*,?[ \t]*$'
    ),
    # * Auth: VITE_ADMIN_API_KEY header ... comment lines
    re.compile(
        r'^[ \t]*\*\s*Auth:\s*VITE_ADMIN_API_KEY\s+header[^\n]*$'
    ),
    # * All requests are admin-authenticated via VITE_ADMIN_API_KEY.
    re.compile(
        r'^[ \t]*\*\s*All requests are admin-authenticated via VITE_ADMIN_API_KEY\.[^\n]*$'
    ),
]

# ─── Inline replacements (within a line) ─────────────────────────────────────

INLINE_REPLACEMENTS = [
    # headers: { "x-admin-api-key": ADMIN_KEY }  → headers: {}
    (
        re.compile(r'"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"\s*:\s*(?:ADMIN_KEY|key|k|API_KEY|adminKey|KEY)\s*,?\s*'),
        '',
    ),
    # ...(adminKey ? { "x-admin-api-key": adminKey } : {})   inside a larger object
    (
        re.compile(r'\.\.\.\(\s*(?:key|ADMIN_KEY|k|API_KEY|adminKey|KEY)\s*\?'
                   r'\s*\{\s*"[xX]-[Aa]dmin-[Aa]pi-[Kk]ey"\s*:\s*[^}]+\}\s*:\s*\{\s*\}\s*\)\s*,?\s*'),
        '',
    ),
]

def should_remove_line(line: str) -> bool:
    stripped = line.rstrip('\n')
    for pat in LINE_REMOVAL_PATTERNS:
        if pat.match(stripped):
            return True
    return False

def apply_inline(line: str) -> str:
    for pat, repl in INLINE_REPLACEMENTS:
        line = pat.sub(repl, line)
    return line

def process_file(filepath: str) -> tuple[bool, int]:
    with open(filepath, 'r', encoding='utf-8') as f:
        original_lines = f.readlines()

    new_lines = []
    removed = 0
    for line in original_lines:
        if should_remove_line(line):
            removed += 1
            # Keep empty line only if prev line is also not blank (avoid double blanks)
            if new_lines and new_lines[-1].strip():
                new_lines.append('\n')
        else:
            new_lines.append(apply_inline(line))

    new_content = ''.join(new_lines)
    changed = new_content != ''.join(original_lines)

    if changed:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

    return changed, removed

def main():
    base = os.path.join(os.path.dirname(__file__), '..', 'artifacts', 'ai-platform', 'src')

    # Also handle customer-portal dev-test.tsx
    extra = [
        os.path.join(os.path.dirname(__file__), '..', 'artifacts', 'customer-portal',
                     'src', 'pages', 'dev-test.tsx'),
    ]

    targets = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', '.git')]
        for fname in files:
            if fname.endswith(('.ts', '.tsx')):
                targets.append(os.path.join(root, fname))
    targets.extend(extra)

    total_changed = 0
    total_removed = 0
    changed_files = []

    for fpath in sorted(targets):
        try:
            changed, removed = process_file(fpath)
            if changed:
                total_changed += 1
                total_removed += removed
                rel = os.path.relpath(fpath, os.path.join(os.path.dirname(__file__), '..'))
                changed_files.append((rel, removed))
        except Exception as e:
            print(f"ERROR {fpath}: {e}", file=sys.stderr)

    print(f"Files changed: {total_changed}, lines removed: {total_removed}")
    for f, n in changed_files:
        print(f"  [{n:2d} lines] {f}")

if __name__ == '__main__':
    main()
