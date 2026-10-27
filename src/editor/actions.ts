// Editor commands. Each mirrors a MainWindow method in the desktop app;
// rules that live in Python (native props, breakables, validation) are
// called through the worker so behavior stays identical.
// The commands live in act/, by what they act on; this file gathers them for `import * as act`.
export * from './act/core'
export * from './act/objects'
export * from './act/markers'
export * from './act/shapes'
export * from './act/several'
