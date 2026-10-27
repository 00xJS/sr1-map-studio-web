export declare const DRAWING_SOURCES: string[]
/** Path (relative to the web root, forward slashes) → short hash, for every file the thumbnails are drawn with. */
export declare function drawingSources(root: string): Record<string, string>
