/** A vector shape whose cells flicker in a brighter opacity range, placed in
 * CSS pixels relative to the grid's top-left corner. */
export interface FlickeringGridShape {
  /** SVG path data, in the coordinate space of `viewBox`. */
  path: string;
  viewBox: { x: number; y: number; width: number; height: number };
  x: number;
  y: number;
  width: number;
  height: number;
}
