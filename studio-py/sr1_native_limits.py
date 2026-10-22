"""Shared conservative editor/export budgets for experimental native props.

These are export-side budgets, not confirmed Saints Row runtime pool limits.
Actual render slots, 16-bit index buffers, and Havok selectors are checked
at export time; these budgets can be revised after in-game testing.
"""
MAX_NATIVE_OBJECTS = 32
MAX_NATIVE_TRIANGLES = 4096
MIN_NATIVE_AXIS = 0.01
MAX_NATIVE_AXIS = 25.0
