import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'https://example.invalid/benign.png'},
  description: 'dot-json-mime-marker',
  stargazers_count: 0,
}));
const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'repo-cassette-dot-json-mime-probe',
};

const results = [];
for (const [index, mimeType] of ['application/json', 'application.json', 'foo.json'].entries()) {
  const name = `repo-cassette-dot-json-${index}-${process.env.GITHUB_RUN_ID}`;
  try {
    const made = await client.CreateArtifact({
      ...backend,
      name,
      version: 7,
      mimeType: StringValue.create({value: mimeType}),
    });
    if (!made.ok) throw new Error('create-not-ok');
    await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
      blobHTTPHeaders: {blobContentType: mimeType},
    });
    const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
    if (!done.ok) throw new Error('finalize-not-ok');
    const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
    const first = await fetch(url, {headers, redirect: 'manual'});
    const location = first.headers.get('location');
    const final = location ? await fetch(location) : first;
    const bytes = Buffer.from(await final.arrayBuffer());
    results.push({
      mimeType,
      artifactId: String(done.artifactId),
      firstStatus: first.status,
      finalStatus: final.status,
      finalType: final.headers.get('content-type') || '',
      bodyMatches: bytes.equals(body),
      size: bytes.length,
    });
  } catch (error) {
    results.push({mimeType, error: String(error?.message || error).slice(0, 180)});
  }
}
console.log('DOT_JSON_MIME_RESULT', JSON.stringify(results));
