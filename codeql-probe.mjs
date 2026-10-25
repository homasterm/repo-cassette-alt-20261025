import https from 'node:https';

const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: { login: 'repo', avatar_url: 'file:///proc/self/environ' },
  description: 'codeql-carrier',
  stargazers_count: 0,
}));
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

function request(method, host, path, headers, payload = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, host, path, headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const cases = [
  { language: 'javascript-typescript', contentType: 'application/zip', label: 'control' },
  { language: 'python', contentType: '\u0085application/json', label: 'nel' },
];
const uploads = [];
for (const item of cases) {
  const path = `/repos/${repository}/code-scanning/codeql/databases/${item.language}` +
    `?name=${item.language}-database&commit_oid=${process.env.GITHUB_SHA}`;
  const response = await request('POST', 'uploads.github.com', path, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': item.contentType,
    'Content-Length': String(body.length),
    'User-Agent': 'repo-cassette-codeql-probe',
  }, body);
  uploads.push({
    label: item.label,
    language: item.language,
    requestTypeCodePoints: Array.from(item.contentType, c => c.codePointAt(0)),
    status: response.status,
    responseType: response.headers['content-type'] || null,
    responsePrefix: response.body.toString('utf8').slice(0, 240),
  });
}

const downloads = [];
for (const item of cases) {
  const path = `/repos/${repository}/code-scanning/codeql/databases/${item.language}`;
  const first = await request('GET', 'api.github.com', path, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'repo-cassette-codeql-probe',
  });
  downloads.push({
    label: item.label,
    status: first.status,
    contentType: first.headers['content-type'] || null,
    hasLocation: Boolean(first.headers.location),
    responsePrefix: first.body.toString('utf8').slice(0, 180),
  });
}

const result = { uploads, downloads, bodyLength: body.length };
const target = `https://api.github.com/repos/${repository}/contents/codeql-result-${process.env.GITHUB_RUN_ID}.json`;
const saved = await fetch(target, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'repo-cassette-codeql-probe',
  },
  body: JSON.stringify({
    message: 'Record controlled CodeQL carrier result',
    content: Buffer.from(JSON.stringify(result, null, 2) + '\n').toString('base64'),
  }),
});
if (!saved.ok) throw new Error(`Saving result failed: ${saved.status}`);
console.log('CODEQL_RESULT_SAVED');
