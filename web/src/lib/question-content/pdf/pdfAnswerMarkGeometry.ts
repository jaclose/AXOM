/** PDF.js uses bottom-left page coordinates for text and native draw paths. */
export type Matrix = [number, number, number, number, number, number];
export interface MarkBox { left: number; bottom: number; right: number; top: number }
export interface ChoiceLabel { key: string; x: number; y: number; height: number }

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

/** A small six-vertex tick; rectangles, arrows and colour alone do not qualify. */
export function isVectorCheck(path: ArrayLike<number>): boolean {
  if (path.length !== 19 || path[0] !== 0 || path[18] !== 4) return false;
  const points: number[][] = [];
  for (let i = 0; i < 18; i += 3) {
    if (i > 0 && path[i] !== 1) return false;
    points.push([path[i + 1], path[i + 2]]);
  }
  const xs = points.map(([x]) => x), ys = points.map(([,y]) => y);
  const left = Math.min(...xs), bottom = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - bottom;
  if (width <= 0 || height <= 0 || width / height < .65 || width / height > 1.4) return false;
  const template = [[.15,.61],[0,.305],[.4,0],[1,.826],[1,1],[.35,.305]];
  return points.every(([x,y], i) => Math.abs((x-left)/width-template[i][0]) < .13 && Math.abs((y-bottom)/height-template[i][1]) < .13);
}

export function answerBesideCheck(box: MarkBox, labels: readonly ChoiceLabel[]): string | undefined {
  const height = box.top - box.bottom, width = box.right - box.left;
  if (height < 4 || height > 45 || width < 4 || width > 45) return undefined;
  const candidates = labels.filter((label) => {
    const gap = label.x - box.right;
    const middle = (box.top + box.bottom) / 2;
    return gap >= -2 && gap < 30 && Math.abs(middle - (label.y + label.height * .25)) < Math.max(7, label.height * .65);
  });
  return candidates.length === 1 ? candidates[0].key : undefined;
}
