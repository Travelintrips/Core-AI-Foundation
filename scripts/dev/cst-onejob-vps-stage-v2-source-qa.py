#!/usr/bin/env python3
"""Run ONLY deterministic source QA via the isolated broker CI virtualenv."""
import pathlib
import runpy
import sys

path=pathlib.Path(__file__).resolve().parents[2]/"deploy"/"cst-onejob-vps"/"test_cst_onejob_stage_release_v2.py"
sys.path.insert(0,str(path.parent))
sys.argv=[str(path)]
runpy.run_path(str(path),run_name="__main__")
