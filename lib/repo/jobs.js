/** jobs.json 的唯一读写入口：一个文件一个 lock key。 */
import * as store from '../store.js';

export function jobsFile(baseDir) {
  return store.statePaths(baseDir).jobs;
}

export async function readJobsDb(baseDir) {
  return store.readJson(jobsFile(baseDir), { jobs: {} });
}

export async function updateJobsDb(baseDir, fn) {
  return store.updateJson('jobs', jobsFile(baseDir), { jobs: {} }, fn);
}
