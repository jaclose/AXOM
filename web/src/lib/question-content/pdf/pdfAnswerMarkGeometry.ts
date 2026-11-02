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

/** An answer-page outline can surround a choice while its letter sits just to the left. */
export function answerInsideOutline(box: MarkBox, labels: readonly ChoiceLabel[]): string | undefined {
  const height = box.top - box.bottom;
  if (height < 16 || height > 65 || box.right - box.left < 60) return undefined;
  const candidates = labels.filter(label => label.x >= box.left - height * 4
    && label.x <= box.left + height * 2
    && label.y >= box.bottom - 3 && label.y <= box.top + 3);
  return candidates.length === 1 ? candidates[0].key : undefined;
}

/** PDF.js constructPath uses 0=move, 1=line, 2=cubic curve, 4=close. */
export function choiceOutlineBox(path: ArrayLike<number>, matrix: Matrix): MarkBox | undefined {
  if (path.length < 13 || path[0] !== 0 || path[path.length - 1] !== 4
    || !matrix.every(Number.isFinite) || Math.abs(matrix[1]) > .01 || Math.abs(matrix[2]) > .01) return undefined;
  const points: Array<[number, number]> = [];
  const lines: Array<[[number, number], [number, number]]> = [];
  let cursor: [number, number] | undefined;
  for (let i = 0; i < path.length;) {
    const code = path[i++];
    if (code === 4) {
      if (i !== path.length || points.length < 4) return undefined;
      break;
    }
    const count = code === 0 || code === 1 ? 2 : code === 2 ? 6 : 0;
    if (!count || i + count > path.length - 1 || (code === 0 && points.length)) return undefined;
    const coordinates = Array.from({ length: count }, (_, n) => path[i + n]);
    if (!coordinates.every(Number.isFinite)) return undefined;
    const end: [number, number] = [coordinates[count - 2], coordinates[count - 1]];
    if (code === 1 && cursor) lines.push([cursor, end]);
    if (code === 2) {
      points.push([coordinates[0], coordinates[1]], [coordinates[2], coordinates[3]]);
    }
    points.push(end);
    cursor = end;
    i += count;
  }
  if (points.length > 32 || lines.length < 2) return undefined;
  const mapped = points.map(([x, y]): [number, number] => [matrix[0] * x + matrix[4], matrix[3] * y + matrix[5]]);
  const left = Math.min(...mapped.map(point => point[0])), right = Math.max(...mapped.map(point => point[0]));
  const bottom = Math.min(...mapped.map(point => point[1])), top = Math.max(...mapped.map(point => point[1]));
  const width = right - left, height = top - bottom;
  if (width < 60 || width > 360 || height < 16 || height > 65 || width / height < 2.2 || width / height > 20) return undefined;
  const tolerance = Math.max(2, height * .08);
  if (![left, right, bottom, top].every((edge, n) => mapped.some(point =>
    Math.abs(point[n < 2 ? 0 : 1] - edge) <= tolerance))) return undefined;
  const horizontal = lines.some(([a, b]) => Math.abs(a[1] - b[1]) * Math.abs(matrix[3]) <= tolerance
    && Math.abs(a[0] - b[0]) * Math.abs(matrix[0]) >= width * .4);
  const vertical = lines.some(([a, b]) => Math.abs(a[0] - b[0]) * Math.abs(matrix[0]) <= tolerance
    && Math.abs(a[1] - b[1]) * Math.abs(matrix[3]) >= height * .4);
  return horizontal && vertical ? { left, bottom, right, top } : undefined;
}
