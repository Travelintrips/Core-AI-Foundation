"""Patch the installed DEV-only ChatGPT wake worker after a verified backup.

The original script stays on the authorized PC. This patch is idempotent and
refuses unknown script layouts rather than disabling verification.
"""
from pathlib import Path
import ast
import os
import sys

path = Path(os.environ["LOCALAPPDATA"]) / "AI-Core" / "dev-chatgpt-wake-once.py"
source = path.read_text(encoding="utf-8")
old_selector = '"[contenteditable]", "--limit", "16", timeout=25)'
new_selector = '"[contenteditable=true][role=textbox]", "--limit", "16", timeout=25)'
old_regex = 'r\'textbox "Ask ChatGPT" \\[ref=(e\\d+)\\](?: value=("(?:[^"\\\\]|\\\\.)*"))?\''
new_regex = 'r\'textbox "(?:Ask ChatGPT|Tanya ChatGPT)" \\[ref=(e\\d+)\\](?: value=("(?:[^"\\\\]|\\\\.)*"))?\''
if old_selector in source:
    source = source.replace(old_selector, new_selector, 1)
elif new_selector not in source:
    raise SystemExit("Unexpected composer selector: refusing patch")
if old_regex in source:
    source = source.replace(old_regex, new_regex, 1)
elif new_regex not in source:
    raise SystemExit("Unexpected composer regex: refusing patch")
ast.parse(source, filename=str(path))
backup = path.with_suffix(".py.pre-composer-fix.bak")
if not backup.exists():
    backup.write_bytes(path.read_bytes())
path.write_text(source, encoding="utf-8")
assert new_selector in source and new_regex in source
print("DEV_COMPOSER_PATCH=PASS backup=" + str(backup))
