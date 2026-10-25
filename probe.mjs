import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'https://example.invalid/benign.png'},
  description: 'version-boundary-marker',
  stargazers_count: 0,
}));
const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'repo-cassette-version-boundary-probe',
};

const results = [];
for (let version = 0; version <= 6; version++) {
  const name = `repo-cassette-v${version}-${process.env.GITHUB_RUN_ID}`;
  try {
    const made = await client.CreateArtifact({
      ...backend,
      name,
      version,
      mimeType: StringValue.create({value: '\u0085application/json'}),
    });
    if (!made.ok) throw new Error('create-not-ok');
    await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
      blobHTTPHeaders: {blobContentType: '\u0085application/json'},
    });
    const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
    if (!done.ok) throw new Error('finalize-not-ok');
    const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
    const first = await fetch(url, {headers, redirect: 'manual'});
    const location = first.headers.get('location');
    const final = location ? await fetch(location) : first;
    const bytes = Buffer.from(await final.arrayBuffer());
    const type = final.headers.get('content-type') || '';
    results.push({
      version,
      artifactId: String(done.artifactId),
      status: first.status,
      finalStatus: final.status,
      type,
      typeCodePoints: Array.from(type, c => c.codePointAt(0)),
      bodyMatches: bytes.equals(body),
      size: bytes.length,
    });
  } catch (error) {
    results.push({version, error: String(error?.message || error).slice(0, 160)});
  }
}
console.log('VERSION_BOUNDARY_RESULT', JSON.stringify(results));
