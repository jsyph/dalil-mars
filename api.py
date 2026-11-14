#!/usr/bin/env python3
"""Dalil-Mars API Shim.

All capabilities are unified directly inside engine.py.
This file re-exports everything from engine.py for backward compatibility.
"""
from engine import *

if __name__ == "__main__":
    main()
