#!/usr/bin/env python3
"""Reads JSON on stdin, emits a context-injection response."""
import sys, json
sys.stdin.read()
sys.stdout.write(json.dumps({"context": "Today is Friday"}))
