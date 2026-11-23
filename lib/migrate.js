/**
 * 一次性迁移旧 T1 状态：triaged → parked/dropped，t1 → legacy_triage。
 * keep/maybe 默认停车，不自动提升，避免旧模型结论直接进论文队列。
 */
import { updateCandidates } from './candidates.js';

export async function migrateLegacyTriage(baseDir) {
  let changed = 0;
  await updateCandidates(baseDir, (items) => {
    for (const item of Object.values(items)) {
      if (item.status !== 'triaged') continue;
      const verdict = item.t1?.verdict;
      item.legacy_triage = item.t1 || null;
      delete item.t1;
      item.status = verdict === 'drop' ? 'dropped' : 'parked';
      item.migrated_at = new Date().toISOString();
      changed += 1;
    }
    return items;
  });
  return { changed };
}
