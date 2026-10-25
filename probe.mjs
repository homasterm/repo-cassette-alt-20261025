import https from 'node:https';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'https://example.invalid/benign.png'},
  description: 'codeql-carrier-marker',
  stargazers_count: 0,
}));

function request(method, target, headers = {}, payload = null) {
  return new Promise((resolve, reject) => {
    const url = target instanceof URL ? target : new URL(target);
    const req = https.request(url, {method, headers}, (res) => {
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

const apiHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github.v3+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'repo-cassette-codeql-carrier-probe',
};
const cases = [
  {language: 'javascript-typescript', type: 'application/zip', label: 'control'},
  {language: 'python', type: '\u0085application/json', label: 'nel-json'},
];
const results = [];

for (const item of cases) {
  const upload = new URL(`https://uploads.github.com/repos/${repository}/code-scanning/codeql/databases/${item.language}`);
  upload.searchParams.set('name', `repo-cassette-${item.label}-${process.env.GITHUB_RUN_ID}`);
  upload.searchParams.set('commit_oid', process.env.GITHUB_SHA);
  let uploadResponse;
  let first;
  let final;
  try {
    uploadResponse = await request('POST', upload, {
      ...apiHeaders,
      'Content-Type': item.type,
      'Content-Length': String(body.length),
    }, body);

    const download = `https://api.github.com/repos/${repository}/code-scanning/codeql/databases/${item.language}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      first = await request('GET', download, apiHeaders);
      if (first.status === 302 && first.headers.location) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (first?.status === 302 && first.headers.location) {
      final = await request('GET', first.headers.location, {'User-Agent': apiHeaders['User-Agent']});
    }
    results.push({
      label: item.label,
      requestTypeCodePoints: Array.from(item.type, c => c.codePointAt(0)),
      uploadStatus: uploadResponse.status,
      uploadResponseType: uploadResponse.headers['content-type'] || null,
      downloadStatus: first?.status || null,
      finalStatus: final?.status || null,
      finalType: final?.headers['content-type'] || null,
      finalTypeCodePoints: Array.from(final?.headers['content-type'] || '', c => c.codePointAt(0)),
      bodyMatches: Boolean(final && final.body.equals(body)),
      finalSize: final?.body.length || null,
    });
  } catch (error) {
    results.push({label: item.label, error: String(error?.message || error).slice(0, 160)});
  } finally {
    const cleanup = `https://api.github.com/repos/${repository}/code-scanning/codeql/databases/${item.language}`;
    const deleted = await request('DELETE', cleanup, apiHeaders).catch(() => null);
    const result = results[results.length - 1];
    if (result?.label === item.label) result.cleanupStatus = deleted?.status || null;
  }
}

console.log('CODEQL_CARRIER_RESULT', JSON.stringify(results));
