/** papers.json 的领域入口：handler/usecase 不再直接 updateState 改论文。 */
import { readState, updateState } from '../state.js';

export async function readPapers(baseDir) {
  return (await readState(baseDir)).papers || {};
}

export async function readPaper(baseDir, id) {
  return (await readState(baseDir)).papers?.[id] || null;
}

/** 单篇读-改-写；找不到论文时返回 null，由调用方决定错误文案。 */
export async function updatePaper(baseDir, id, fn) {
  return updateState(baseDir, (state) => {
    const paper = state.papers?.[id];
    if (!paper) return null;
    return fn(paper, state);
  });
}

export async function updatePapers(baseDir, fn) {
  return updateState(baseDir, (state) => fn(state.papers || {}, state));
}
