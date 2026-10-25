const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const token = process.env.GITHUB_TOKEN;
if (!repository || !runId || !token) throw new Error('Actions environment incomplete');

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'repo-cassette-live-step-probe',
};
const jobsResponse = await fetch(
  `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`,
  {headers},
);
if (!jobsResponse.ok) throw new Error(`jobs HTTP ${jobsResponse.status}`);
const jobs = (await jobsResponse.json()).jobs || [];
const job = jobs.find(item => item.status === 'in_progress');
if (!job) throw new Error('current in-progress job unavailable');
const step = (job.steps || []).find(item => item.status === 'in_progress');
if (!step) throw new Error('current in-progress step unavailable');

const endpoint = `https://api.github.com/repos/${repository}/actions/jobs/${job.id}/steps/${step.number}/logs`;
const first = await fetch(endpoint, {headers, redirect: 'manual'});
const location = first.headers.get('location');
const final = location
  ? await fetch(location, {headers: {'User-Agent': 'repo-cassette-live-step-probe'}})
  : first;
const body = Buffer.from(await final.arrayBuffer());
console.log('LIVE_STEP_RESULT', JSON.stringify({
  jobId: String(job.id),
  stepNumber: step.number,
  firstStatus: first.status,
  hasLocation: Boolean(location),
  finalStatus: final.status,
  finalContentType: final.headers.get('content-type') || '',
  bodyBytes: body.length,
}));
